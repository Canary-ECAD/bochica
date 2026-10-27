import { afterEach, describe, expect, test } from "bun:test";
import { type Connector, type McpConnection, McpManager, type McpServerConfig } from "./mcp";

const docs: McpServerConfig = {
  id: "docs",
  url: "https://docs.example.test/mcp",
  required: true,
  readOnly: true,
};
const extra: McpServerConfig = {
  id: "extra",
  url: "https://extra.example.test/mcp",
  required: false,
  readOnly: true,
};
const writer: McpServerConfig = {
  id: "writer",
  url: "https://writer.example.test/mcp",
  required: false,
  readOnly: false,
};

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

  test("tools of read-only servers never ask; others do", async () => {
    manager = new McpManager(async () => fakeConnection(["t"]));
    manager.configure([
      { config: docs, enabled: true },
      { config: writer, enabled: true },
    ]);
    await settle();
    const needs = Object.fromEntries(manager.tools().map((t) => [t.server, t.needsApproval]));
    expect(needs).toEqual({ docs: false, writer: true });
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
