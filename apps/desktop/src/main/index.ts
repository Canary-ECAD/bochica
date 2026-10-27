import { join } from "node:path";
import { app, BrowserWindow, safeStorage, shell } from "electron";
import { ChatService } from "./chat";
import { CredentialStore } from "./credentials";
import { registerIpc } from "./ipc";
import { createLogger } from "./logger";

const logger = createLogger(app.getPath("logs"));

process.on("uncaughtException", (error) => logger.error("Uncaught exception", error));
process.on("unhandledRejection", (reason) => logger.error("Unhandled rejection", reason));

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
  const chat = new ChatService(credentials, logger);
  registerIpc(credentials, chat, logger);
  app.on("before-quit", () => chat.stopAll());
  createWindow();
});

app.on("window-all-closed", () => app.quit());
