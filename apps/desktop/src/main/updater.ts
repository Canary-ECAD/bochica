import { autoUpdater, type ProgressInfo } from "electron-updater";
import type { Logger } from "./logger";
import type { Updater } from "./updates";

/** How long a failed installer start takes to report itself; after that the app is quitting. */
const INSTALL_ERROR_MS = 15_000;

/**
 * electron-updater behind the `Updater` interface. The feed is the GitHub release list from
 * electron-builder.yml (`app-update.yml` in the packaged app), or a local test feed.
 */
export function electronUpdater(logger: Logger, feed: string | null): Updater {
  autoUpdater.autoDownload = false;
  // Only ever true after the user pressed "Update now" or "Later": nothing downloads otherwise.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (message?: unknown) => logger.info(`Updater: ${String(message)}`),
    warn: (message?: unknown) => logger.info(`Updater: ${String(message)}`),
    error: (message?: unknown) => logger.error(`Updater: ${String(message)}`),
  };
  if (feed) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: "generic", url: feed });
  }
  return {
    check: async () => {
      const result = await autoUpdater.checkForUpdates();
      return result?.isUpdateAvailable ? result.updateInfo.version : null;
    },
    download: async (onProgress) => {
      const listener = (progress: ProgressInfo) => onProgress(progress.percent);
      autoUpdater.on("download-progress", listener);
      try {
        await autoUpdater.downloadUpdate();
      } finally {
        autoUpdater.off("download-progress", listener);
      }
    },
    // quitAndInstall reports a failure only as an "error" event; on success the app quits.
    install: () =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, INSTALL_ERROR_MS);
        autoUpdater.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        autoUpdater.quitAndInstall(true, true);
      }),
  };
}
