import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { helperArgs, helperStrings, logTail } from "./update-helper";

describe("helperStrings", () => {
  test("follows the app's language, with English for the rest", () => {
    expect(helperStrings("es-ES", "0.4.0").title).toBe("Actualizando Bochica a la versión 0.4.0");
    expect(helperStrings("es-419", "0.4.0").note).toContain("sola");
    expect(helperStrings("de-DE", "0.4.0").title).toBe("Updating Bochica to 0.4.0");
  });
});

test("cmd runs PowerShell without a profile on the staged script, and waits for it", () => {
  const args = helperArgs("C:\\Windows\\ps.exe", "D:\\t\\helper.ps1", "D:\\t\\config.json");
  expect(args.slice(0, 4)).toEqual(["/d", "/s", "/c", "C:\\Windows\\ps.exe"]);
  // `start /b` would return at once: cmd must own the script's lifetime, so stopping it works.
  expect(args).not.toContain("start");
  expect(args).toContain("-NoProfile");
  expect(args.slice(-4)).toEqual(["-File", "D:\\t\\helper.ps1", "-Config", "D:\\t\\config.json"]);
});

test("the log tail keeps only this attempt's lines", () => {
  const path = join(mkdtempSync(join(tmpdir(), "bochica-helper-test-")), "helper.log");
  writeFileSync(
    path,
    "t [bochica-update-a] start\nt [bochica-update-b] start\nt [bochica-update-a] failed\n",
  );
  expect(logTail(path, "bochica-update-a")).toContain("start\nt [bochica-update-a] failed");
  expect(logTail(path, "bochica-update-a")).not.toContain("-b]");
  expect(logTail(join(tmpdir(), "missing-bochica.log"), "x")).toContain("not written");
});
