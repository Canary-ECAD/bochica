// MCP servers Bochica registers out of the box. The local EPLAN server's command is filled in at
// runtime, once the bundled Python environment has been located.

export type McpServerConfig =
  | {
      id: string;
      transport: "stdio";
      /** Path of the server script inside the pinned eplan-mcp checkout. */
      script: string;
      env: Record<string, string>;
      required: true;
    }
  | {
      id: string;
      transport: "http";
      url: string;
      /** Required servers are always on; optional ones can be toggled in settings. */
      required: boolean;
    };

export const defaultMcpServers: readonly McpServerConfig[] = [
  {
    id: "eplan",
    transport: "stdio",
    script: "eplan-p8-mcp-server/mcp_server/server.py",
    env: { EPLAN_MCP_MODE: "full", MCP_TRANSPORT: "stdio" },
    required: true,
  },
  {
    id: "eplan-docs-2027",
    transport: "http",
    url: "https://rag2027.covaga.xyz/mcp",
    required: true,
  },
  {
    id: "eplan-docs-2026",
    transport: "http",
    url: "https://rag2026.covaga.xyz/mcp",
    required: false,
  },
  {
    id: "eec-pro-docs",
    transport: "http",
    url: "https://rageecpro.covaga.xyz/mcp",
    required: false,
  },
];
