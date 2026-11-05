import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, win32 } from "node:path";
import { z } from "zod";

/**
 * Written by the update helper (resources/update-helper) while it owns the app: its pid and start
 * time, so a dead helper never blocks a launch, and the version it installs.
 */
const UpdateMarker = z.object({
  pid: z.number().int().positive(),
  /** Start time of the helper's process, ms since epoch. */
  started: z.number(),
  version: z.string(),
});
export type UpdateMarker = z.infer<typeof UpdateMarker>;

/** What a launch does about the marker. */
export type MarkerVerdict =
  /** No update going on. */
  | "none"
  /** This is the new version: start, and remove the marker once the window shows. */
  | "updated"
  /** An update owns the app: bring its window to the front and don't start. */
  | "updating"
  /** Its helper is gone: remove the marker and start. */
  | "stale";

export function updateMarkerPath(userData: string): string {
  return join(userData, "update-marker.json");
}

/** A launch creates this file next to the marker; the helper sees it and shows its window. */
function pokePath(marker: string): string {
  return `${marker}.poke`;
}

export function readMarker(path: string): UpdateMarker | null {
  try {
    const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
    return UpdateMarker.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export function removeMarker(path: string): void {
  rmSync(path, { force: true });
  rmSync(pokePath(path), { force: true });
}

export function poke(path: string): void {
  try {
    writeFileSync(pokePath(path), "");
  } catch {
    // The helper's window is on top anyway.
  }
}

export function markerVerdict(
  marker: UpdateMarker | null,
  version: string,
  alive: (marker: UpdateMarker) => boolean,
): MarkerVerdict {
  if (!marker) return "none";
  if (marker.version === version) return "updated";
  return alive(marker) ? "updating" : "stale";
}

/** Two readings of a process's start time differ by rounding at most. */
const START_TOLERANCE_MS = 2_000;

/**
 * Whether the marker's helper still runs: its pid exists and started when the marker says (a
 * reused pid belongs to another process). Asks PowerShell for the start time, so it is only
 * called when a marker exists.
 */
export function helperAlive(marker: UpdateMarker, env: NodeJS.ProcessEnv): boolean {
  try {
    process.kill(marker.pid, 0);
  } catch {
    return false;
  }
  try {
    const output = execFileSync(
      powershellPath(env),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `([DateTimeOffset](Get-Process -Id ${marker.pid}).StartTime).ToUnixTimeMilliseconds()`,
      ],
      { encoding: "utf8", timeout: 10_000, windowsHide: true },
    );
    return Math.abs(Number(output.trim()) - marker.started) <= START_TOLERANCE_MS;
  } catch {
    return false;
  }
}

/** Windows PowerShell by absolute path, never whatever `powershell` PATH finds first. */
export function powershellPath(env: NodeJS.ProcessEnv): string {
  const root = env["SystemRoot"] ?? env["windir"] ?? "C:\\Windows";
  return win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}
