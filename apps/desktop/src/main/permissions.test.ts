import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PermissionStore, ruleFor } from "./permissions";

let root: string;
let file: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bochica-permissions-"));
  file = join(root, "permissions.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const command = (text: string) => ({ command: text, description: "x" });

describe("ruleFor", () => {
  test("PowerShell remembers the command, other tools the tool", () => {
    expect(ruleFor("bochica", "powershell", command("  git   status "))).toEqual({
      kind: "command",
      command: "git status",
    });
    expect(ruleFor("eplan", "eplan_page_create", { name: "=A1" })).toEqual({
      kind: "tool",
      server: "eplan",
      tool: "eplan_page_create",
    });
    expect(ruleFor("bochica", "powershell", command(" "))).toBeNull();
  });
});

describe("PermissionStore", () => {
  test("starts empty, asks for everything", () => {
    const store = new PermissionStore(file);
    expect(store.get()).toEqual({ alwaysAllow: [], denyRules: [], smart: false });
    expect(store.isAlwaysAllowed("bochica", "powershell", command("git status"))).toBe(false);
  });

  test("always-allowed commands match with other spacing and case, and survive a restart", () => {
    new PermissionStore(file).allowAlways("bochica", "powershell", command("Get-ChildItem  -Name"));
    const store = new PermissionStore(file);
    expect(store.isAlwaysAllowed("bochica", "powershell", command("get-childitem -name"))).toBe(
      true,
    );
    expect(store.isAlwaysAllowed("bochica", "powershell", command("Get-ChildItem"))).toBe(false);
    expect(store.get().alwaysAllow).toEqual([{ kind: "command", command: "Get-ChildItem -Name" }]);
  });

  test("set replaces the rules, without duplicates or blank patterns", () => {
    const store = new PermissionStore(file);
    store.allowAlways("bochica", "write_file", {});
    const saved = store.set({
      alwaysAllow: [
        { kind: "command", command: "git status" },
        { kind: "command", command: "GIT STATUS" },
      ],
      denyRules: [" git push* ", "git push*", ""],
      smart: true,
    });
    expect(saved).toEqual({
      alwaysAllow: [{ kind: "command", command: "git status" }],
      denyRules: ["git push*"],
      smart: true,
    });
    expect(store.isAlwaysAllowed("bochica", "write_file", {})).toBe(false);
    expect(new PermissionStore(file).denyRules()).toEqual(["git push*"]);
  });

  test("counts how often a call was allowed", () => {
    const store = new PermissionStore(file);
    store.recordAllowed("bochica", "powershell", command("git status"));
    store.recordAllowed("bochica", "powershell", command("git  status"));
    expect(
      new PermissionStore(file).allowedCount("bochica", "powershell", command("git status")),
    ).toBe(2);
    expect(store.allowedCount("bochica", "powershell", command("git log"))).toBe(0);
  });

  test("a damaged file is set aside and everything asks again", () => {
    writeFileSync(file, "{ not json");
    const store = new PermissionStore(file);
    expect(store.get().alwaysAllow).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(root).some((name) => name.startsWith("permissions.json.corrupt-"))).toBe(
      true,
    );
  });
});
