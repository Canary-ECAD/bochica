import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import {
  type AgentTool,
  attachMentions,
  checkPath,
  COMPACT_AT,
  compactConversation,
  contextUsage,
  contextWindowFor,
  createModel,
  estimateContext,
  expandSkillCommands,
  getProvider,
  judgeCommand,
  type McpManager,
  planModeTools,
  redactSecrets,
  runTurn,
  type SkillSet,
  subagentTool,
  systemPrompt,
  todoTool,
  total,
} from "@bochica/agent";
import { eplanToolInMode } from "@bochica/eplan";
import {
  applyTurnEvent,
  ApprovalRequest,
  assistantPlaceholder,
  ChatEvent,
  type ChatMessage,
  type ChatMode,
  type ChatSendRequest,
  type ConversationMessage,
  ipcChannels,
  parseSlashCommand,
  summaryExchange,
  titleFrom,
  type TurnEvent,
  userMessage,
} from "@bochica/shared";
import type { WebContents } from "electron";
import type { ApprovalService, Judge } from "./approvals";
import type { BackupGuard } from "./backup";
import type { CheckpointService } from "./checkpoints";
import type { CredentialStore } from "./credentials";
import type { SessionRepository } from "./db/repository";
import { builtinTools, type FolderService } from "./folders";
import type { Logger } from "./logger";
import { EPLAN_SERVER_ID } from "./mcp-service";
import type { PermissionStore } from "./permissions";
import type { SkillService } from "./skills";

const TEXT_SAVE_INTERVAL_MS = 1_000;
/** Exchanges a compaction keeps word for word. */
const KEEP_EXCHANGES = 2;

type Model = ReturnType<typeof createModel>;

export interface ChatDeps {
  credentials: CredentialStore;
  mcp: McpManager;
  approvals: ApprovalService;
  backups: BackupGuard;
  sessions: SessionRepository;
  skills: SkillService;
  folders: FolderService;
  permissions: PermissionStore;
  checkpoints: CheckpointService;
  logger: Logger;
  /** Tools that don't come from MCP servers (e.g. the dev-only approval test tool). */
  extraTools?: AgentTool[];
}

/** Runs chat turns in the main process and streams their events to the window that asked. */
export class ChatService {
  /** Turns in progress: turn id → its controller and session. */
  private readonly running = new Map<string, { controller: AbortController; sessionId: string }>();

  private readonly credentials: CredentialStore;
  private readonly mcp: McpManager;
  private readonly approvals: ApprovalService;
  private readonly backups: BackupGuard;
  private readonly sessions: SessionRepository;
  private readonly skills: SkillService;
  private readonly folders: FolderService;
  private readonly permissions: PermissionStore;
  private readonly checkpoints: CheckpointService;
  private readonly logger: Logger;
  private readonly extraTools: AgentTool[];

  constructor(deps: ChatDeps) {
    this.credentials = deps.credentials;
    this.mcp = deps.mcp;
    this.approvals = deps.approvals;
    this.backups = deps.backups;
    this.sessions = deps.sessions;
    this.skills = deps.skills;
    this.folders = deps.folders;
    this.permissions = deps.permissions;
    this.checkpoints = deps.checkpoints;
    this.logger = deps.logger;
    this.extraTools = deps.extraTools ?? [];
  }

  /**
   * The tools a mode allows. Consult: the docs and the file tools. Tasks: the docs, the EPLAN
   * tools, the file tools and PowerShell. Draw: the docs and the drawing tools. Every mode can
   * open the skills, keep a task list and hand research to a helper, which gets only the mode's
   * read-only tools. In plan mode, only what reads, plus propose_plan.
   */
  private toolsFor(
    mode: ChatMode,
    folder: string,
    skills: SkillSet,
    model: Model,
    plan: boolean,
  ): AgentTool[] {
    const mcpTools = this.mcp
      .tools()
      .filter((tool) => tool.server !== EPLAN_SERVER_ID || eplanToolInMode(tool.tool, mode));
    const builtin = builtinTools(
      mode,
      folder,
      this.folders.policy,
      process.env,
      this.permissions.denyRules(),
    );
    const own = [...mcpTools, ...skills.tools(), ...builtin, ...this.extraTools];
    const files = builtin.length > 0 ? `The user's working folder is ${folder}.` : undefined;
    const helper = subagentTool({ model, tools: own, ...(files ? { context: files } : {}) });
    const all = [...own, todoTool, helper];
    return plan ? planModeTools(all) : all;
  }

