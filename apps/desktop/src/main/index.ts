import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultPathPolicy } from "@bochica/agent";
import { componentsLock, eplanInstalled, eplanToolPolicy, runtimePaths } from "@bochica/eplan";
import { EplanStatus, ipcChannels, McpServerList, UpdateStatus } from "@bochica/shared";
import { app, BrowserWindow, safeStorage, shell } from "electron";
import { ApprovalService } from "./approvals";
import { BackupGuard } from "./backup";
import { ChatService, devEchoTool } from "./chat";
import { CheckpointService } from "./checkpoints";
import { CredentialStore } from "./credentials";
import { nodeSqliteDriver } from "./db/driver";
import { SessionRepository } from "./db/repository";
import { EplanStatusService, isEplanRunning } from "./eplan-status";
import { FolderService } from "./folders";
import { registerIpc } from "./ipc";
import { createLogger } from "./logger";
import { EPLAN_SERVER_ID, McpService } from "./mcp-service";
import { PermissionStore } from "./permissions";
import { SettingsStore } from "./settings";
import { BUILTIN_SKILLS, BuiltinSkills, removeStaleCaches, SkillService } from "./skills";
import { electronUpdater } from "./updater";
import { localFeed, UpdateService } from "./updates";

const logger = createLogger(app.getPath("logs"));

const RELEASES_URL = "https://github.com/Canary-ECAD/bochica/releases";
/** The longest a quit waits for the MCP servers' processes to exit. */
const STOP_CHILDREN_MS = 6_000;

process.on("uncaughtException", (error) => logger.error("Uncaught exception", error));
process.on("unhandledRejection", (reason) => logger.error("Unhandled rejection", reason));

/** Sends a main → renderer message to every open window. */
function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
}

/**
 * The runtime the installer ships (Python, eplan-mcp, built-in skills): resources\runtime when
 * packaged, apps\desktop\runtime in development once `bun run runtime` has prepared it.
 */
const runtimeRoot = app.isPackaged
  ? join(process.resourcesPath, "runtime")
  : join(app.getAppPath(), "runtime");

/**
 * Where the built-in skills come from: during development, checkouts of each repository side by
 * side in BOCHICA_SKILLS_DIR; then the copy in the runtime folder; otherwise a cache of the
 * commit pinned in components.lock.json, downloaded on first use. Downloaded copies that aren't
 * needed (another commit, or skills read from a folder) are deleted.
 */
function builtinSkills(): BuiltinSkills[] {
  const bundled = runtimePaths(runtimeRoot).skills;
  const local = process.env["BOCHICA_SKILLS_DIR"] ?? (existsSync(bundled) ? bundled : undefined);
  const cache = join(app.getPath("userData"), "skills");
  const repositories = Object.entries(BUILTIN_SKILLS) as Array<
    [keyof typeof BUILTIN_SKILLS, readonly string[]]
  >;
  removeStaleCaches(cache, local ? [] : repositories.map(([name]) => componentsLock[name].commit));
  return repositories.map(([name, dirs]) => {
    if (local) return new BuiltinSkills(join(local, name, "skills"), dirs, null);
    const pinned = componentsLock[name];
    return new BuiltinSkills(join(cache, pinned.commit), dirs, pinned);
  });
}

/** @param onLoad runs each time the page (re)loads, when the renderer starts with fresh state. */
function createWindow(onLoad: () => void): void {
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
  window.webContents.on("did-start-loading", onLoad);

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
  const mcp = new McpService(settings, logger, runtimeRoot, join(app.getPath("logs"), "eplan-mcp"));
  const permissions = new PermissionStore(join(app.getPath("userData"), "permissions.json"));
  const approvals = new ApprovalService({ rules: permissions });
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
  const checkpoints = new CheckpointService({
    sessions,
    policy: folders.policy,
    changesProject: (server, tool) =>
      server === EPLAN_SERVER_ID && eplanToolPolicy(tool).changesProject,
  });
  const chat = new ChatService({
    credentials,
    mcp: mcp.manager,
    approvals,
    backups,
    sessions,
    skills,
    folders,
    permissions,
    checkpoints,
    logger,
    extraTools: devTools,
  });

  const eplan = new EplanStatusService(
    {
      configured: () => mcp.eplanConfigured(),
      installed: () => eplanInstalled(process.env),
      serverState: () => mcp.manager.states().find((s) => s.id === EPLAN_SERVER_ID),
      callTool: callEplan,
      isEplanRunning,
    },
    (status) => broadcast(ipcChannels.eplanStatusChanged, EplanStatus.parse(status)),
  );
  /**
   * Stops the turns and waits for the MCP servers' processes to exit: an update replaces the
   * files the bundled Python runs from, and Windows can't replace a file that is in use.
   */
  const stopChildren = async (): Promise<void> => {
    chat.stopAll();
    eplan.stop();
    await Promise.race([
      mcp.manager.stop(),
      new Promise((resolve) => setTimeout(resolve, STOP_CHILDREN_MS)),
    ]);
  };

  const feed = localFeed(process.env);
  if (feed) logger.info(`Updates come from the local test feed ${feed}`);
  const updates = new UpdateService({
    updater: app.isPackaged || feed ? electronUpdater(logger, feed) : null,
    current: app.getVersion(),
    busy: () => chat.busy(),
    prepareInstall: stopChildren,
    cancelInstall: () => {
      mcp.start();
      eplan.start();
    },
    notesUrl: (version) => `${RELEASES_URL}/tag/v${version}`,
    logger,
    onChange: (status) => broadcast(ipcChannels.updatesChanged, UpdateStatus.parse(status)),
  });
  chat.onIdle(() => updates.idle());

  registerIpc({
    credentials,
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
  });

  // Every window learns about MCP status changes (connecting → ready, errors, toggles), and the
  // EPLAN indicator re-checks as soon as its server comes up.
  mcp.manager.onChange(() => {
    broadcast(ipcChannels.mcpChanged, McpServerList.parse(mcp.list()));
    void eplan.check();
  });
  mcp.start();
  eplan.start();
  updates.start();

  // The first quit waits for the children to stop, then quits again for real.
  let stopped = false;
  let stopping: Promise<void> | null = null;
  app.on("before-quit", (event) => {
    if (stopped) return;
    event.preventDefault();
    stopping ??= stopChildren().finally(() => {
      updates.stop();
      sessions.close();
      stopped = true;
      app.quit();
    });
  });
  // A reloaded renderer shows every session in Ask mode: main must not stay in Auto behind it.
  createWindow(() => approvals.clearAuto());
});

app.on("window-all-closed", () => app.quit());
