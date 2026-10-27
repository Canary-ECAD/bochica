import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinTools, FolderService } from "./folders";

const root = mkdtempSync(join(tmpdir(), "bochica-folders-"));
const secret = join(root, "secret");
mkdirSync(secret);
const policy = { secret: [secret], readOnly: [] };
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("FolderService", () => {
  const folders = new FolderService(join(root, "Documents"), policy);

  test("a usable folder is kept", () => {
    expect(folders.resolve(root)).toBe(root);
  });

  test("missing, relative or protected folders fall back to the default, created", () => {
    const fallback = join(root, "Documents", "Bochica");
    expect(folders.resolve(undefined)).toBe(fallback);
    expect(existsSync(fallback)).toBe(true);
    expect(folders.resolve(join(root, "nope"))).toBe(fallback);
    expect(folders.resolve("relative\\path")).toBe(fallback);
    expect(folders.resolve(secret)).toBe(fallback);
  });
});

const names = (mode: "consult" | "tasks" | "draw") =>
  builtinTools(mode, root, policy, {}).map((tool) => tool.tool);

describe("builtinTools", () => {
  test("Consult gets the file tools but no terminal", () => {
    expect(names("consult")).toEqual([
      "read_file",
      "list_files",
      "search_files",
      "write_file",
      "edit_file",
    ]);
  });

  test("Tasks adds PowerShell; Draw gets nothing", () => {
    expect(names("tasks")).toContain("powershell");
    expect(names("draw")).toEqual([]);
  });
});
