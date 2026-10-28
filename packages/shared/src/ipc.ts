import { z } from "zod";
import type { SessionDetail, SessionSummary } from "./conversation";

// Every IPC channel is declared here once. The main process validates what it receives and
// returns, and the preload validates what it receives, so a contract change breaks the
// typecheck on both ends.

export const ipcChannels = {
  appInfo: "app:info",
  credentialsList: "credentials:list",
  credentialsSet: "credentials:set",
  credentialsDelete: "credentials:delete",
  credentialsTest: "credentials:test",
  modelsList: "models:list",
  chatSend: "chat:send",
  chatStop: "chat:stop",
  /** Main → renderer: one message per streamed event. */
  chatEvent: "chat:event",
  mcpList: "mcp:list",
  mcpSetEnabled: "mcp:set-enabled",
  /** Main → renderer: the server list changed (status, tools, enabled). */
  mcpChanged: "mcp:changed",
  /** Main → renderer: a tool call waits for the user's decision. */
  approvalRequest: "approval:request",
  approvalRespond: "approval:respond",
  /** Auto mode of a session (guardrails layer 5 skipped), on or off. */
  approvalsSetAuto: "approvals:set-auto",
  permissionsGet: "permissions:get",
  permissionsSet: "permissions:set",
  checkpointsPreview: "checkpoints:preview",
  checkpointsRewind: "checkpoints:rewind",
  sessionsList: "sessions:list",
  sessionsGet: "sessions:get",
  sessionsRename: "sessions:rename",
  sessionsDelete: "sessions:delete",
  messagesDelete: "messages:delete",
  eplanStatus: "eplan:status",
  onboardingGet: "onboarding:get",
  onboardingSet: "onboarding:set",
  foldersDefault: "folders:default",
  foldersPick: "folders:pick",
  filesSearch: "files:search",
  skillsList: "skills:list",
  skillsInstall: "skills:install",
  skillsRemove: "skills:remove",
  skillsSetEnabled: "skills:set-enabled",
  /** Main → renderer: the EPLAN connection changed. */
  eplanStatusChanged: "eplan:status-changed",
} as const;

export const AppInfo = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
});
export type AppInfo = z.infer<typeof AppInfo>;

export const ProviderId = z.enum([
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "ollama",
  "lmstudio",
]);
export type ProviderId = z.infer<typeof ProviderId>;

// Credentials. Responses carry metadata and a masked preview only; the key itself never
// leaves the main process.

export const CredentialInfo = z.object({
  id: z.string(),
  provider: ProviderId,
  kind: z.literal("api_key"),
  label: z.string(),
  source: z.enum(["app", "env"]),
  /** Lower is tried first. */
  priority: z.number().int(),
  status: z.enum(["unknown", "ok", "invalid"]),
  /** e.g. `sk-ant-…a1b2`, or the variable name for keys from the environment. */
  preview: z.string(),
});
export type CredentialInfo = z.infer<typeof CredentialInfo>;

export const CredentialList = z.array(CredentialInfo);

export const SetCredentialRequest = z.object({
  provider: ProviderId,
  secret: z.string().trim().min(8).max(512),
});
export type SetCredentialRequest = z.infer<typeof SetCredentialRequest>;

export const ConnectionResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok") }),
  z.object({ status: z.literal("invalid") }),
  z.object({ status: z.literal("missing_key") }),
  z.object({ status: z.literal("network_error") }),
  z.object({ status: z.literal("error"), httpStatus: z.number().int() }),
]);
export type ConnectionResult = z.infer<typeof ConnectionResult>;

// Models and chat.

