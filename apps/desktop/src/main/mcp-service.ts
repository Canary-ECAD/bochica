import { existsSync } from "node:fs";
import { join } from "node:path";
import { McpManager, type McpServerConfig, readOnlyPolicy } from "@bochica/agent";
import { defaultMcpServers, eplanToolPolicy } from "@bochica/eplan";
import type { McpServerInfo } from "@bochica/shared";
import type { Logger } from "./logger";
import type { SettingsStore } from "./settings";

// Ties the default server list, the user's on/off choices and the live connections together.

export const EPLAN_SERVER_ID = "eplan";

/**
 * Where the local EPLAN server lives. Until S10 bundles Python and eplan-mcp, a developer points
 * Bochica at them: BOCHICA_EPLAN_MCP_DIR (an eplan-mcp checkout) and optionally BOCHICA_PYTHON
 * (default "python", a 64-bit Python with eplan-mcp's requirements installed).
 */
function locateEplanServer(
  env: NodeJS.ProcessEnv,
): { command: string; args: string[]; cwd: string } | null {
  const dir = env["BOCHICA_EPLAN_MCP_DIR"];
  const server = defaultMcpServers.find((s) => s.transport === "stdio");
  if (!dir || server?.transport !== "stdio") return null;
  const script = join(dir, server.script);
  if (!existsSync(script)) return null;
  return { command: env["BOCHICA_PYTHON"] || "python", args: [script], cwd: dir };
}

function toConfig(
  server: (typeof defaultMcpServers)[number],
  env: NodeJS.ProcessEnv,
): McpServerConfig | null {
  if (server.transport === "http") {
    return {
      id: server.id,
      transport: "http",
      url: server.url,
      required: server.required,
      policy: server.readOnly ? readOnlyPolicy : eplanToolPolicy,
    };
  }
  const location = locateEplanServer(env);
  if (!location) return null;
  return {
    id: server.id,
    transport: "stdio",
    ...location,
    env: server.env,
    required: true,
    policy: eplanToolPolicy,
  };
}

export class McpService {
  readonly manager: McpManager;

  constructor(
    private readonly settings: SettingsStore,
    logger: Logger,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.manager = new McpManager(undefined, (server, line) => logger.info(`[${server}] ${line}`));
  }

  start(): void {
    this.apply();
  }

  /** Whether the local EPLAN server can be started on this machine. */
  eplanConfigured(): boolean {
    return locateEplanServer(this.env) !== null;
  }

  list(): McpServerInfo[] {
    const states = new Map(this.manager.states().map((s) => [s.id, s]));
    return defaultMcpServers.map((server) => {
      const state = states.get(server.id);
      const configured = server.transport === "http" || this.eplanConfigured();
      return {
        id: server.id,
        ...(server.transport === "http" ? { url: server.url } : {}),
        required: server.required,
        enabled: server.required || this.settings.isMcpEnabled(server.id),
        state: configured ? (state?.state ?? "disabled") : "not_configured",
        toolCount: state?.toolCount ?? 0,
        ...(state?.error ? { error: state.error } : {}),
      };
    });
  }

  setEnabled(id: string, enabled: boolean): void {
    const server = defaultMcpServers.find((s) => s.id === id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    if (server.required) return;
    this.settings.setMcpEnabled(id, enabled);
    this.apply();
  }

  private apply(): void {
    this.manager.configure(
      defaultMcpServers.flatMap((server) => {
        const config = toConfig(server, this.env);
        return config ? [{ config, enabled: this.settings.isMcpEnabled(server.id) }] : [];
      }),
    );
  }
}
