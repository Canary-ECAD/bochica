import { afterEach, describe, expect, test } from "bun:test";
import {
  type Connector,
  type McpConnection,
  McpManager,
  type McpServerConfig,
  readOnlyPolicy,
  type ToolPolicy,
} from "./mcp";

const http = (
  id: string,
  required: boolean,
  policy: (tool: string) => ToolPolicy = readOnlyPolicy,
): McpServerConfig => ({
  id,
  transport: "http",
  url: `https://${id}.example.test/mcp`,
  required,
  policy,
});
const docs = http("docs", true);
const extra = http("extra", false);
const writer = http("writer", false, (tool) => ({
  approval: tool.startsWith("delete") ? "always" : "ask",
  changesProject: true,
}));

function fakeConnection(toolNames: string[]): McpConnection & { closed: boolean } {
  return {
    closed: false,
    listTools: async () =>
      toolNames.map((name) => ({ name, description: name, inputSchema: { type: "object" } })),
    callTool: async (name, args) => ({ ok: true, text: `${name}(${JSON.stringify(args)})` }),
    async close() {
      this.closed = true;
    },
  };
}

/** Connects every server except "extra", which refuses. */
const failExtra: Connector = async (config) => {
  if (config.id === "extra") throw new Error("connect ECONNREFUSED");
  return fakeConnection(["search"]);
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let manager: McpManager;
afterEach(() => manager?.close());

describe("McpManager", () => {
  test("connects required and enabled servers, not disabled ones", async () => {
    const connected: string[] = [];
    manager = new McpManager(async (config) => {
      connected.push(config.id);
      return fakeConnection([`${config.id}_search`]);
    });
    manager.configure([
      { config: docs, enabled: false },
      { config: extra, enabled: false },
    ]);
    await settle();
    expect(connected).toEqual(["docs"]);
    expect(manager.states()).toEqual([
      { id: "docs", state: "ready", toolCount: 1 },
      { id: "extra", state: "disabled", toolCount: 0 },
    ]);
    expect(manager.tools().map((t) => t.name)).toEqual(["mcp__docs__docs_search"]);
  });

  test("tools call through to their server", async () => {
    manager = new McpManager(async () => fakeConnection(["search"]));
    manager.configure([{ config: docs, enabled: true }]);
    await settle();
    const [tool] = manager.tools();
    expect(await tool?.execute({ q: "macro" }, new AbortController().signal)).toEqual({
      ok: true,
      text: 'search({"q":"macro"})',
    });
  });

  test("each tool gets its server's policy", async () => {
    manager = new McpManager(async () => fakeConnection(["search", "delete_page"]));
    manager.configure([
      { config: docs, enabled: true },
      { config: writer, enabled: true },
    ]);
    await settle();
    const policies = Object.fromEntries(
      manager.tools().map((t) => [`${t.server}/${t.tool}`, [t.approval, t.changesProject]]),
    );
    expect(policies).toEqual({
      "docs/search": ["never", false],
      "docs/delete_page": ["never", false],
      "writer/search": ["ask", true],
      "writer/delete_page": ["always", true],
    });
  });

  test("callTool reaches a ready server directly and redacts its output", async () => {
    const connection = fakeConnection(["status"]);
    connection.callTool = async () => ({ ok: true, text: "token=abcd1234efgh" });
    manager = new McpManager(async () => connection);
    manager.configure([{ config: docs, enabled: true }]);
    await settle();
    expect(manager.isReady("docs")).toBe(true);
    expect(await manager.callTool("docs", "status", {})).toEqual({
      ok: true,
      text: "token=[REDACTED]",
    });
    await expect(manager.callTool("nope", "status", {})).rejects.toThrow("not connected");
  });

  test("server log lines are redacted before they reach the logger", async () => {
    const lines: string[] = [];
    manager = new McpManager(
      async (_config, log) => {
        log("started with OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrst");
        return fakeConnection([]);
      },
      (server, line) => lines.push(`${server}: ${line}`),
    );
    manager.configure([{ config: docs, enabled: true }]);
    await settle();
    expect(lines).toEqual(["docs: started with OPENAI_API_KEY=[REDACTED]"]);
  });

  test("a failing server reports the error and contributes no tools", async () => {
    manager = new McpManager(failExtra);
    manager.configure([
      { config: docs, enabled: true },
      { config: extra, enabled: true },
    ]);
    await settle();
    expect(manager.states().find((s) => s.id === "extra")).toMatchObject({
      state: "error",
      error: "connect ECONNREFUSED",
    });
    expect(manager.tools().map((t) => t.server)).toEqual(["docs"]);
  });

  test("disabling a server closes it and removes its tools", async () => {
    const connection = fakeConnection(["search"]);
    manager = new McpManager(async () => connection);
    manager.configure([{ config: extra, enabled: true }]);
    await settle();
    manager.configure([{ config: extra, enabled: false }]);
    await settle();
    expect(connection.closed).toBe(true);
    expect(manager.tools()).toEqual([]);
    expect(manager.states()[0]?.state).toBe("disabled");
  });

  test("stop waits for every connection to close, and configure brings them back", async () => {
    let release: (() => void) | undefined;
    const slow = fakeConnection(["search"]);
    slow.close = () => new Promise<void>((resolve) => (release = resolve));
    let connects = 0;
    manager = new McpManager(async () => (++connects === 1 ? slow : fakeConnection(["search"])));
    manager.configure([{ config: docs, enabled: true }]);
    await settle();
    let stopped = false;
    const stopping = manager.stop().then(() => (stopped = true));
    await settle();
    expect(stopped).toBe(false);
    expect(manager.states()[0]?.state).toBe("disabled");
    release?.();
    await stopping;
    manager.configure([{ config: docs, enabled: true }]);
    await settle();
    expect(connects).toBe(2);
    expect(manager.states()[0]?.state).toBe("ready");
  });

  test("required servers stay on even if disabled", async () => {
    manager = new McpManager(async () => fakeConnection(["search"]));
    manager.configure([{ config: docs, enabled: false }]);
    await settle();
    expect(manager.states()[0]?.state).toBe("ready");
  });

  test("notifies listeners on every change", async () => {
    manager = new McpManager(async () => fakeConnection(["search"]));
    let changes = 0;
    manager.onChange(() => changes++);
    manager.configure([{ config: docs, enabled: true }]);
    await settle();
    expect(changes).toBeGreaterThanOrEqual(2);
  });
});
