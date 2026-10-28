import type { UpdateStatus } from "@bochica/shared";
import type { Logger } from "./logger";

/** The first check waits a little, so it doesn't compete with the app starting. */
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

/** What the service needs from electron-updater (see `updater.ts`); tests use a fake. */
export interface Updater {
  /** The newest version when it is newer than the installed one, else null. */
  check(): Promise<string | null>;
  download(onProgress: (percent: number) => void): Promise<void>;
  /** Quits, installs and starts the new version. Rejects if the installer can't start. */
  install(): Promise<void>;
}

export interface UpdateDeps {
  /** Null in a development build without a test feed: updates are off. */
  updater: Updater | null;
  /** The installed version. */
  current: string;
  /** Whether a task runs; a restart waits for it to end (see `idle`). */
  busy: () => boolean;
  /** Stops what runs from the app's folder (MCP servers) before the installer replaces it. */
  prepareInstall: () => Promise<void>;
  /** Brings back what `prepareInstall` stopped, when the installer couldn't start. */
  cancelInstall: () => void;
  notesUrl: (version: string) => string;
  logger: Logger;
  onChange: (status: UpdateStatus) => void;
}

/** Network trouble (offline, DNS, proxy, timeouts) reads differently from a broken download. */
export function updateErrorKind(error: unknown): "offline" | "failed" {
  const text =
    error instanceof Error ? `${error.message} ${String(Reflect.get(error, "code"))}` : "";
  return /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_PROXY|ERR_TUNNEL|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NETWORK/.test(
    text,
  )
    ? "offline"
    : "failed";
}

/**
 * The in-app updater. It checks on its own, but never downloads or installs without the user:
 * "Update now" downloads and restarts (after the running task, if any); "Later" downloads quietly
 * and the update is applied when the app closes.
 */
export class UpdateService {
  private status: UpdateStatus;
  /** "Update now" was pressed: restart as soon as the download is ready and nothing runs. */
  private wantsInstall = false;
  private downloading: Promise<void> | null = null;
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  constructor(private readonly deps: UpdateDeps) {
    this.status = {
      state: deps.updater ? "idle" : "off",
      current: deps.current,
      deferred: false,
      waiting: false,
    };
  }

  current(): UpdateStatus {
    return this.status;
  }

  /** Checks shortly after start, then every few hours. Background failures are only logged. */
  start(): void {
    if (!this.deps.updater) return;
    this.timers.push(
      setTimeout(() => void this.check(false), FIRST_CHECK_MS),
      setInterval(() => void this.check(false), CHECK_EVERY_MS),
    );
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  /** @param manual the user asked: a failure is shown, not just logged. */
  async check(manual: boolean): Promise<UpdateStatus> {
    const updater = this.deps.updater;
    const before = this.status;
    if (!updater || ["checking", "downloading", "ready"].includes(before.state)) return before;
    if (before.state === "error" && before.failedDuring !== "check" && !manual) return before;
    this.set({ state: "checking", error: undefined, failedDuring: undefined });
    try {
      const version = await updater.check();
      if (!version) {
        this.set({
          state: "idle",
          version: undefined,
          notesUrl: undefined,
          upToDateAt: Date.now(),
        });
      } else {
        // "Later" holds for that version only; a newer one asks again.
        const deferred = before.deferred && before.version === version;
        this.set({ state: "available", version, notesUrl: this.deps.notesUrl(version), deferred });
        if (deferred) void this.download();
      }
    } catch (error) {
      this.deps.logger.error("Checking for updates failed", error);
      if (manual) {
        this.fail(error, "check");
      } else {
        this.status = before;
        this.deps.onChange(before);
      }
    }
    return this.status;
  }

  /** "Update now": download if needed, then restart, waiting for a running task first. */
  install(): UpdateStatus {
    const { state, failedDuring } = this.status;
    if (
      state === "available" ||
      state === "downloading" ||
      (state === "error" && failedDuring !== "check")
    ) {
      this.wantsInstall = true;
      this.set({ deferred: false });
      void this.download();
    } else if (state === "ready") {
      this.wantsInstall = true;
      this.set({ deferred: false });
      void this.restart();
    }
    return this.status;
  }

  /** "Later": no notice for this version; it downloads quietly and installs when the app closes. */
  later(): UpdateStatus {
    const { state } = this.status;
    if (state !== "available" && state !== "downloading" && state !== "ready") return this.status;
    this.wantsInstall = false;
    this.set({ deferred: true, waiting: false });
    if (state === "available") void this.download();
    return this.status;
  }

  /** The last running task ended: a restart that waited for it goes ahead. */
  idle(): void {
    if (this.wantsInstall && this.status.state === "ready") void this.restart();
  }

  private download(): Promise<void> {
    const updater = this.deps.updater;
    if (!updater) return Promise.resolve();
    this.downloading ??= (async () => {
      this.set({ state: "downloading", percent: 0, error: undefined, failedDuring: undefined });
      try {
        await updater.download((percent) => {
          if (this.status.state === "downloading") this.set({ percent: Math.floor(percent) });
        });
        this.set({ state: "ready", percent: undefined });
        if (this.wantsInstall) await this.restart();
      } catch (error) {
        this.deps.logger.error("Downloading the update failed", error);
        // A quiet download ("Later") that fails just offers the update again.
        if (this.wantsInstall) this.fail(error, "download");
        else this.set({ state: "available", percent: undefined });
      } finally {
        this.downloading = null;
      }
    })();
    return this.downloading;
  }

  private async restart(): Promise<void> {
    const updater = this.deps.updater;
    if (!updater) return;
    if (this.deps.busy()) {
      this.set({ waiting: true });
      return;
    }
    this.set({ waiting: false });
    this.deps.logger.info(`Installing Bochica ${this.status.version ?? "?"}`);
    try {
      await this.deps.prepareInstall();
      await updater.install();
    } catch (error) {
      this.deps.logger.error("Installing the update failed", error);
      this.deps.cancelInstall();
      this.wantsInstall = false;
      this.fail(error, "install");
    }
  }

  private fail(error: unknown, during: NonNullable<UpdateStatus["failedDuring"]>): void {
    this.set({
      state: "error",
      error: updateErrorKind(error),
      failedDuring: during,
      percent: undefined,
      waiting: false,
    });
  }

  /** Applies a change; `undefined` removes a field. */
  private set(change: { [K in keyof UpdateStatus]?: UpdateStatus[K] | undefined }): void {
    const next: Record<string, unknown> = { ...this.status };
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    this.status = next as UpdateStatus;
    this.deps.onChange(this.status);
  }
}

/**
 * A test feed for the updater, from BOCHICA_UPDATE_URL. Only a local address is accepted, so
 * the variable can't point an installed app at someone else's server.
 */
export function localFeed(env: NodeJS.ProcessEnv): string | null {
  const value = env["BOCHICA_UPDATE_URL"];
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    return url.protocol === "http:" && local ? url.toString() : null;
  } catch {
    return null;
  }
}
