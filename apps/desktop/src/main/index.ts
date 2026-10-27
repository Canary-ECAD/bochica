import { join } from "node:path";
import { AppInfo, ipcChannels } from "@bochica/shared";
import { app, BrowserWindow, ipcMain, shell } from "electron";

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
    },
  });

  window.once("ready-to-show", () => window.show());

  // The renderer never navigates away or opens windows: links go to the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function registerIpc(): void {
  ipcMain.handle(ipcChannels.appInfo, () =>
    AppInfo.parse({ name: app.getName(), version: app.getVersion(), platform: process.platform }),
  );
}

void app.whenReady().then(() => {
  registerIpc();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
