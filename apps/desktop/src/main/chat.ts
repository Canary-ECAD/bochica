import { randomUUID } from "node:crypto";
import {
  type AgentTool,
  createModel,
  getProvider,
  type McpManager,
  runTurn,
  systemPrompt,
} from "@bochica/agent";
import { eplanToolInMode } from "@bochica/eplan";
import {
  applyTurnEvent,
  ApprovalRequest,
  assistantPlaceholder,
  ChatEvent,
  type ChatMode,
  type ChatSendRequest,
  type ConversationMessage,
  ipcChannels,
  titleFrom,
  type TurnEvent,
  userMessage,
} from "@bochica/shared";
import type { WebContents } from "electron";
import type { ApprovalService } from "./approvals";
import type { BackupGuard } from "./backup";
import type { CredentialStore } from "./credentials";
import type { SessionRepository } from "./db/repository";
import type { Logger } from "./logger";
import { EPLAN_SERVER_ID } from "./mcp-service";
import type { SkillStore } from "./skills";

const TEXT_SAVE_INTERVAL_MS = 1_000;

export interface ChatDeps {
  credentials: CredentialStore;
  mcp: McpManager;
  approvals: ApprovalService;
  backups: BackupGuard;
  sessions: SessionRepository;
  skills: SkillStore;
  logger: Logger;
  /** Tools that don't come from MCP servers (e.g. the dev-only approval test tool). */
  extraTools?: AgentTool[];
}

/** Runs chat turns in the main process and streams their events to the window that asked. */
export class ChatService {
  private readonly running = new Map<string, AbortController>();

  private readonly credentials: CredentialStore;
  private readonly mcp: McpManager;
  private readonly approvals: ApprovalService;
  private readonly backups: BackupGuard;
  private readonly sessions: SessionRepository;
  private readonly skills: SkillStore;
  private readonly logger: Logger;
  private readonly extraTools: AgentTool[];

  constructor(deps: ChatDeps) {
    this.credentials = deps.credentials;
    this.mcp = deps.mcp;
    this.approvals = deps.approvals;
    this.backups = deps.backups;
    this.sessions = deps.sessions;
    this.skills = deps.skills;
    this.logger = deps.logger;
    this.extraTools = deps.extraTools ?? [];
  }

  /**
   * The tools a mode allows. Consult: the docs and the scripting guide. Tasks and Draw: the
   * docs plus the EPLAN tools of that mode.
   */
  private toolsFor(mode: ChatMode): AgentTool[] {
    const mcpTools = this.mcp
      .tools()
      .filter((tool) => tool.server !== EPLAN_SERVER_ID || eplanToolInMode(tool.tool, mode));
    const skillTools =
      mode === "consult" && this.skills.loaded().length > 0 ? [this.skills.readTool()] : [];
    return [...mcpTools, ...skillTools, ...this.extraTools];
  }

  /** Starts the turn and returns at once; events follow on `chat:event`. */
  send(request: ChatSendRequest, target: WebContents): void {
    // Main keeps its own copy of the answer, built with the same reducer as the renderer, and
    // saves it as it goes: a closed window or a renderer crash loses nothing already streamed.
    let answer = assistantPlaceholder(request.turnId);
    // Saves run one after another, so an older snapshot can never overwrite a newer one.
    let saving: Promise<void> = Promise.resolve();
    const save = (message: ConversationMessage): Promise<void> => {
      saving = saving
        .then(() => this.sessions.saveMessage(request.sessionId, message))
        .catch((error: unknown) => this.logger.error("Saving a message failed", error));
      return saving;
    };
    let lastSaved = 0;
    const emit = (event: TurnEvent): void => {
      answer = applyTurnEvent(answer, event);
      // Every structural change is saved at once; streamed text at most once a second, so a
      // crash loses at most a second of it.
      const now = Date.now();
      if (event.type !== "text-delta" || now - lastSaved >= TEXT_SAVE_INTERVAL_MS) {
        lastSaved = now;
        void save(answer);
      }
      if (!target.isDestroyed()) {
        target.send(ipcChannels.chatEvent, ChatEvent.parse({ turnId: request.turnId, ...event }));
      }
    };

    const question = request.messages.at(-1)?.content ?? "";
    saving = this.sessions
      .createSession(request.sessionId, titleFrom(question))
      .catch((error: unknown) => this.logger.error("Saving the session failed", error));
    void save(userMessage(request.userMessageId, question));
    const started = save(answer);

    const key = keyFor(request.provider, this.credentials);
    if (key === undefined) {
      void started.then(() =>
        emit({
          type: "error",
          code: "missing_key",
          message: "No API key saved for this provider.",
        }),
      );
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
      await started;
      try {
        const model = createModel(request.provider, key, request.model);
        for await (const event of runTurn({
          model,
          messages: request.messages,
          system: systemPrompt(
            request.mode,
            request.mode === "consult" ? this.skills.loaded() : [],
          ),
          abortSignal: controller.signal,
          tools: this.toolsFor(request.mode).map((tool) =>
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
