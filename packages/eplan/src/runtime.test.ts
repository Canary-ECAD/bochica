import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { componentsLock } from "./components";
import {
  eplanInstalled,
  eplanServerLaunch,
  expectedManifest,
  pythonPin,
  RuntimeManifest,
  runtimePaths,
  uvPin,
} from "./runtime";

const SCRIPT = join("eplan-p8-mcp-server", "mcp_server", "server.py");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bochica-runtime-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
}

/** A runtime folder with the Python and the server script in place. */
function fakeRuntime(): string {
  const root = join(dir, "runtime");
  const paths = runtimePaths(root);
  touch(paths.python);
  touch(join(paths.eplanMcp, SCRIPT));
  return root;
}

describe("pins", () => {
  test("downloads are HTTPS release assets with a SHA-256", () => {
    for (const pin of [pythonPin, uvPin]) {
      expect(pin.url).toStartWith("https://github.com/astral-sh/");
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(pythonPin.url).toContain("x86_64-pc-windows-msvc");
    expect(uvPin.url).toContain("x86_64-pc-windows-msvc");
  });

  test("the manifest records every pinned commit", () => {
    const manifest = expectedManifest(componentsLock, "abc");
    expect(RuntimeManifest.parse(manifest)).toEqual(manifest);
    expect(manifest.eplanMcp).toBe(componentsLock["eplan-mcp"].commit);
    expect(manifest.skills).toEqual({
      "eplan-scripting-skill": componentsLock["eplan-scripting-skill"].commit,
      "eec-pro-skill": componentsLock["eec-pro-skill"].commit,
    });
  });
});

describe("eplanServerLaunch", () => {
  test("uses the bundled Python and server, with the user's site hidden", () => {
    const root = fakeRuntime();
    const launch = eplanServerLaunch({}, root, "C:\\Logs");
    expect(launch).toEqual({
      command: runtimePaths(root).python,
      args: [join(runtimePaths(root).eplanMcp, SCRIPT)],
      cwd: runtimePaths(root).eplanMcp,
      env: {
        EPLAN_MCP_MODE: "full",
        MCP_TRANSPORT: "stdio",
        EPLAN_MCP_LOG_DIR: "C:\\Logs",
        PYTHONUTF8: "1",
        PYTHONNOUSERSITE: "1",
      },
    });
  });

  test("a developer's checkout comes first", () => {
    const root = fakeRuntime();
    const checkout = join(dir, "eplan-mcp");
    touch(join(checkout, SCRIPT));
    const launch = eplanServerLaunch(
      { BOCHICA_EPLAN_MCP_DIR: checkout, BOCHICA_PYTHON: "C:\\Py\\python.exe" },
      root,
      "C:\\Logs",
    );
    expect(launch?.command).toBe("C:\\Py\\python.exe");
    expect(launch?.cwd).toBe(checkout);
    expect(launch?.env["PYTHONNOUSERSITE"]).toBeUndefined();
  });

  test("a developer's checkout without the script is not replaced by the bundle", () => {
    expect(eplanServerLaunch({ BOCHICA_EPLAN_MCP_DIR: dir }, fakeRuntime(), "L")).toBeNull();
  });

  test("passes a custom EPLAN location on", () => {
    const launch = eplanServerLaunch({ EPLAN_PLATFORM_ROOT: "D:\\EPLAN" }, fakeRuntime(), "L");
    expect(launch?.env["EPLAN_PLATFORM_ROOT"]).toBe("D:\\EPLAN");
  });

  test("nothing without a runtime, or with an incomplete one", () => {
    expect(eplanServerLaunch({}, null, "L")).toBeNull();
    const root = join(dir, "broken");
    touch(runtimePaths(root).python);
    expect(eplanServerLaunch({}, root, "L")).toBeNull();
  });
});

describe("eplanInstalled", () => {
  test("finds a version folder with the Remote Client", () => {
    touch(join(dir, "2027.0.3", "Bin", "Eplan.EplApi.RemoteClientu.dll"));
    expect(eplanInstalled({ EPLAN_PLATFORM_ROOT: dir })).toBe(true);
  });

  test("an empty or leftover folder is not an installation", () => {
    mkdirSync(join(dir, "2026.0.1", "Bin"), { recursive: true });
    expect(eplanInstalled({ EPLAN_PLATFORM_ROOT: dir })).toBe(false);
    expect(eplanInstalled({ EPLAN_PLATFORM_ROOT: join(dir, "missing") })).toBe(false);
  });
});
