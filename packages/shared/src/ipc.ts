import { z } from "zod";

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
]);
export type TurnEvent = z.infer<typeof TurnEvent>;

export const ChatEvent = z.intersection(z.object({ turnId: z.string() }), TurnEvent);
export type ChatEvent = z.infer<typeof ChatEvent>;

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
}
