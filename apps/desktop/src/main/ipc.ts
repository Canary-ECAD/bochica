import { findFiles, getProvider, listModels, testConnection } from "@bochica/agent";
import {
  AppInfo,
  ApprovalResponse,
  ChatSendRequest,
  ConnectionResult,
  CredentialList,
  DeleteMessagesRequest,
  EplanStatus,
  FileSearchRequest,
  ipcChannels,
  McpServerList,
  ModelList,
  ProviderId,
  RenameSessionRequest,
  SessionDetail,
  SessionSummary,
  SetCredentialRequest,
  SetMcpEnabledRequest,
  SetSkillEnabledRequest,
  SkillInstallReport,
  SkillList,
} from "@bochica/shared";
import { app, BrowserWindow, dialog, ipcMain, type WebContents } from "electron";
import { z } from "zod";
import type { ApprovalService } from "./approvals";
import { type ChatService, keyFor } from "./chat";
import type { CredentialStore } from "./credentials";
import type { EplanStatusService } from "./eplan-status";
import type { FolderService } from "./folders";
import type { Logger } from "./logger";
import type { McpService } from "./mcp-service";
import type { SessionRepository } from "./db/repository";
import type { SkillService } from "./skills";

export interface Services {
  credentials: CredentialStore;
  chat: ChatService;
  mcp: McpService;
  approvals: ApprovalService;
  eplan: EplanStatusService;
  sessions: SessionRepository;
  folders: FolderService;
  skills: SkillService;
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
  folders,
  skills,
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

  handle(ipcChannels.foldersDefault, () => folders.defaultFolder());

  handle(ipcChannels.foldersPick, async (arg, sender) => {
    const current = z.string().optional().parse(arg);
    const window = BrowserWindow.fromWebContents(sender);
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory", "promptToCreate"],
      defaultPath: current && folders.usable(current) ? current : folders.resolve(undefined),
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const [picked] = result.filePaths;
    if (result.canceled || !picked) return null;
    // Protected places (Windows, Program Files, credential folders) can't be working folders.
    if (!folders.usable(picked)) {
      logger.info("A protected folder was picked as working folder; ignored");
      return null;
    }
    return picked;
  });

  // The renderer names the folder (its session's); it must be one a session could work in.
  handle(ipcChannels.filesSearch, async (arg) => {
    const { folder, query } = FileSearchRequest.parse(arg);
    if (!folders.usable(folder)) return [];
    const files = await findFiles(
      { cwd: folder, policy: folders.policy },
      query,
      AbortSignal.timeout(5_000),
    );
    return z.array(z.string()).parse(files);
  });

  handle(ipcChannels.skillsList, () => SkillList.parse(skills.list()));

  handle(ipcChannels.skillsInstall, async (_arg, sender) => {
    const window = BrowserWindow.fromWebContents(sender);
    const options: Electron.OpenDialogOptions = { properties: ["openDirectory"] };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const [picked] = result.filePaths;
    if (result.canceled || !picked) return null;
    const report = await skills.install(picked);
    if (report.installed.length > 0) logger.info(`Added skill(s): ${report.installed.join(", ")}`);
    for (const { folder, problem } of report.refused) {
      logger.info(`Skill folder ${folder} refused: ${problem}`);
    }
    return SkillInstallReport.parse(report);
  });

  handle(ipcChannels.skillsRemove, async (arg) => {
    await skills.remove(z.string().parse(arg));
    return SkillList.parse(skills.list());
  });

  handle(ipcChannels.skillsSetEnabled, (arg) => {
    const { id, enabled } = SetSkillEnabledRequest.parse(arg);
    skills.setEnabled(id, enabled);
    return SkillList.parse(skills.list());
  });

  handle(ipcChannels.approvalRespond, (arg) => {
    const { requestId, decision, typed } = ApprovalResponse.parse(arg);
    approvals.respond(requestId, decision, typed);
  });
}
