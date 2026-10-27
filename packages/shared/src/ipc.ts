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
}