export const ModelInfo = z.object({
  id: z.string(),
  label: z.string(),
  /** Tokens the model can take in, when the provider's list says so. */
  contextWindow: z.number().int().positive().optional(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export const ModelList = z.array(ModelInfo);

export const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  /** The saved message's id, on user messages: compaction records where it kept from. */
  id: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/**
 * What the agent may do this turn. consult: answer and help with scripts, no EPLAN tools.
 * tasks: work in EPLAN. draw: the experimental drawing tools.
 */
export const ChatMode = z.enum(["consult", "tasks", "draw"]);
export type ChatMode = z.infer<typeof ChatMode>;

export const ChatSendRequest = z.object({
  /** Chosen by the renderer; every event of this turn carries it. */
  turnId: z.string().min(1),
  /** Saved under this id; "Allow for this session" approvals are scoped to it too. */
  sessionId: z.string().min(1),
  /** Id of the new user message, the last entry of `messages`. */
  userMessageId: z.string().min(1),
  mode: ChatMode,
  provider: ProviderId,
  model: z.string().min(1),
  messages: z.array(ChatMessage).min(1),
  /**
   * The working folder for a new session. Ignored once the session has one: main keeps the
   * folder it saved, so a session never moves.
   */
  folder: z.string().min(1).max(1_000).optional(),
  /** The model's context window, when the model list gave one; main has defaults. */
  contextWindow: z.number().int().positive().max(100_000_000).optional(),
  /** Plan mode: only tools that read, and the model proposes a plan instead of acting. */
  plan: z.boolean().optional(),
});
export type ChatSendRequest = z.infer<typeof ChatSendRequest>;

export const ChatErrorCode = z.enum([
  "missing_key",
  "invalid_key",
  "rate_limit",
  "model_not_found",
  "provider_unavailable",
  "network",
  "unknown",
]);
export type ChatErrorCode = z.infer<typeof ChatErrorCode>;

/**
 * How a tool call ended. "denied": the user said no. "blocked": Bochica refused it before
 * asking anyone (guardrails layers 1, 2 and 4).
 */
export const ToolStatus = z.enum(["ok", "error", "denied", "blocked"]);
export type ToolStatus = z.infer<typeof ToolStatus>;

/** Lines a file write added and removed, with a short unified patch. */
export const FileDiff = z.object({
  path: z.string(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  patch: z.string(),
});
export type FileDiff = z.infer<typeof FileDiff>;

/**
 * Why a call ran without a card: one of the user's "Always allow" rules, smart approval (the
 * model judged the command harmless), or the session's Auto mode.
 */
export const AutoApproval = z.enum(["rule", "smart", "auto"]);
export type AutoApproval = z.infer<typeof AutoApproval>;

/**
 * How full the model's context was at the end of a turn: `used` is what the provider reported
 * for the last model call; the three parts are Bochica's estimate of how it splits.
 */
export const ContextUsage = z.object({
  used: z.number().int().nonnegative(),
  window: z.number().int().positive(),
  instructions: z.number().int().nonnegative(),
  tools: z.number().int().nonnegative(),
  conversation: z.number().int().nonnegative(),
});
export type ContextUsage = z.infer<typeof ContextUsage>;

/**
 * The older conversation, summarised. From this turn on the model gets the summary, then the
 * exchanges from the user message `from` (or this turn's, without it), then the new message.
 */
export const Compaction = z.object({
  summary: z.string(),
  from: z.string().optional(),
});
export type Compaction = z.infer<typeof Compaction>;

export const TurnEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text-delta"), text: z.string() }),
  z.object({
    type: z.literal("turn-end"),
    reason: z.enum(["stop", "length", "aborted"]),
    usage: z
      .object({
        inputTokens: z.number().nullable(),
        outputTokens: z.number().nullable(),
        /** Input plus output of the last model call: what is really in the context. */
        contextTokens: z.number().nullable().optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal("context"), usage: ContextUsage }),
  z.object({ type: z.literal("compacted"), compaction: Compaction }),
  /** `message` has already been through redaction; it is shown under "Details" only. */
  z.object({ type: z.literal("error"), code: ChatErrorCode, message: z.string() }),
  z.object({
    type: z.literal("tool-call"),
    callId: z.string(),
    /** MCP server id, or "bochica" for built-in tools. */
    server: z.string(),
    tool: z.string(),
    input: z.unknown(),
  }),
  z.object({
    type: z.literal("tool-result"),
    callId: z.string(),
    status: ToolStatus,
    /** Redacted and truncated for display. */
    output: z.string(),
    /** Why Bochica refused the call (status "blocked"), e.g. "system-delete". */
    blocked: z.string().optional(),
    /** What a file write changed. */
    diff: FileDiff.optional(),
    /** Set when the call was allowed without asking the user. */
    auto: AutoApproval.optional(),
  }),
]);
export type TurnEvent = z.infer<typeof TurnEvent>;

export const ChatEvent = z.intersection(z.object({ turnId: z.string() }), TurnEvent);
export type ChatEvent = z.infer<typeof ChatEvent>;

// MCP servers.

export const McpServerInfo = z.object({
  id: z.string(),
  url: z.string().optional(),
  required: z.boolean(),
  enabled: z.boolean(),
  state: z.enum(["not_configured", "disabled", "connecting", "ready", "error"]),
  toolCount: z.number().int(),
  /** Plain reason of the last failure, already redacted. */
  error: z.string().optional(),
});
export type McpServerInfo = z.infer<typeof McpServerInfo>;

export const McpServerList = z.array(McpServerInfo);

export const SetMcpEnabledRequest = z.object({ id: z.string(), enabled: z.boolean() });
export type SetMcpEnabledRequest = z.infer<typeof SetMcpEnabledRequest>;

// Approvals (guardrails layer 5) and typed confirmation (layer 6).

/**
 * What the user must type before a destructive action runs: the name of what will be
 * destroyed, or, when there is no single name, the word DELETE / ELIMINAR.
 */
export const Confirmation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("name"), value: z.string().min(1) }),
  z.object({ type: z.literal("word") }),
]);
export type Confirmation = z.infer<typeof Confirmation>;