  /** Whether a turn of this session is running; rewinding waits until it isn't. */
  busy(sessionId: string): boolean {
    return [...this.running.values()].some((turn) => turn.sessionId === sessionId);
  }

  /**
   * Smart approvals: risk-free PowerShell commands go to the turn's model first when the user
   * switched it on (checked on every call, so the switch applies at once).
   */
  private judgeFor(model: Model, signal: AbortSignal): Judge {
    return async ({ server, tool, input }) => {
      if (server !== "bochica" || tool !== "powershell" || !this.permissions.smart()) return false;
      const field = (name: string) => {
        const value = (input as Record<string, unknown> | null)?.[name];
        return typeof value === "string" ? value : "";
      };
      return judgeCommand({
        model,
        command: field("command"),
        description: field("description"),
        abortSignal: signal,
      });
    };
  }

  /** Whether `@path` names a file to attach. Refused paths count, so the log says why. */
  private mentionable(folder: string): (path: string) => boolean {
    return (path) => {
      const check = checkPath(path, folder, "read", this.folders.policy);
      if ("block" in check) return true;
      return existsSync(check.path) && statSync(check.path).isFile();
    };
  }

  /** The session's folder; sessions from before S7 get the default one now. */
  private async folderOf(sessionId: string): Promise<string> {
    const saved = await this.sessions.getFolder(sessionId);
    if (saved) return saved;
    const folder = this.folders.resolve(undefined);
    await this.sessions.setFolder(sessionId, folder);
    return folder;
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
      .createSession(request.sessionId, titleFrom(question), this.folders.resolve(request.folder))
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

    const controller = new AbortController();
    this.running.set(request.turnId, { controller, sessionId: request.sessionId });
    void (async () => {
      await started;
      try {
        const model = createModel(request.provider, key, request.model);
        const approve = this.approvals.approverFor(
          request.sessionId,
          request.turnId,
          (approval) => {
            if (!target.isDestroyed()) {
              target.send(ipcChannels.approvalRequest, ApprovalRequest.parse(approval));
            }
          },
          this.judgeFor(model, controller.signal),
        );
        const plan = request.plan ?? false;
        const folder = await this.folderOf(request.sessionId);
        const skills = this.skills.available();
        const tools = this.toolsFor(request.mode, folder, skills, model, plan);
        const find = (name: string) => tools.find((t) => t.server === "bochica" && t.tool === name);
        const guides = request.mode === "consult" ? this.skills.guides() : [];
        const messages = expandSkillCommands(request.messages, (name) => skills.find(name));
        // A `/skill` command shows in the log; its instructions are already in the message.
        const command = parseSlashCommand(question);
        const called = command ? skills.find(command.name) : undefined;
        if (called) {
          const callId = `skill-${randomUUID()}`;
          emit({
            type: "tool-call",
            callId,
            server: "bochica",
            tool: "use_skill",
            input: { name: called.name },
          });
          emit({ type: "tool-result", callId, status: "ok", output: called.description });
        }
        // `@path` in the new message: read now, appended for the model only.
        const mentions = attachMentions(
          question,
          find("read_file"),
          this.mentionable(folder),
          controller.signal,
        );
        let next = await mentions.next();
        while (!next.done) {
          emit(next.value);
          // oxlint-disable-next-line no-await-in-loop
          next = await mentions.next();
        }
        const last = messages.at(-1);
        if (last && next.value)
          messages[messages.length - 1] = { ...last, content: last.content + next.value };
        const system = systemPrompt(request.mode, guides, {
          ...(find("read_file") ? { folder, terminal: Boolean(find("powershell")) } : {}),
          skills: skills.skills.filter((skill) => !guides.includes(skill)),
          plan,
        });
        // Summarise the older conversation when this turn would fill most of the window, or
        // when the user asked for it with /compact (which needs no answer from the model).
        const window = contextWindowFor(request.provider, request.contextWindow);
        const forced = command?.name === "compact";
        let estimate = estimateContext(system, tools, messages);
        // Automatically only when there is something older than the kept exchanges: a big
        // prompt with a short conversation has nothing a summary could save.
        const older = messages.length - 1 > KEEP_EXCHANGES * 2;
        if (forced || (older && total(estimate) > COMPACT_AT * window)) {
          const compacted = await this.compact(model, messages, window, forced, controller, emit);
          if (compacted) estimate = estimateContext(system, tools, compacted);
          if (compacted) messages.splice(0, messages.length, ...compacted);
        }
        if (forced) {
          emit({ type: "context", usage: contextUsage(null, window, estimate) });
          emit({ type: "turn-end", reason: controller.signal.aborted ? "aborted" : "stop" });
          return;
        }
        for await (const event of runTurn({
          model,
          messages,
          system,
          abortSignal: controller.signal,
          tools: tools
            .map((tool) =>
              tool.changesProject ? this.withBackup(tool, request.sessionId, emit) : tool,
            )
            .map((tool) =>
              tool.writes ? this.withCheckpoint(tool, request.sessionId, request.turnId) : tool,
            ),
          approve,
        })) {
          if (event.type === "error") {
            this.logger.error(
              `Turn failed (${request.provider}/${request.model}): ${event.code}`,
              event.message,
            );
          }
          if (event.type === "turn-end" && event.reason !== "aborted") {
            const reported = event.usage?.contextTokens;
            emit({ type: "context", usage: contextUsage(reported, window, estimate) });
          }
          emit(event);
        }
      } finally {
        this.running.delete(request.turnId);
      }
    })();
  }

