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
  sessionsList: "sessions:list",
  sessionsGet: "sessions:get",
  sessionsRename: "sessions:rename",
  sessionsDelete: "sessions:delete",
  messagesDelete: "messages:delete",
  eplanStatus: "eplan:status",
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

export const ModelInfo = z.object({ id: z.string(), label: z.string() });
export type ModelInfo = z.infer<typeof ModelInfo>;

export const ModelList = z.array(ModelInfo);

export const ChatMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatSendRequest = z.object({
  /** Chosen by the renderer; every event of this turn carries it. */
  turnId: z.string().min(1),
  /** Saved under this id; "Allow for this session" approvals are scoped to it too. */
  sessionId: z.string().min(1),
  /** Id of the new user message, the last entry of `messages`. */
  userMessageId: z.string().min(1),
  provider: ProviderId,
  model: z.string().min(1),
  messages: z.array(ChatMessage).min(1),
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

export const TurnEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text-delta"), text: z.string() }),
  z.object({
    type: z.literal("turn-end"),
    reason: z.enum(["stop", "length", "aborted"]),
    usage: z
      .object({ inputTokens: z.number().nullable(), outputTokens: z.number().nullable() })
      .optional(),
  }),
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
    status: z.enum(["ok", "error", "denied"]),
    /** Redacted and truncated for display. */
    output: z.string(),
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

// Approvals (guardrails layer 5).

export const ApprovalRequest = z.object({
  requestId: z.string(),
  turnId: z.string(),
  server: z.string(),
  tool: z.string(),
  input: z.unknown(),
  /** False for tools that must ask every time: the card hides "Allow for this session". */
  allowSession: z.boolean(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const ApprovalDecision = z.enum(["once", "session", "deny"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const ApprovalResponse = z.object({ requestId: z.string(), decision: ApprovalDecision });
export type ApprovalResponse = z.infer<typeof ApprovalResponse>;

// EPLAN connection.

export const EplanStatus = z.object({
  state: z.enum([
    /** The local EPLAN server isn't set up on this machine. */
    "not_configured",
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
  eplan: {
    status(): Promise<EplanStatus>;
    onStatus(listener: (status: EplanStatus) => void): () => void;
  };
}
