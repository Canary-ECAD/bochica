import { execFile } from "node:child_process";
import type { EplanStatus } from "@bochica/shared";

// Keeps the "is EPLAN connected?" indicator true. Bochica connects on its own as soon as the
// local server is up, then checks every 15 s; the user never has to say "connect to EPLAN".

const CHECK_INTERVAL_MS = 15_000;

export interface EplanStatusDeps {
  /** Whether the local EPLAN server can be started at all (dev runtime configured). */
  configured(): boolean;
  /** The MCP server's own state: "connecting", "ready", "error"… */
  serverState(): { state: string; error?: string } | undefined;
  callTool(tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
  isEplanRunning(): Promise<boolean>;
}

function json(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class EplanStatusService {
  private status: EplanStatus = { state: "starting" };
  private checking = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly deps: EplanStatusDeps,
    private readonly onChange: (status: EplanStatus) => void,
  ) {}

  current(): EplanStatus {
    return this.status;
  }

  start(): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Re-evaluates now; overlapping calls are skipped. */
  async check(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      this.set(await this.evaluate());
    } catch (error) {
      this.set({ state: "error", detail: error instanceof Error ? error.message : String(error) });
    } finally {
      this.checking = false;
    }
  }

  private async evaluate(): Promise<EplanStatus> {
    if (!this.deps.configured()) return { state: "not_configured" };
    const server = this.deps.serverState();
    if (server?.state === "error") {
      return { state: "error", ...(server.error ? { detail: server.error } : {}) };
    }
    if (server?.state !== "ready") return { state: "starting" };

    const status = json((await this.deps.callTool("eplan_status", {})).text);
    if (status["connected"] === true) {
      const ping = json((await this.deps.callTool("eplan_ping", {})).text);
      const version =
        typeof status["target_version"] === "string" ? status["target_version"] : undefined;
      if (ping["alive"] === true) return { state: "connected", ...(version ? { version } : {}) };
      if (ping["timed_out"] === true) return { state: "busy", ...(version ? { version } : {}) };
    }

    const connect = json((await this.deps.callTool("eplan_connect", {})).text);
    if (connect["success"] === true) {
      const version =
        typeof connect["target_version"] === "string" ? connect["target_version"] : undefined;
      return { state: "connected", ...(version ? { version } : {}) };
    }
    return (await this.deps.isEplanRunning()) ? { state: "unreachable" } : { state: "closed" };
  }

  private set(next: EplanStatus): void {
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    this.onChange(next);
  }
}

/** Whether an EPLAN.exe process is running on this machine. */
export function isEplanRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/FI", "IMAGENAME eq EPLAN.exe", "/NH", "/FO", "CSV"],
      { windowsHide: true },
      (error, stdout) => resolve(!error && stdout.toLowerCase().includes('"eplan.exe"')),
    );
  });
}
