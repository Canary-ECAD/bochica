import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";
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
  Onboarding,
  Permissions,
  ProviderId,
  RenameSessionRequest,
  RewindPreview,
  RewindPreviewRequest,
  RewindRequest,
  RewindResult,
  SessionDetail,
  SessionSummary,
  SetAutoRequest,
  LoginRequest,
  LoginResult,
  SetCredentialRequest,
  TestCredentialRequest,
  UpdateCredentialRequest,
  SetMcpEnabledRequest,
  SetSkillEnabledRequest,
  SkillInstallReport,
  SkillList,
  UpdateStatus,
} from "@bochica/shared";
import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from "electron";
import { z } from "zod";
import type { ApprovalService } from "./approvals";
import { type ChatService, keyFor } from "./chat";
import type { CheckpointService } from "./checkpoints";
import type { ClaudeCodeService } from "./claude-code";
import type { CredentialStore } from "./credentials";
import type { EplanStatusService } from "./eplan-status";
import type { FolderService } from "./folders";
import type { Logger } from "./logger";
import type { LoginService } from "./logins";
import type { McpService } from "./mcp-service";
import type { PermissionStore } from "./permissions";
import type { SessionRepository } from "./db/repository";
import type { SettingsStore } from "./settings";
import type { SkillService } from "./skills";
import type { UpdateService } from "./updates";

export interface Services {
  credentials: CredentialStore;
  claudeCode: ClaudeCodeService;
  logins: LoginService;
  chat: ChatService;
  mcp: McpService;
  approvals: ApprovalService;
  eplan: EplanStatusService;
  sessions: SessionRepository;
  folders: FolderService;
  skills: SkillService;
  permissions: PermissionStore;
  checkpoints: CheckpointService;
  settings: SettingsStore;
  updates: UpdateService;
  logger: Logger;
}

// Requests from the renderer are untrusted input: every handler parses its argument with the
// channel's schema before using it, and parses its result before returning it.

export function registerIpc({
  credentials,
  claudeCode,
  logins,
  chat,
  mcp,
  approvals,
  eplan,
  sessions,
  folders,
  skills,
  permissions,
  checkpoints,
  settings,
  updates,
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

  // People who used Bochica before the guide existed already have a key: they don't need it.
  handle(ipcChannels.onboardingGet, () =>
    Onboarding.parse({ done: settings.onboarded() ?? credentials.list().length > 0 }),
  );

  handle(ipcChannels.onboardingSet, (arg) => {
    settings.setOnboarded(Onboarding.parse(arg).done);
  });

  handle(ipcChannels.credentialsSet, (arg) => {
    const { provider, secret, label } = SetCredentialRequest.parse(arg);
    credentials.add(provider, secret, label);
    return CredentialList.parse(credentials.list());
  });

  handle(ipcChannels.credentialsUpdate, (arg) => {
    const { id, ...change } = UpdateCredentialRequest.parse(arg);
    credentials.update(id, change);
    return CredentialList.parse(credentials.list());
  });

  handle(ipcChannels.credentialsLogin, async (arg) => {
    const request = LoginRequest.parse(arg);
    const result = await logins.start(request);
    return LoginResult.parse(
      result.status === "ok" ? { ...result, credentials: credentials.list() } : result,
    );
  });

  handle(ipcChannels.credentialsLoginCancel, () => {
    logins.cancel();
  });

  handle(ipcChannels.credentialsDelete, (arg) => {
    credentials.remove(z.string().parse(arg));
    return CredentialList.parse(credentials.list());
  });

  handle(ipcChannels.credentialsTest, async (arg) => {
    const request = TestCredentialRequest.parse(arg);
    const provider = getProvider(request.provider);
    if (provider.auth === "claude_code") return ConnectionResult.parse(await claudeCode.status());
    const local = provider.auth === "local";
    const entry = local ? undefined : credentials.inUse(provider.id, request.id);
    if (!local && !entry) return ConnectionResult.parse({ status: "missing_key" });
    const result = await testConnection(provider, entry?.key ?? "");
    if (entry && (result.status === "ok" || result.status === "invalid")) {
      credentials.setStatus(entry.id, result.status);
    }
    return ConnectionResult.parse(result);
  });

  handle(ipcChannels.modelsList, async (arg) => {
    const provider = ProviderId.parse(arg);
    if (getProvider(provider).auth === "claude_code") {
      return ModelList.parse(await claudeCode.models().catch(() => []));
    }
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

  handle(ipcChannels.updatesGet, () => UpdateStatus.parse(updates.current()));
  handle(ipcChannels.updatesCheck, async () => UpdateStatus.parse(await updates.check(true)));
  handle(ipcChannels.updatesInstall, () => UpdateStatus.parse(updates.install()));
  handle(ipcChannels.updatesLater, () => UpdateStatus.parse(updates.later()));

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

  // Only report files the parts doctor wrote, in a folder a session could work in.
  handle(ipcChannels.filesOpenReport, async (arg) => {
    const path = z.string().max(2_000).parse(arg);
    if (!isAbsolute(path) || !/^parts-report-\d{8}-\d{6}\.csv$/.test(basename(path))) return;
    if (!folders.usable(dirname(path)) || !existsSync(path)) return;
    const error = await shell.openPath(path);
    if (error) logger.error("Opening the parts report failed", error);
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

  handle(ipcChannels.approvalsSetAuto, (arg) => {
    const { sessionId, on } = SetAutoRequest.parse(arg);
    approvals.setAuto(sessionId, on);
    logger.info(`Auto mode ${on ? "on" : "off"} for a session`);
  });

  handle(ipcChannels.permissionsGet, () => Permissions.parse(permissions.get()));

  handle(ipcChannels.permissionsSet, (arg) =>
    Permissions.parse(permissions.set(Permissions.parse(arg))),
  );

  handle(ipcChannels.checkpointsPreview, async (arg) => {
    const { sessionId, messageId } = RewindPreviewRequest.parse(arg);
    if (chat.busy(sessionId)) throw new Error("A turn of this session is still running.");
    return RewindPreview.parse(await checkpoints.preview(sessionId, messageId));
  });

  handle(ipcChannels.checkpointsRewind, async (arg) => {
    const request = RewindRequest.parse(arg);
    if (chat.busy(request.sessionId)) throw new Error("A turn of this session is still running.");
    const result = await checkpoints.rewind(request);
    logger.info(
      `Rewound a session (${request.restore}): ${result.restored} file(s) restored, ${result.failed.length} failed`,
    );
    return RewindResult.parse(result);
  });
}