const CONFIRM_WORDS = new Set(["DELETE", "ELIMINAR"]);

/** Whether the typed text confirms. Used by the card (button) and by main (enforcement). */
export function confirmationMatches(confirmation: Confirmation, typed: string): boolean {
  const text = typed.trim();
  return confirmation.type === "name"
    ? text === confirmation.value
    : CONFIRM_WORDS.has(text.toUpperCase());
}

export const ApprovalRequest = z.object({
  requestId: z.string(),
  turnId: z.string(),
  server: z.string(),
  tool: z.string(),
  input: z.unknown(),
  /** False for tools that must ask every time: the card hides "Allow for this session". */
  allowSession: z.boolean(),
  /** Whether the card offers "Always allow" (the same calls that may be allowed for the session). */
  allowAlways: z.boolean(),
  /** How many times the user allowed this command or tool before, when it may be always allowed. */
  allowedBefore: z.number().int().nonnegative().optional(),
  /** Present for destructive actions: the card asks the user to type this first. */
  confirm: Confirmation.optional(),
  /** Why Bochica flagged this call, e.g. "recursive-delete"; the card explains each one. */
  risks: z.array(z.string()).optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const ApprovalDecision = z.enum(["once", "session", "always", "deny"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalResponse = z.object({
  requestId: z.string(),
  decision: ApprovalDecision,
  /** What the user typed, for requests with `confirm`. */
  typed: z.string().max(500).optional(),
});
export type ApprovalResponse = z.infer<typeof ApprovalResponse>;

export const SetAutoRequest = z.object({ sessionId: z.string().min(1), on: z.boolean() });
export type SetAutoRequest = z.infer<typeof SetAutoRequest>;

// Permissions the user set in Settings (guardrails layers 3 and 5).

/** A call the user always allows: one exact PowerShell command, or every call of a tool. */
export const AlwaysAllowRule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("command"), command: z.string().min(1).max(4_000) }),
  z.object({ kind: z.literal("tool"), server: z.string().min(1), tool: z.string().min(1) }),
]);
export type AlwaysAllowRule = z.infer<typeof AlwaysAllowRule>;

export const DenyRule = z.string().trim().min(1).max(200);

export const Permissions = z.object({
  alwaysAllow: z.array(AlwaysAllowRule).max(500),
  /** Glob patterns (`*`, `?`) of commands that are never allowed. */
  denyRules: z.array(DenyRule).max(100),
  /** Smart approvals: the model may let clearly harmless commands run without a card. */
  smart: z.boolean(),
});
export type Permissions = z.infer<typeof Permissions>;

// Checkpoints and rewind.

