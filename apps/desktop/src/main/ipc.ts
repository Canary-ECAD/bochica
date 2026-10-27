import { getProvider, listModels, testConnection } from "@bochica/agent";
import {
  AppInfo,
  ChatSendRequest,
  ConnectionResult,
  CredentialList,
  ipcChannels,
  ModelList,
  ProviderId,
  SetCredentialRequest,
} from "@bochica/shared";
import { app, ipcMain, type WebContents } from "electron";
import { z } from "zod";
import { type ChatService, keyFor } from "./chat";
import type { CredentialStore } from "./credentials";
import type { Logger } from "./logger";

// Requests from the renderer are untrusted input: every handler parses its argument with the
// channel's schema before using it, and parses its result before returning it.

export function registerIpc(credentials: CredentialStore, chat: ChatService, logger: Logger): void {
  const handle = (
    channel: string,
    handler: (arg: unknown, sender: WebContents) => unknown,
  ): void => {
    ipcMain.handle(channel, async (event, arg: unknown) => {
      try {
        return await handler(arg, event.sender);
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
    const key = keyFor(provider.id, credentials);
    if (key === undefined) return ConnectionResult.parse({ status: "missing_key" });
    const result = await testConnection(provider, key);
    if (provider.auth === "api_key" && (result.status === "ok" || result.status === "invalid")) {
      credentials.setStatus(provider.id, result.status);
    }
    return ConnectionResult.parse(result);
  });

  handle(ipcChannels.modelsList, async (arg) => {
    const provider = ProviderId.parse(arg);
    const key = keyFor(provider, credentials);
    if (key === undefined) throw new Error("No API key saved for this provider.");
    try {
      return ModelList.parse(await listModels(provider, key));
    } catch (error) {
      // A local server that isn't running is normal, not an error worth logging.
      if (getProvider(provider).auth === "local") return [];
      throw error;
    }
  });

  handle(ipcChannels.chatSend, (arg, sender) => {
    chat.send(ChatSendRequest.parse(arg), sender);
  });

  handle(ipcChannels.chatStop, (arg) => {
    chat.stop(z.string().parse(arg));
  });
}
