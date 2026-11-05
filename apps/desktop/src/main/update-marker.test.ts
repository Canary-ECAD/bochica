import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markerVerdict, powershellPath, readMarker, type UpdateMarker } from "./update-marker";

const marker: UpdateMarker = { pid: 4242, started: 1_790_000_000_000, version: "0.4.0" };

describe("markerVerdict", () => {
  test.each([
    ["no marker", null, true, "none"],
    ["the new version starting", marker, true, "updated"],
    ["the new version, helper gone", marker, false, "updated"],
    ["an older version while the helper runs", { ...marker, version: "0.5.0" }, true, "updating"],
    ["an older version after the helper died", { ...marker, version: "0.5.0" }, false, "stale"],
  ] as const)("%s", (_name, found, alive, verdict) => {
    expect(markerVerdict(found, "0.4.0", () => alive)).toBe(verdict);
  });
});

describe("readMarker", () => {
  const folder = mkdtempSync(join(tmpdir(), "bochica-marker-test-"));
  const write = (text: string) => {
    const path = join(folder, `${Math.random()}.json`);
    writeFileSync(path, text);
    return path;
  };

  test("reads what the helper writes, with or without a BOM", () => {
    expect(readMarker(write(JSON.stringify(marker)))).toEqual(marker);
    expect(readMarker(write(`\uFEFF${JSON.stringify(marker)}`))).toEqual(marker);
  });

  test("a missing, broken or foreign file is no marker", () => {
    expect(readMarker(join(folder, "missing.json"))).toBeNull();
    expect(readMarker(write("{"))).toBeNull();
    expect(readMarker(write(JSON.stringify({ pid: "4242", version: "0.4.0" })))).toBeNull();
  });
});

test("PowerShell is found by absolute path under SystemRoot", () => {
  expect(powershellPath({ SystemRoot: "D:\\Win" })).toBe(
    "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  expect(powershellPath({})).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
});
