import { type ChildProcess, execFile, spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, win32 } from "node:path";
import { safeEnv } from "@bochica/agent";
import en from "../renderer/src/i18n/en.json";
import es from "../renderer/src/i18n/es.json";
import type { Logger } from "./logger";
import { powershellPath, removeMarker } from "./update-marker";

// Started the way Hermes starts its relaunch waiter (apps/desktop/electron/updater/
// relaunch-waiter.ts and updater-process.ts, checked November 2026), for the same reasons:
// - Windows PowerShell 5.1 spawned with `detached: true` gets no console and exits before it runs
//   a line of -File. So a hidden, non-detached cmd.exe owns a console and runs PowerShell in it;
//   PowerShell, a grandchild, is outside Electron's job object and outlives Bochica.
// - The working folder is %TEMP%: a process's working folder can't be deleted, and the installer
//   replaces the app's.
// - The script tells it is up by writing a file next to itself; until then it may be stopped.

/** How long main waits for the helper's window before the installer shows its own instead. */
const HANDSHAKE_MS = 10_000;
/** Temporary folders are named so; the script deletes only a folder with this prefix. */
const STAGING_PREFIX = "bochica-update-";
/** The script's own log, in %TEMP%: it has no stdio, so this says why it gave up. */
const HELPER_LOG = "bochica-update-helper.log";
const READY_FILE = "ready.txt";

export type HelperStrings = typeof en.updates.window;

/** The window's text in the app's language (the renderer picks it the same way). */
export function helperStrings(locale: string, version: string): HelperStrings {
  const strings = locale.split("-")[0] === "es" ? es.updates.window : en.updates.window;
  return { ...strings, title: strings.title.replace("{{version}}", version) };
}

/** Everything the helper reads from its config.json (resources/update-helper/update-helper.ps1). */
interface HelperConfig {
  /** Bochica's pid: the helper waits for it to exit. */
  parentPid: number;
  version: string;
  /** The installer whose process it waits for, when known. */
  installer: string | null;
  /** Wait for the new version's window ("Update now"), or only for the installer ("Later"). */
  relaunch: boolean;
  marker: string;
  /** The file the script writes once its window shows. */
  ready: string;
  log: string;
  strings: HelperStrings;
}

/**
 * cmd.exe's arguments: run PowerShell, without a profile, on the script Bochica ships, in cmd's
 * hidden console, and wait for it, so stopping cmd's tree stops the script.
 */
export function helperArgs(powershell: string, script: string, config: string): string[] {
  return [
    "/d",
    "/s",
    "/c",
    powershell,
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "-Config",
    config,
  ];
}

export interface HelperHandle {
  /** The install didn't start after all: close the window and drop the marker. */
  stop(): void;
}

export interface HelperOptions {
  /** The shipped folder with update-helper.ps1. */
  folder: string;
  /** Bochica's icon (icon.ico for the taskbar, icon.png for the window), copied next to the script. */
  icons: string[];
  config: Omit<HelperConfig, "ready" | "log">;
  env: NodeJS.ProcessEnv;
  logger: Logger;
  /** Wait for the window to show; "Later" doesn't, the app is closing anyway. */
  wait: boolean;
}

/**
 * Starts the helper that keeps the update window on screen while Bochica is gone. It runs from a
 * temporary copy, since the installer replaces the app's folder, with only the environment a
 * command may see. Resolves with null when it can't start or its window doesn't show; the update
 * then goes on with the installer's own window.
 */
export async function startUpdateHelper(options: HelperOptions): Promise<HelperHandle | null> {
  const { env, logger } = options;
  let staging: string | null = null;
  try {
    staging = mkdtempSync(join(tmpdir(), STAGING_PREFIX));
    cpSync(options.folder, staging, { recursive: true });
    for (const icon of options.icons) {
      if (existsSync(icon)) copyFileSync(icon, join(staging, basename(icon)));
    }
    const config: HelperConfig = {
      ...options.config,
      ready: join(staging, READY_FILE),
      log: join(tmpdir(), HELPER_LOG),
    };
    const configPath = join(staging, "config.json");
    writeFileSync(configPath, JSON.stringify(config), "utf8");
    removeMarker(config.marker);

    const powershell = powershellPath(env);
    const child = spawn(
      win32.resolve(powershell, "../../../cmd.exe"),
      helperArgs(powershell, join(staging, "update-helper.ps1"), configPath),
      { stdio: "ignore", windowsHide: true, cwd: tmpdir(), env: safeEnv(env) },
    );
    child.on("error", (error) => logger.error("The update helper failed", error));
    const folder = staging;
    const handle: HelperHandle = {
      stop: () => {
        stopTree(child, env);
        removeMarker(config.marker);
        rmSync(folder, { recursive: true, force: true });
      },
    };
    if (!options.wait) {
      child.unref();
      return handle;
    }
    if (await handshake(child, config.ready)) {
      child.unref();
      return handle;
    }
    logger.error(
      `The update helper's window didn't show; the installer shows its own.\n${logTail(config.log, basename(folder))}`,
    );
    handle.stop();
    return null;
  } catch (error) {
    logger.error("The update helper couldn't start", error);
    if (staging) rmSync(staging, { recursive: true, force: true });
    return null;
  }
}

/** Resolves true once the script wrote its ready file; false if it ended or took too long. */
async function handshake(child: ChildProcess, ready: string): Promise<boolean> {
  const deadline = Date.now() + HANDSHAKE_MS;
  while (Date.now() < deadline) {
    if (existsSync(ready)) return true;
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
      return false;
    }
    // Polling on purpose: each wait depends on what the previous check saw.
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** cmd.exe and the PowerShell it runs. */
function stopTree(child: ChildProcess, env: NodeJS.ProcessEnv): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  const taskkill = win32.resolve(powershellPath(env), "../../../taskkill.exe");
  execFile(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
}

/** The lines this attempt wrote to the shared script log (each carries the folder's name). */
export function logTail(path: string, attempt: string): string {
  let text: string;
  try {
    text = readFileSync(path, "utf8").slice(-16_384);
  } catch {
    return `${path}: not written (the script didn't get far enough to log)`;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.includes(`[${attempt}]`));
  return `${path}:\n${lines.length > 0 ? lines.join("\n") : "no lines from this attempt"}`;
}
