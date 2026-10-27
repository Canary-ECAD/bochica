import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Confirmation } from "@bochica/shared";
import { redactSecrets } from "./redact";
import { type AgentTool, qualifiedName, type ToolApproval } from "./tools";

// Connections to MCP servers. A server that fails never blocks chat: it contributes no tools
// and is retried with backoff.

export interface ToolPolicy {
  approval: ToolApproval;
  changesProject: boolean;
}

interface ServerBase {
  id: string;
  /** Required servers are always on. */
  required: boolean;
  /** How each of this server's tools is guarded. */
  policy: (toolName: string) => ToolPolicy;
  /** Which calls are destructive enough to need typed confirmation. */
  confirm?: (toolName: string, input: unknown) => Confirmation | null;
}

export type McpServerConfig = ServerBase &
  (
    | { transport: "http"; url: string }
    | {
        transport: "stdio";
        command: string;
        args: string[];
        /**
         * Added to the SDK's minimal default environment (PATH, SYSTEMROOT, TEMP, USERPROFILE…).
         * Nothing else from Bochica's environment, such as API keys, reaches the child.
         */
        env: Record<string, string>;
        cwd?: string;
      }
  );

/** Every tool of a read-only server: never asks, never changes a project. */
export const readOnlyPolicy = (): ToolPolicy => ({ approval: "never", changesProject: false });

interface RemoteTool {
  name: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  text: string;
}

/** The part of an MCP client the manager needs; swapped for a fake in tests. */
export interface McpConnection {
  listTools(): Promise<RemoteTool[]>;
  callTool(name: string, args: unknown, signal: AbortSignal): Promise<ToolResult>;
  close(): Promise<void>;
}

export type Connector = (
  config: McpServerConfig,
  log: (line: string) => void,
) => Promise<McpConnection>;

export interface McpServerState {
  id: string;
  state: "disabled" | "connecting" | "ready" | "error";
  toolCount: number;
  error?: string;
}

interface Entry {
  config: McpServerConfig;
  enabled: boolean;
  state: McpServerState["state"];
  error?: string;
  connection?: McpConnection;
  tools: AgentTool[];
  attempt: number;
  retryTimer?: ReturnType<typeof setTimeout>;
  /** Bumped on every (re)connect or disable, so stale async results are dropped. */
  generation: number;
}

const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000];

export class McpManager {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly connector: Connector = connect,
    /** Receives the stderr lines of stdio servers, already redacted. */
    private readonly log: (serverId: string, line: string) => void = () => {},
  ) {}

  /** Declares the servers and which are enabled; connects or disconnects as needed. */
  configure(servers: Array<{ config: McpServerConfig; enabled: boolean }>): void {
    for (const { config, enabled } of servers) {
      const entry = this.entries.get(config.id) ?? {
        config,
        enabled: false,
        state: "disabled" as const,
        tools: [],
        attempt: 0,
        generation: 0,
      };
      entry.config = config;
      this.entries.set(config.id, entry);
      const shouldRun = enabled || config.required;
      if (shouldRun && !entry.enabled) {
        entry.enabled = true;
        void this.connect(entry);
      } else if (!shouldRun && entry.enabled) {
        entry.enabled = false;
        this.disconnect(entry);
      }
    }
    this.notify();
  }

  states(): McpServerState[] {
    return [...this.entries.values()].map((e) => ({
      id: e.config.id,
      state: e.state,
      toolCount: e.tools.length,
      ...(e.error ? { error: e.error } : {}),
    }));
  }

  /** Tools of every server that is ready right now. */
  tools(): AgentTool[] {
    return [...this.entries.values()].filter((e) => e.state === "ready").flatMap((e) => e.tools);
  }

  isReady(serverId: string): boolean {
    return this.entries.get(serverId)?.state === "ready";
  }

  /** Calls a tool directly, outside any chat turn (connection checks, backups). */
  async callTool(
    serverId: string,
    tool: string,
    args: Record<string, unknown>,
    signal: AbortSignal = AbortSignal.timeout(120_000),
  ): Promise<ToolResult> {
    const connection = this.entries.get(serverId)?.connection;
    if (!connection) throw new Error(`The ${serverId} server is not connected.`);
    const result = await connection.callTool(tool, args, signal);
    return { ok: result.ok, text: redactSecrets(result.text) };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    for (const entry of this.entries.values()) this.disconnect(entry);
    this.listeners.clear();
  }

  private async connect(entry: Entry): Promise<void> {
    const generation = ++entry.generation;
    entry.state = "connecting";
    delete entry.error;
    this.notify();
    try {
      const connection = await this.connector(entry.config, (line) =>
        this.log(entry.config.id, redactSecrets(line)),
      );
      const remote = await connection.listTools();
      if (generation !== entry.generation) {
        await connection.close();
        return;
      }
      entry.connection = connection;
      entry.tools = remote.map((tool) => this.toAgentTool(entry, tool));
      entry.state = "ready";
      entry.attempt = 0;
    } catch (error) {
      if (generation !== entry.generation) return;
      entry.state = "error";
      entry.error = redactSecrets(error instanceof Error ? error.message : String(error));
      entry.tools = [];
      const delay = BACKOFF_MS[Math.min(entry.attempt, BACKOFF_MS.length - 1)];
      entry.attempt++;
      entry.retryTimer = setTimeout(() => {
        if (entry.enabled && generation === entry.generation) void this.connect(entry);
      }, delay);
    }
    this.notify();
  }

  private disconnect(entry: Entry): void {
    entry.generation++;
    if (entry.retryTimer) clearTimeout(entry.retryTimer);
    void entry.connection?.close().catch(() => {});
    delete entry.connection;
    delete entry.error;
    entry.tools = [];
    entry.attempt = 0;
    entry.state = "disabled";
  }

  private toAgentTool(entry: Entry, tool: RemoteTool): AgentTool {
    const policy = entry.config.policy(tool.name);
    return {
      name: qualifiedName(entry.config.id, tool.name),
      server: entry.config.id,
      tool: tool.name,
      description: tool.description ?? tool.name,
      inputSchema: tool.inputSchema,
      approval: policy.approval,
      changesProject: policy.changesProject,
      ...(entry.config.confirm
        ? { confirmation: (input: unknown) => entry.config.confirm?.(tool.name, input) ?? null }
        : {}),
      execute: async (input, signal) => {
        const connection = entry.connection;
        if (!connection) throw new Error(`The ${entry.config.id} server is not connected.`);
        return connection.callTool(tool.name, input, signal);
      },
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

async function connect(
  config: McpServerConfig,
  log: (line: string) => void,
): Promise<McpConnection> {
  const client = new Client({ name: "bochica", version: "0.1.0" });
  if (config.transport === "http") {
    await client.connect(new StreamableHTTPClientTransport(new URL(config.url)));
  } else {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      ...(config.cwd ? { cwd: config.cwd } : {}),
      stderr: "pipe",
    });
    let buffered = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) log(line);
    });
    await client.connect(transport);
  }
  return {
    listTools: async () => (await client.listTools()).tools,
    callTool: async (name, args, signal) => {
      const result = await client.callTool(
        { name, arguments: (args ?? {}) as Record<string, unknown> },
        undefined,
        { signal, timeout: 10 * 60_000, resetTimeoutOnProgress: true },
      );
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((part: { type: string; text?: string }) =>
          part.type === "text" ? (part.text ?? "") : `[${part.type} content]`,
        )
        .join("\n");
      return { ok: result.isError !== true, text };
    },
    close: () => client.close(),
  };
}
