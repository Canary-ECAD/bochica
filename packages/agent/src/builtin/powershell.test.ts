import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { powershellTool, runPowerShell, safeEnv } from "./powershell";

let work: string;
const env = { ...process.env, BOCHICA_TEST_API_KEY: "sk-test-not-a-real-key" };

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "bochica-ps-"));
  writeFileSync(join(work, "hello.txt"), "hola\n");
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

const run = (command: string, timeoutMs = 30_000, signal = new AbortController().signal) =>
  runPowerShell(command, { cwd: work, env }, timeoutMs, signal);

describe("safeEnv", () => {
  test("keeps the system variables and drops everything else", () => {
    const filtered = safeEnv({
      Path: "C:\\Windows",
      SystemRoot: "C:\\Windows",
      OPENAI_API_KEY: "sk-x",
      ELECTRON_RUN_AS_NODE: "1",
    });
    expect(filtered).toEqual({ Path: "C:\\Windows", SystemRoot: "C:\\Windows" });
  });
});

describe("runPowerShell", () => {
  test("runs in the working folder and returns UTF-8 output", async () => {
    const result = await run("Get-Content hello.txt; Write-Output 'ñandú'");
    expect(result).toEqual({ ok: true, text: "hola\nñandú" });
  });

  test("does not pass Bochica's secrets on", async () => {
    const result = await run("if ($env:BOCHICA_TEST_API_KEY) { 'leaked' } else { 'clean' }");
    expect(result.text).toBe("clean");
  });

  test("reports failures with their exit code", async () => {
    expect(await run("cmd /c exit 3")).toEqual({ ok: false, text: "[no output]\n\n[exit code 3]" });
    const missing = await run("Get-Item .\\missing.txt");
    expect(missing.ok).toBe(false);
    expect(missing.text).toContain("missing.txt");
  });

  test("stops at the timeout", async () => {
    const result = await run("Start-Sleep -Seconds 20", 1_000);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("took longer than 1 s");
  }, 15_000);

  test("stops when the turn is stopped", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const result = await run("Start-Sleep -Seconds 20", 30_000, controller.signal);
    expect(result.text).toContain("stopped by the user");
  }, 15_000);
});

const tool = () => powershellTool({ cwd: work, env, readScript: () => null });

describe("powershellTool", () => {
  test("asks, and blocks hardline commands before anyone is asked", () => {
    expect(tool().approval).toBe("ask");
    expect(tool().assess?.({ command: "Remove-Item C:\\ -Recurse" })).toMatchObject({
      block: "system-delete",
    });
    expect(tool().assess?.({ command: "Remove-Item .\\old -Recurse" })).toEqual({
      risks: ["recursive-delete"],
    });
    expect(tool().assess?.({ command: "Get-ChildItem" })).toEqual({ risks: [] });
  });

  test("refuses to run in a folder that doesn't exist", async () => {
    const missing = powershellTool({ cwd: join(work, "nope"), env });
    expect(
      await missing.execute({ command: "Get-Date" }, new AbortController().signal),
    ).toMatchObject({ ok: false });
  });
});
