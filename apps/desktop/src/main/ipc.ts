import { getProvider, listModels, testConnection } from "@bochica/agent";
import {
  AppInfo,
  ApprovalResponse,
  ChatSendRequest,
  ConnectionResult,
  CredentialList,
  DeleteMessagesRequest,
  EplanStatus,
  ipcChannels,
  McpServerList,
  ModelList,
  ProviderId,
  RenameSessionRequest,
  SessionDetail,
  SessionSummary,
  SetCredentialRequest,
  SetMcpEnabledRequest,
} from "@bochica/shared";
import { app, ipcMain, type WebContents } from "electron";
import { z } from "zod";
import type { ApprovalService } from "./approvals";
import { type ChatService, keyFor } from "./chat";
import type { CredentialStore } from "./credentials";
import type { EplanStatusService } from "./eplan-status";
import type { Logger } from "./logger";
import type { McpService } from "./mcp-service";
import type { SessionRepository } from "./db/repository";

export interface Services {
  credentials: CredentialStore;
  chat: ChatService;
  mcp: McpService;
  approvals: ApprovalService;
  eplan: EplanStatusService;
  sessions: SessionRepository;
  logger: Logger;
}

// Requests from the renderer are untrusted input: every handler parses its argument with the
// channel's schema before using it, and parses its result before returning it.

export function registerIpc({
  credentials,
  chat,
  mcp,
  approvals,
  eplan,
  sessions,
  logger,
}: Services): void {
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

  handle(ipcChannels.mcpList, () => McpServerList.parse(mcp.list()));

  handle(ipcChannels.mcpSetEnabled, (arg) => {
    const { id, enabled } = SetMcpEnabledRequest.parse(arg);
    mcp.setEnabled(id, enabled);
    return McpServerList.parse(mcp.list());
  });

  handle(ipcChannels.sessionsList, async () =>
    SessionSummary.array().parse(await sessions.listSessions()),
  );

  handle(ipcChannels.sessionsGet, async (arg) =>
    SessionDetail.nullable().parse(await sessions.getSession(z.string().parse(arg))),
  );

  handle(ipcChannels.sessionsRename, async (arg) => {
    const { id, title } = RenameSessionRequest.parse(arg);
    await sessions.renameSession(id, title);
  });

  handle(ipcChannels.sessionsDelete, async (arg) => {
    await sessions.deleteSession(z.string().parse(arg));
  });

  handle(ipcChannels.messagesDelete, async (arg) => {
    const { sessionId, ids } = DeleteMessagesRequest.parse(arg);
    await sessions.deleteMessages(sessionId, ids);
  });

  handle(ipcChannels.eplanStatus, () => EplanStatus.parse(eplan.current()));

  handle(ipcChannels.approvalRespond, (arg) => {
    const { requestId, decision, typed } = ApprovalResponse.parse(arg);
    approvals.respond(requestId, decision, typed);
  });
}
