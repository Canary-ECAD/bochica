import { randomUUID } from "node:crypto";
import type { ApprovalAnswer, Approver } from "@bochica/agent";
import {
  type ApprovalDecision,
  type ApprovalRequest,
  type Confirmation,
  confirmationMatches,
} from "@bochica/shared";
import type { ApprovalRules } from "./permissions";

/** How long a card waits before the call is denied (guardrails layer 5: fail closed). */
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

interface Pending {
  turnId: string;
  sessionKey: string;
  server: string;
  tool: string;
  input: unknown;
  allowSession: boolean;
  allowAlways: boolean;
  confirm?: Confirmation;
  resolve(answer: ApprovalAnswer): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Smart approvals: whether a call may run without a card. Decides itself what it applies to. */
export type Judge = (call: { server: string; tool: string; input: unknown }) => Promise<boolean>;

/** Rules for tests and for when none are stored: nothing is always allowed or counted. */
const noRules: ApprovalRules = {
  canAlwaysAllow: () => false,
  isAlwaysAllowed: () => false,
  allowAlways: () => {},
  recordAllowed: () => {},
  allowedCount: () => 0,
};

export interface ApprovalOptions {
  rules?: ApprovalRules;
  timeoutMs?: number;
}

/**
 * Pauses tool calls that need the user's approval until the renderer answers. Before a card is
 * shown, in this order: the session's Auto mode, "Allow for this session" (per chat session and
 * tool, in memory), the user's "Always allow" rules, and smart approval.
 */
export class ApprovalService {
  private readonly pending = new Map<string, Pending>();
  private readonly allowedForSession = new Set<string>();
  private readonly autoSessions = new Set<string>();
  private readonly rules: ApprovalRules;
  private readonly timeoutMs: number;

  constructor({ rules = noRules, timeoutMs = DEFAULT_TIMEOUT_MS }: ApprovalOptions = {}) {
    this.rules = rules;
    this.timeoutMs = timeoutMs;
  }

  /** Auto mode: the session's calls run without asking, except what must always ask. */
  setAuto(sessionId: string, on: boolean): void {
    if (on) this.autoSessions.add(sessionId);
    else this.autoSessions.delete(sessionId);
  }

  /** Turns Auto mode off everywhere, e.g. when the window reloads and forgets it. */
  clearAuto(): void {
    this.autoSessions.clear();
  }

  /** The approver for one turn; `send` delivers the request to the window that asked. */
  approverFor(
    sessionId: string,
    turnId: string,
    send: (request: ApprovalRequest) => void,
    judge?: Judge,
  ): Approver {
    return async ({ server, tool, input, approval, fixed, confirm, risks }) => {
      // Auto mode skips layer 5 only: typed confirmations (layer 6) and tools whose policy says
      // they always ask (closing EPLAN, deleting pages) still ask. Checked on every call, so
      // turning it off applies at once.
      if (this.autoSessions.has(sessionId) && !confirm && !fixed) return { auto: "auto" };
      const allowSession = approval === "ask";
      const sessionKey = `${sessionId}\u0000${server}\u0000${tool}`;
      if (allowSession && this.allowedForSession.has(sessionKey)) return "allow";
      if (allowSession && this.rules.isAlwaysAllowed(server, tool, input)) return { auto: "rule" };
      if (allowSession && judge && (await judge({ server, tool, input }))) return { auto: "smart" };
      const allowAlways = allowSession && this.rules.canAlwaysAllow(server, tool, input);
      const requestId = randomUUID();
      return new Promise<ApprovalAnswer>((resolve) => {
        const timer = setTimeout(() => this.settle(requestId, "deny"), this.timeoutMs);
        this.pending.set(requestId, {
          turnId,
          sessionKey,
          server,
          tool,
          input,
          allowSession,
          allowAlways,
          ...(confirm ? { confirm } : {}),
          resolve,
          timer,
        });
        send({
          requestId,
          turnId,
          server,
          tool,
          input,
          allowSession,
          allowAlways,
          ...(allowAlways ? { allowedBefore: this.rules.allowedCount(server, tool, input) } : {}),
          ...(confirm ? { confirm } : {}),
          ...(risks ? { risks } : {}),
        });
      });
    };
  }

  respond(requestId: string, decision: ApprovalDecision, typed = ""): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    // Typed confirmation is checked here, not trusted from the renderer's button state.
    if (entry.confirm && decision !== "deny" && !confirmationMatches(entry.confirm, typed)) {
      this.settle(requestId, "deny");
      return;
    }
    const { server, tool, input } = entry;
    if (decision !== "deny" && entry.allowAlways) this.rules.recordAllowed(server, tool, input);
    // "always" tools can't be allowed for the session or always, whatever the renderer sends.
    if (decision === "session" && entry.allowSession) this.allowedForSession.add(entry.sessionKey);
    if (decision === "always" && entry.allowAlways) this.rules.allowAlways(server, tool, input);
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
