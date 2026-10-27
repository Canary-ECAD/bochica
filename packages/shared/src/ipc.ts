import { z } from "zod";

// Every IPC channel is declared here once. The main process validates what it sends and the
// preload validates what it receives, so a contract change breaks the typecheck on both ends.

export const ipcChannels = {
  appInfo: "app:info",
} as const;

export const AppInfo = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
});
export type AppInfo = z.infer<typeof AppInfo>;

/** The API the preload exposes on `window.bochica`. */
export interface BochicaApi {
  getAppInfo(): Promise<AppInfo>;
}
