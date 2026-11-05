import { join } from "node:path";
import type { UpdateStatus } from "@bochica/shared";
import { app, BrowserWindow } from "electron";
import { showsUpdateWindow } from "./updates";

/** Matches the helper's window (resources/update-helper.ps1), so the hand-off isn't seen. */
const UPDATE_WINDOW_SIZE = { width: 380, height: 150 } as const;

/**
 * The small window that stands in for the main one from "Update now" until Bochica closes
 * (`showsUpdateWindow`). The main window hides behind it and comes back if the update fails.
 * The user can't close it: the update can't be stopped half way, and a closed window with a
 * hidden main window would look like Bochica vanished.
 */
export class UpdateWindow {
  private window: BrowserWindow | null = null;
  private quitting = false;

  constructor(private readonly main: () => BrowserWindow | null) {
    app.on("before-quit", () => {
      this.quitting = true;
    });
  }

  /** Follows every status change. */
  sync(status: UpdateStatus): void {
    if (showsUpdateWindow(status)) this.open();
    else this.close();
  }

  /** A second launch: brings whichever window is up to the front. */
  focus(): void {
    const window = this.window ?? this.main();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  private open(): void {
    if (this.window) return;
    const window = new BrowserWindow({
      ...UPDATE_WINDOW_SIZE,
      title: "Bochica",
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      center: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: !app.isPackaged,
      },
    });
    this.window = window;
    window.on("close", (event) => {
      if (!this.quitting && this.window === window) event.preventDefault();
    });
    window.on("closed", () => {
      if (this.window === window) this.window = null;
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.once("ready-to-show", () => {
      window.show();
      this.main()?.hide();
    });
    const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
    if (!app.isPackaged && devServerUrl) void window.loadURL(`${devServerUrl}/update.html`);
    else void window.loadFile(join(__dirname, "../renderer/update.html"));
  }

  private close(): void {
    const window = this.window;
    if (!window) return;
    this.window = null;
    const main = this.main();
    if (main && !main.isVisible()) main.show();
    window.destroy();
  }
}
