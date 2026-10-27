import { McpManager } from "@bochica/agent";
import { defaultMcpServers } from "@bochica/eplan";
import type { McpServerInfo } from "@bochica/shared";
import type { SettingsStore } from "./settings";

// Ties the default server list, the user's on/off choices and the live connections together.
// Only the HTTP documentation servers are managed for now; the local EPLAN server (stdio)
// joins in S4.

const httpServers = defaultMcpServers.flatMap((server) =>
  server.transport === "http" ? [server] : [],
);

export class McpService {
  readonly manager = new McpManager();

  constructor(private readonly settings: SettingsStore) {}

  start(): void {
    this.apply();
  }

  list(): McpServerInfo[] {
    const states = new Map(this.manager.states().map((s) => [s.id, s]));
    return httpServers.map((server) => {
      const state = states.get(server.id);
      return {
        id: server.id,
        url: server.url,
        required: server.required,
        enabled: server.required || this.settings.isMcpEnabled(server.id),
        state: state?.state ?? "disabled",
        toolCount: state?.toolCount ?? 0,
        ...(state?.error ? { error: state.error } : {}),
      };
    });
  }

  setEnabled(id: string, enabled: boolean): void {
    const server = httpServers.find((s) => s.id === id);
    if (!server) throw new Error(`Unknown MCP server: ${id}`);
    if (server.required) return;
    this.settings.setMcpEnabled(id, enabled);
    this.apply();
  }

  private apply(): void {
    this.manager.configure(
      httpServers.map((server) => ({
        config: {
          id: server.id,
          url: server.url,
          required: server.required,
          readOnly: server.readOnly,
        },
        enabled: this.settings.isMcpEnabled(server.id),
      })),
    );
  }
}
