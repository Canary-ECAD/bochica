import { describe, expect, test } from "bun:test";
import { AppInfo } from "./ipc";

describe("AppInfo", () => {
  test("accepts a valid payload", () => {
    const info = { name: "Bochica", version: "0.1.0", platform: "win32" };
    expect(AppInfo.parse(info)).toEqual(info);
  });

  test("rejects a payload with missing fields", () => {
    expect(AppInfo.safeParse({ name: "Bochica" }).success).toBe(false);
  });
});
