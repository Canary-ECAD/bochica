import { getProvider, testConnection } from "@bochica/agent";
import {
  AppInfo,
  ConnectionResult,
  CredentialList,
  ipcChannels,
  ProviderId,
  SetCredentialRequest,
} from "@bochica/shared";
import { app, ipcMain } from "electron";
import { z } from "zod";
import type { CredentialStore } from "./credentials";
import type { Logger } from "./logger";

// Requests from the renderer are untrusted input: every handler parses its argument with the
// channel's schema before using it, and parses its result before returning it.

export function registerIpc(credentials: CredentialStore, logger: Logger): void {
  const handle = (channel: string, handler: (arg: unknown) => unknown): void => {
    ipcMain.handle(channel, async (_event, arg: unknown) => {
      try {
        return await handler(arg);
      } catch (error) {
        logger.error(`IPC ${channel} failed`, error);
        throw error;
      }
    });
  };

  handle(ipcChannels.appInfo, () =>
    AppInfo.parse({ name: app.getName(), version: app.getVersion(), platform: process.platform }),
  );

  handle(ipcChannels.credentialsList, () => CredentialList.parse(credentials.list()));

  handle(ipcChannels.credentialsSet, (arg) => {
    const { provider, secret } = SetCredentialRequest.parse(arg);
    credentials.save(provider, secret);
    return CredentialList.parse(credentials.list());
  });

  handle(ipcChannels.credentialsDelete, (arg) => {
    credentials.remove(z.string().parse(arg));
    return CredentialList.parse(credentials.list());
  });

  handle(ipcChannels.credentialsTest, async (arg) => {
    const provider = getProvider(ProviderId.parse(arg));
    let key = "";
    if (provider.auth === "api_key") {
      const resolved = credentials.resolve(provider.id);
      if (!resolved) return ConnectionResult.parse({ status: "missing_key" });
      key = resolved;
    }
    const result = await testConnection(provider, key);
    if (provider.auth === "api_key" && (result.status === "ok" || result.status === "invalid")) {
      credentials.setStatus(provider.id, result.status);
    }
    return ConnectionResult.parse(result);
  });
}
