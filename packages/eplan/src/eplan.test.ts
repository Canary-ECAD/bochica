import { describe, expect, test } from "bun:test";
import { ComponentsLock, componentsLock } from "./components";
import { defaultMcpServers } from "./mcp-servers";

describe("components lock", () => {
  test("the committed lock file is valid", () => {
    expect(componentsLock["eplan-mcp"].commit).toHaveLength(40);
  });

  test("rejects a branch name instead of a commit", () => {
    const lock = structuredClone(componentsLock);
    lock["eplan-mcp"].commit = "main";
    expect(ComponentsLock.safeParse(lock).success).toBe(false);
  });
});

describe("default MCP servers", () => {
  test("ids are unique", () => {
    const ids = defaultMcpServers.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the local EPLAN server and the 2027 docs are always on", () => {
    const required = defaultMcpServers.filter((s) => s.required).map((s) => s.id);
    expect(required).toEqual(["eplan", "eplan-docs-2027"]);
  });

  test("remote servers use HTTPS", () => {
    for (const s of defaultMcpServers) {
      if (s.transport === "http") expect(s.url).toStartWith("https://");
    }
  });
});
