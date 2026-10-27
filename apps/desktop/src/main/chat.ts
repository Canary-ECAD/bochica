import { randomUUID } from "node:crypto";
import { type AgentTool, createModel, getProvider, type McpManager, runTurn } from "@bochica/agent";
import {
  ApprovalRequest,
  ChatEvent,
  type ChatSendRequest,
  ipcChannels,
  type TurnEvent,
} from "@bochica/shared";
import type { WebContents } from "electron";
import type { ApprovalService } from "./approvals";
import type { BackupGuard } from "./backup";
import type { CredentialStore } from "./credentials";
import type { Logger } from "./logger";

/** Runs chat turns in the main process and streams their events to the window that asked. */
export class ChatService {
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly credentials: CredentialStore,
    private readonly mcp: McpManager,
    private readonly approvals: ApprovalService,
    private readonly backups: BackupGuard,
    private readonly logger: Logger,
    /** Tools that don't come from MCP servers (e.g. the dev-only approval test tool). */
    private readonly extraTools: AgentTool[] = [],
  ) {}

  /** Starts the turn and returns at once; events follow on `chat:event`. */
  send(request: ChatSendRequest, target: WebContents): void {
    const emit = (event: TurnEvent): void => {
      if (!target.isDestroyed()) {
        target.send(ipcChannels.chatEvent, ChatEvent.parse({ turnId: request.turnId, ...event }));
      }
    };

    const key = keyFor(request.provider, this.credentials);
    if (key === undefined) {
      emit({ type: "error", code: "missing_key", message: "No API key saved for this provider." });
      return;
    }

    const approve = this.approvals.approverFor(request.sessionId, request.turnId, (approval) => {
      if (!target.isDestroyed()) {
        target.send(ipcChannels.approvalRequest, ApprovalRequest.parse(approval));
      }
    });

    const controller = new AbortController();
    this.running.set(request.turnId, controller);
    void (async () => {
      try {
        const model = createModel(request.provider, key, request.model);
        for await (const event of runTurn({
          model,
          messages: request.messages,
          abortSignal: controller.signal,
          tools: [...this.mcp.tools(), ...this.extraTools].map((tool) =>
            tool.changesProject ? this.withBackup(tool, request.sessionId, emit) : tool,
          ),
          approve,
        })) {
          if (event.type === "error") {
            this.logger.error(
              `Turn failed (${request.provider}/${request.model}): ${event.code}`,
              event.message,
            );
          }
          emit(event);
        }
      } finally {
        this.running.delete(request.turnId);
      }
    })();
  }

  /**
   * Guardrails layer 6: runs after the user approved the call and before it executes. The
   * backup shows in the activity log as its own step; if it fails, the change is not made.
   */
  private withBackup(
    tool: AgentTool,
    sessionId: string,
    emit: (event: TurnEvent) => void,
  ): AgentTool {
    return {
      ...tool,
      execute: async (input, signal) => {
        const callId = `backup-${randomUUID()}`;
        let started = false;
        try {
          const result = await this.backups.ensure(sessionId, input, (project) => {
            started = true;
            emit({
              type: "tool-call",
              callId,
              server: "bochica",
              tool: "backup_project",
              input: { project },
            });
          });
          if (result.status === "done") {
            emit({ type: "tool-result", callId, status: "ok", output: result.archive ?? "" });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error("Backup before change failed", message);
          if (started) emit({ type: "tool-result", callId, status: "error", output: message });
          return {
            ok: false,
            text: `Bochica could not back up the project first, so the change was NOT made. Tell the user: ${message}`,
          };
        }
        return tool.execute(input, signal);
      },
    };
  }

  stop(turnId: string): void {
    this.approvals.cancelTurn(turnId);
    this.running.get(turnId)?.abort();
  }

  stopAll(): void {
    for (const [turnId, controller] of this.running) {
      this.approvals.cancelTurn(turnId);
      controller.abort();
    }
  }
}

/** The key to call a provider with: "" for local servers, undefined when none is configured. */
export function keyFor(
  provider: ChatSendRequest["provider"],
  credentials: CredentialStore,
): string | undefined {
  return getProvider(provider).auth === "local" ? "" : credentials.resolve(provider);
}

/**
 * Dev builds only (BOCHICA_DEV_TOOLS=1): a harmless tool that always asks for approval, so the
 * approval card can be exercised before any real write tool exists.
 */
export const devEchoTool: AgentTool = {
  name: "bochica__dev_echo",
  server: "bochica",
  tool: "dev_echo",
  description:
    "Developer test tool: echoes the given text back. Use it only when the user explicitly asks to test approvals.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", description: "Text to echo" } },
    required: ["text"],
  },
  approval: "ask",
  execute: async (input) => ({ ok: true, text: `Echo: ${JSON.stringify(input)}` }),
};
