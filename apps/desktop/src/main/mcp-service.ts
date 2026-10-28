import { McpManager, type McpServerConfig, readOnlyPolicy } from "@bochica/agent";
import {
  defaultMcpServers,
  eplanConfirmation,
  type EplanServerLaunch,
  eplanServerLaunch,
  eplanToolPolicy,
} from "@bochica/eplan";
import type { McpServerInfo } from "@bochica/shared";
import type { Logger } from "./logger";
import type { SettingsStore } from "./settings";

// Ties the default server list, the user's on/off choices and the live connections together.

export const EPLAN_SERVER_ID = "eplan";

function toConfig(
  server: (typeof defaultMcpServers)[number],
  launch: EplanServerLaunch | null,
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
  if (!launch) return null;
  return {
    id: server.id,
    transport: "stdio",
    ...launch,
    required: true,
    policy: eplanToolPolicy,
    confirm: eplanConfirmation,
  };
}

export class McpService {
  readonly manager: McpManager;

  private readonly launch: EplanServerLaunch | null;

  /**
   * @param runtimeRoot the bundled runtime folder; a developer's eplan-mcp checkout
   *   (BOCHICA_EPLAN_MCP_DIR) comes first.
   * @param logDir where eplan-mcp writes its own logs.
   */
  constructor(
    private readonly settings: SettingsStore,
    logger: Logger,
    runtimeRoot: string | null,
    logDir: string,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.manager = new McpManager(undefined, (server, line) => logger.info(`[${server}] ${line}`));
    this.launch = eplanServerLaunch(env, runtimeRoot, logDir);
    logger.info(
      this.launch
        ? `EPLAN server: ${this.launch.command} ${this.launch.args.join(" ")}`
        : "EPLAN server: not set up (no bundled runtime, BOCHICA_EPLAN_MCP_DIR unset)",
    );
  }

  start(): void {
    this.apply();
  }

  /** Whether the local EPLAN server can be started on this machine. */
  eplanConfigured(): boolean {
    return this.launch !== null;
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
        const config = toConfig(server, this.launch);
        return config ? [{ config, enabled: this.settings.isMcpEnabled(server.id) }] : [];
      }),
    );
  }
}