export const RewindPreviewRequest = z.object({
  sessionId: z.string().min(1),
  /** The user message to go back to: it and everything after it are undone. */
  messageId: z.string().min(1),
});
export type RewindPreviewRequest = z.infer<typeof RewindPreviewRequest>;

export const RewindPreview = z.object({
  /** Files the agent's file tools changed since that message, and what rewinding does to each. */
  files: z.array(
    z.object({
      path: z.string(),
      /** restore: put back what it held. delete: it didn't exist. too-large: not saved. */
      change: z.enum(["restore", "delete", "too-large"]),
    }),
  ),
  /** Changes made in EPLAN since then, which rewinding can't undo. */
  eplanChanges: z.boolean(),
  /** PowerShell commands ran since then; what they changed isn't tracked. */
  commands: z.boolean(),
  /** Backups Bochica made of EPLAN projects in this session. */
  backups: z.array(z.string()),
});
export type RewindPreview = z.infer<typeof RewindPreview>;

export const RewindRequest = RewindPreviewRequest.extend({
  /** all: conversation and files. */
  restore: z.enum(["all", "conversation", "files"]),
});
export type RewindRequest = z.infer<typeof RewindRequest>;

export const RewindResult = z.object({
  restored: z.number().int().nonnegative(),
  /** Files that couldn't be put back. */
  failed: z.array(z.string()),
});
export type RewindResult = z.infer<typeof RewindResult>;

// EPLAN connection.

export const EplanStatus = z.object({
  state: z.enum([
    /** The bundled EPLAN server is missing: a broken install. */
    "not_configured",
    /** EPLAN isn't installed on this machine. */
    "not_installed",
    "starting",
    /** EPLAN isn't running. */
    "closed",
    /** EPLAN runs but refuses the connection: Remote Client is probably off. */
    "unreachable",
    /** Connected, but EPLAN doesn't answer (a dialog is open or it is busy). */
    "busy",
    "connected",
    "error",
  ]),
  version: z.string().optional(),
  /** Already redacted. */
  detail: z.string().optional(),
});
export type EplanStatus = z.infer<typeof EplanStatus>;

// First-run wizard.

export const Onboarding = z.object({
  /** False: the welcome guide is shown instead of the app. */
  done: z.boolean(),
});
export type Onboarding = z.infer<typeof Onboarding>;

// Saved sessions.

export const RenameSessionRequest = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(120),
});
export type RenameSessionRequest = z.infer<typeof RenameSessionRequest>;

export const DeleteMessagesRequest = z.object({
  sessionId: z.string(),
  ids: z.array(z.string()).min(1),
});
export type DeleteMessagesRequest = z.infer<typeof DeleteMessagesRequest>;

// Skills.

/** Something in a skill's Markdown that looks like prompt injection (guardrails layer 8). */
export const SkillFinding = z.object({
  kind: z.enum(["override", "hidden-comment", "secret-read", "exfiltration", "invisible-chars"]),
  /** The file, relative to the skill's folder. */
  file: z.string(),
  line: z.number().int(),
});
export type SkillFinding = z.infer<typeof SkillFinding>;

/** Why a skill can't be added or loaded. */
export const SkillProblem = z.enum([
  "no-skill-file",
  "no-front-matter",
  "bad-name",
  "missing-description",
  "long-description",
  "too-large",
  "injection",
  "name-taken",
]);
export type SkillProblem = z.infer<typeof SkillProblem>;

export const SkillInfo = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** builtin: the EPLAN scripting guides, always on. user: added in Settings. */
  source: z.enum(["builtin", "user"]),
  enabled: z.boolean(),
  /**
   * skipped: left out by the injection scan. invalid: its SKILL.md is broken. missing: a
   * built-in skill Bochica couldn't find or download.
   */
  status: z.enum(["ok", "skipped", "invalid", "missing"]),
  findings: z.array(SkillFinding).optional(),
  problem: SkillProblem.optional(),
});
export type SkillInfo = z.infer<typeof SkillInfo>;

export const SkillList = z.array(SkillInfo);

