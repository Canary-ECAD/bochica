import { join } from "node:path";
import { defaultPathPolicy } from "@bochica/agent";
import { componentsLock } from "@bochica/eplan";
import { EplanStatus, ipcChannels, McpServerList } from "@bochica/shared";
import { app, BrowserWindow, safeStorage, shell } from "electron";
import { ApprovalService } from "./approvals";
import { BackupGuard } from "./backup";
import { ChatService, devEchoTool } from "./chat";
import { CredentialStore } from "./credentials";
import { nodeSqliteDriver } from "./db/driver";
import { SessionRepository } from "./db/repository";
import { EplanStatusService, isEplanRunning } from "./eplan-status";
import { FolderService } from "./folders";
import { registerIpc } from "./ipc";
import { createLogger } from "./logger";
import { EPLAN_SERVER_ID, McpService } from "./mcp-service";
import { SettingsStore } from "./settings";
import { BUILTIN_SKILLS, BuiltinSkills, removeStaleCaches, SkillService } from "./skills";

const logger = createLogger(app.getPath("logs"));

process.on("uncaughtException", (error) => logger.error("Uncaught exception", error));
process.on("unhandledRejection", (reason) => logger.error("Unhandled rejection", reason));

/** Sends a main → renderer message to every open window. */
function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
}

/**
 * Where the built-in skills come from: during development, checkouts of each repository side by
 * side in BOCHICA_SKILLS_DIR; otherwise a cache of the commit pinned in components.lock.json,
 * downloaded on first use. Caches of commits no longer pinned are deleted.
 */
function builtinSkills(): BuiltinSkills[] {
  const local = process.env["BOCHICA_SKILLS_DIR"];
  const cache = join(app.getPath("userData"), "skills");
  const repositories = Object.entries(BUILTIN_SKILLS) as Array<
    [keyof typeof BUILTIN_SKILLS, readonly string[]]
  >;
  if (!local)
    removeStaleCaches(
      cache,
      repositories.map(([name]) => componentsLock[name].commit),
    );
  return repositories.map(([name, dirs]) => {
    if (local) return new BuiltinSkills(join(local, name, "skills"), dirs, null);
    const pinned = componentsLock[name];
    return new BuiltinSkills(join(cache, pinned.commit), dirs, pinned);
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "Bochica",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  window.once("ready-to-show", () => window.show());

  // The renderer never navigates away or opens windows: links go to the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", (_event, details) =>
    logger.error(`Renderer process gone: ${details.reason} (exit code ${details.exitCode})`),
  );

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  logger.info(`Starting Bochica ${app.getVersion()}`);
  const credentials = new CredentialStore(
    join(app.getPath("userData"), "credentials.json"),
    safeStorage,
  );
  const settings = new SettingsStore(join(app.getPath("userData"), "settings.json"));
  const mcp = new McpService(settings, logger);
  const approvals = new ApprovalService();
  const callEplan = (tool: string, args: Record<string, unknown>) =>
    mcp.manager.callTool(EPLAN_SERVER_ID, tool, args);
  const backups = new BackupGuard(callEplan, join(app.getPath("documents"), "Bochica", "Backups"));
  const devTools = !app.isPackaged && process.env["BOCHICA_DEV_TOOLS"] === "1" ? [devEchoTool] : [];
  const sessions = new SessionRepository(
    nodeSqliteDriver(join(app.getPath("userData"), "bochica.db")),
  );
  void sessions
    .markInterruptedTurns()
    .then((count) => count > 0 && logger.info(`Marked ${count} interrupted turn(s) as stopped`));
  const skills = new SkillService(
    builtinSkills(),
    join(app.getPath("userData"), "skills", "user"),
    settings,
  );
  void skills.load().then(() => {
    logger.info(`Skills: ${skills.available().skills.length} loaded`);
    for (const { id, findings } of skills.skipped()) {
      const where = findings.map((f) => `${f.kind} in ${f.file} at line ${f.line}`).join(", ");
      logger.error(`Skill ${id} not loaded: it looks like prompt injection (${where})`);
    }
  });
  const folders = new FolderService(
    app.getPath("documents"),
    defaultPathPolicy(process.env, app.getPath("userData")),
  );
  const chat = new ChatService({
    credentials,
    mcp: mcp.manager,
    approvals,
    backups,
    sessions,
    skills,
    folders,
    logger,
    extraTools: devTools,
  });

  const eplan = new EplanStatusService(
    {
      configured: () => mcp.eplanConfigured(),
      serverState: () => mcp.manager.states().find((s) => s.id === EPLAN_SERVER_ID),
      callTool: callEplan,
      isEplanRunning,
    },
    (status) => broadcast(ipcChannels.eplanStatusChanged, EplanStatus.parse(status)),
  );
  registerIpc({ credentials, chat, mcp, approvals, eplan, sessions, folders, skills, logger });

  // Every window learns about MCP status changes (connecting → ready, errors, toggles), and the
  // EPLAN indicator re-checks as soon as its server comes up.
  mcp.manager.onChange(() => {
    broadcast(ipcChannels.mcpChanged, McpServerList.parse(mcp.list()));
    void eplan.check();
  });
  mcp.start();
  eplan.start();

  app.on("before-quit", () => {
    chat.stopAll();
    eplan.stop();
    void mcp.manager.close();
    sessions.close();
  });
  createWindow();
});

app.on("window-all-closed", () => app.quit());
