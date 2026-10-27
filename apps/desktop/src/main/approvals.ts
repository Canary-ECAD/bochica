import { randomUUID } from "node:crypto";
import type { ApprovalAnswer, Approver } from "@bochica/agent";
import type { ApprovalDecision, ApprovalRequest } from "@bochica/shared";

/** How long a card waits before the call is denied (guardrails layer 5: fail closed). */
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

interface Pending {
  turnId: string;
  sessionKey: string;
  allowSession: boolean;
  resolve(answer: ApprovalAnswer): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Pauses tool calls that need the user's approval until the renderer answers. "Allow for this
 * session" is remembered per chat session and tool; nothing is remembered across restarts yet.
 */
export class ApprovalService {
  private readonly pending = new Map<string, Pending>();
  private readonly allowedForSession = new Set<string>();

  constructor(private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {}

  /** The approver for one turn; `send` delivers the request to the window that asked. */
  approverFor(
    sessionId: string,
    turnId: string,
    send: (request: ApprovalRequest) => void,
  ): Approver {
    return async ({ server, tool, input, approval }) => {
      const allowSession = approval === "ask";
      const sessionKey = `${sessionId}\u0000${server}\u0000${tool}`;
      if (allowSession && this.allowedForSession.has(sessionKey)) return "allow";
      const requestId = randomUUID();
      return new Promise<ApprovalAnswer>((resolve) => {
        const timer = setTimeout(() => this.settle(requestId, "deny"), this.timeoutMs);
        this.pending.set(requestId, { turnId, sessionKey, allowSession, resolve, timer });
        send({ requestId, turnId, server, tool, input, allowSession });
      });
    };
  }

  respond(requestId: string, decision: ApprovalDecision): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    // "always" tools can't be allowed for the session, whatever the renderer sends.
    if (decision === "session" && entry.allowSession) this.allowedForSession.add(entry.sessionKey);
    this.settle(requestId, decision === "deny" ? "deny" : "allow");
  }

  /** Denies everything still waiting for a turn, e.g. when the user presses Stop. */
  cancelTurn(turnId: string): void {
    for (const [requestId, entry] of this.pending) {
      if (entry.turnId === turnId) this.settle(requestId, "deny");
    }
  }

  private settle(requestId: string, answer: ApprovalAnswer): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(requestId);
    entry.resolve(answer);
  }
}