/** What "Add skill" did: the names added, and each folder refused with why. */
export const SkillInstallReport = z.object({
  installed: z.array(z.string()),
  refused: z.array(
    z.object({
      folder: z.string(),
      problem: SkillProblem,
      findings: z.array(SkillFinding).optional(),
    }),
  ),
});
export type SkillInstallReport = z.infer<typeof SkillInstallReport>;

export const SetSkillEnabledRequest = z.object({ id: z.string(), enabled: z.boolean() });
export type SetSkillEnabledRequest = z.infer<typeof SetSkillEnabledRequest>;

// Files of the working folder, for @ mentions.

export const FileSearchRequest = z.object({
  folder: z.string().min(1).max(1_000),
  query: z.string().max(200),
});
export type FileSearchRequest = z.infer<typeof FileSearchRequest>;

/** The API the preload exposes on `window.bochica`. */
export interface BochicaApi {
  getAppInfo(): Promise<AppInfo>;
  credentials: {
    list(): Promise<CredentialInfo[]>;
    /** Saves the key for a provider, replacing the previous one. Returns the updated list. */
    set(request: SetCredentialRequest): Promise<CredentialInfo[]>;
    remove(id: string): Promise<CredentialInfo[]>;
    test(provider: ProviderId): Promise<ConnectionResult>;
  };
  models: {
    /** Chat models the provider offers with the configured key. Rejects if it can't list them. */
    list(provider: ProviderId): Promise<ModelInfo[]>;
  };
  chat: {
    /** Starts a turn; its output arrives through `onEvent`. */
    send(request: ChatSendRequest): Promise<void>;
    stop(turnId: string): Promise<void>;
    /** Subscribes to events of every turn. Returns the unsubscribe function. */
    onEvent(listener: (event: ChatEvent) => void): () => void;
  };
  mcp: {
    list(): Promise<McpServerInfo[]>;
    setEnabled(request: SetMcpEnabledRequest): Promise<McpServerInfo[]>;
    onChange(listener: (servers: McpServerInfo[]) => void): () => void;
  };
  approvals: {
    onRequest(listener: (request: ApprovalRequest) => void): () => void;
    respond(response: ApprovalResponse): Promise<void>;
    /** Turns a session's Auto mode on or off; it applies at once, also to a running turn. */
    setAuto(request: SetAutoRequest): Promise<void>;
  };
  permissions: {
    get(): Promise<Permissions>;
    /** Replaces the user's rules; returns what was saved. */
    set(permissions: Permissions): Promise<Permissions>;
  };
  checkpoints: {
    /** What rewinding to a message would undo. Rejects while a turn of the session runs. */
    preview(request: RewindPreviewRequest): Promise<RewindPreview>;
    rewind(request: RewindRequest): Promise<RewindResult>;
  };
  sessions: {
    /** Saved sessions, most recently active first. */
    list(): Promise<SessionSummary[]>;
    /** A saved session with its messages, or null if it doesn't exist. */
    get(id: string): Promise<SessionDetail | null>;
    rename(request: RenameSessionRequest): Promise<void>;
    remove(id: string): Promise<void>;
    removeMessages(request: DeleteMessagesRequest): Promise<void>;
  };
  folders: {
    /** The working folder new sessions get unless the user picks another. */
    default(): Promise<string>;
    /** Opens the system folder picker; null if the user cancels. */
    pick(current?: string): Promise<string | null>;
  };
  files: {
    /** Files of a working folder whose path contains the query, as relative paths. */
    search(request: FileSearchRequest): Promise<string[]>;
  };
  skills: {
    list(): Promise<SkillInfo[]>;
    /** Opens the folder picker and adds what it finds; null if the user cancels. */
    install(): Promise<SkillInstallReport | null>;
    remove(id: string): Promise<SkillInfo[]>;
    setEnabled(request: SetSkillEnabledRequest): Promise<SkillInfo[]>;
  };
  onboarding: {
    get(): Promise<Onboarding>;
    /** Marks the welcome guide finished, or asks for it again (false). */
    set(onboarding: Onboarding): Promise<void>;
  };
  eplan: {
    status(): Promise<EplanStatus>;
    onStatus(listener: (status: EplanStatus) => void): () => void;
  };
}