  /**
   * Summarises all but the last exchanges (all of them for /compact) and returns the history to
   * send instead, or null when there was nothing to summarise or it failed. Either way the log
   * shows what happened, and a failure never stops the turn.
   */
  private async compact(
    model: Model,
    messages: ChatMessage[],
    window: number,
    forced: boolean,
    controller: AbortController,
    emit: (event: TurnEvent) => void,
  ): Promise<ChatMessage[] | null> {
    const callId = `compact-${randomUUID()}`;
    emit({ type: "tool-call", callId, server: "bochica", tool: "compact_context", input: {} });
    try {
      const result = await compactConversation({
        model,
        history: messages.slice(0, -1),
        keep: forced ? 0 : KEEP_EXCHANGES,
        // The transcript to summarise must itself fit: about 70 % of the window.
        maxChars: Math.floor(window * 2.5),
        abortSignal: controller.signal,
      });
      if (!result) {
        emit({ type: "tool-result", callId, status: "ok", output: "Nothing to summarise yet." });
        return null;
      }
      emit({ type: "compacted", compaction: result.compaction });
      emit({ type: "tool-result", callId, status: "ok", output: result.compaction.summary });
      const last = messages.at(-1);
      return [
        ...summaryExchange(result.compaction.summary),
        ...result.kept,
        ...(last ? [last] : []),
      ];
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      this.logger.error("Compacting the conversation failed", message);
      emit({ type: "tool-result", callId, status: "error", output: message });
      return null;
    }
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

  /**
   * Checkpoints: after approval and right before the file changes, what it holds now is saved
   * (only the first time per turn). A failed save is logged and the change still runs.
   */
  private withCheckpoint(tool: AgentTool, sessionId: string, turnId: string): AgentTool {
    return {
      ...tool,
      execute: async (input, signal) => {
        const path = tool.writes?.(input);
        if (path) {
          await this.checkpoints
            .record(sessionId, turnId, path)
            .catch((error: unknown) => this.logger.error("Saving a checkpoint failed", error));
        }
        return tool.execute(input, signal);
      },
    };
  }

  stop(turnId: string): void {
    this.approvals.cancelTurn(turnId);
    this.running.get(turnId)?.controller.abort();
  }

  stopAll(): void {
    for (const [turnId, { controller }] of this.running) {
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
