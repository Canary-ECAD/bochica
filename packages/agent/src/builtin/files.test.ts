import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "../tools";
import { fileTools, findFiles, globToRegExp } from "./files";
import { checkPath, defaultPathPolicy, type PathPolicy } from "./paths";

let root: string;
let work: string;
let policy: PathPolicy;
let tools: Map<string, AgentTool>;
const signal = new AbortController().signal;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "bochica-files-"));
  work = join(root, "work");
  mkdirSync(join(work, "scripts"), { recursive: true });
  mkdirSync(join(work, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(root, "secret"));
  mkdirSync(join(root, "system"));
  writeFileSync(join(work, "notes.txt"), "first line\nsecond line\nthird line\n");
  writeFileSync(join(work, "scripts", "Export.cs"), "using Eplan.EplApi;\r\nclass Export {}\r\n");
  writeFileSync(join(work, "scripts", "Report.cs"), "using System;\nclass Report {}\n");
  writeFileSync(join(work, "node_modules", "pkg", "index.cs"), "using Eplan.EplApi;\n");
  writeFileSync(join(work, ".env"), "API_KEY=abc\n");
  writeFileSync(join(work, ".env.example"), "API_KEY=\n");
  writeFileSync(join(work, "image.bin"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  writeFileSync(join(root, "secret", "key.txt"), "secret");
  try {
    // A junction into the protected folder must not get around the policy.
    symlinkSync(join(root, "secret"), join(work, "link"), "junction");
  } catch {}
  policy = { secret: [join(root, "secret")], readOnly: [join(root, "system")] };
  tools = new Map(fileTools({ cwd: work, policy }).map((t) => [t.tool, t]));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function get(name: string): AgentTool {
  const tool = tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool;
}

async function run(name: string, input: Record<string, unknown>) {
  const tool = get(name);
  const assessment = tool.assess?.(input);
  if (assessment && "block" in assessment) return { blocked: assessment.block };
  return tool.execute(input, signal);
}

describe("checkPath", () => {
  test.each([
    ["\\\\?\\C:\\x.txt", "read", "device-path"],
    ["\\\\.\\PhysicalDrive0", "read", "device-path"],
    ["\\??\\C:\\x.txt", "write", "device-path"],
    ["notes.txt:hidden", "write", "invalid-path"],
    ["*.txt", "read", "invalid-path"],
    ["", "read", "invalid-path"],
    [".env", "read", "secret-file"],
    ["config/.env.local", "read", "secret-file"],
  ] as const)("%p for %p is blocked as %p", (raw, op, block) => {
    expect(checkPath(raw, work, op, policy)).toEqual({ block });
  });

  test("protected folders, by absolute path, traversal or a junction", () => {
    expect(checkPath(join(root, "secret", "key.txt"), work, "read", policy)).toEqual({
      block: "protected-path",
    });
    expect(checkPath("..\\secret\\key.txt", work, "write", policy)).toEqual({
      block: "protected-path",
    });
    expect(checkPath("link\\key.txt", work, "read", policy)).toEqual({ block: "protected-path" });
  });

  test("read-only folders can be read but not written", () => {
    const file = join(root, "system", "x.txt");
    expect(checkPath(file, work, "read", policy)).toEqual({ path: file });
    expect(checkPath(file, work, "write", policy)).toEqual({ block: "protected-path" });
  });

  test("ordinary paths, .env.example and writing a new .env pass", () => {
    expect(checkPath("notes.txt", work, "read", policy)).toEqual({ path: join(work, "notes.txt") });
    expect(checkPath(".env.example", work, "read", policy)).toHaveProperty("path");
    expect(checkPath(".env", work, "write", policy)).toHaveProperty("path");
  });

  test("the default policy covers credentials, Bochica's data and Windows", () => {
    const env = {
      USERPROFILE: "C:\\Users\\demo",
      APPDATA: "C:\\Users\\demo\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local",
      SystemRoot: "C:\\Windows",
      ProgramFiles: "C:\\Program Files",
    };
    const defaults = defaultPathPolicy(env, "C:\\Users\\demo\\AppData\\Roaming\\Bochica");
    const at = (path: string, op: "read" | "write") => checkPath(path, "C:\\work", op, defaults);
    expect(at("C:\\Users\\demo\\.ssh\\id_rsa", "read")).toEqual({ block: "protected-path" });
    expect(at("c:\\users\\DEMO\\.aws\\credentials", "read")).toEqual({ block: "protected-path" });
    expect(at("C:\\Users\\demo\\AppData\\Roaming\\Bochica\\bochica.db", "read")).toEqual({
      block: "protected-path",
    });
    expect(
      at("C:\\Users\\demo\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cookies", "read"),
    ).toEqual({ block: "protected-path" });
    expect(at("C:\\Windows\\win.ini", "write")).toEqual({ block: "protected-path" });
    expect(at("C:\\Program Files/EPLAN/x.txt", "write")).toEqual({ block: "protected-path" });
    expect(at("C:\\Windows\\win.ini", "read")).toHaveProperty("path");
    expect(at("C:\\Users\\demo\\Documents\\x.txt", "write")).toHaveProperty("path");
  });
});

describe("globToRegExp", () => {
  test.each([
    ["**/*.cs", "scripts/Export.cs", true],
    ["**/*.cs", "Export.cs", true],
    ["*.cs", "scripts/Export.cs", false],
    ["scripts/*.{cs,vb}", "scripts/a.vb", true],
    ["report?.pdf", "report1.pdf", true],
    ["report?.pdf", "report10.pdf", false],
  ])("%p on %p is %p", (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});

describe("file tools", () => {
  test("read_file numbers lines and pages", async () => {
    const result = await run("read_file", { path: "notes.txt", offset: 2, limit: 1 });
    expect(result).toEqual({
      ok: true,
      text: "2\tsecond line\n\n[3 lines in total; use offset to read more]",
    });
  });

  test("read_file refuses .env, binary files and folders", async () => {
    expect(await run("read_file", { path: ".env" })).toEqual({ blocked: "secret-file" });
    expect(run("read_file", { path: "image.bin" })).rejects.toThrow("binary");
    expect(run("read_file", { path: "scripts" })).rejects.toThrow("folder");
  });

  test("list_files matches globs and skips node_modules", async () => {
    const result = await run("list_files", { pattern: "**/*.cs" });
    expect(result).toEqual({
      ok: true,
      text: ["scripts\\Export.cs", "scripts\\Report.cs"].join("\n"),
    });
  });

  test("search_files finds lines, filters by glob and skips .env", async () => {
    const result = await run("search_files", { pattern: "eplan\\.eplapi", glob: "*.cs" });
    expect(result).toEqual({ ok: true, text: "scripts\\Export.cs:1: using Eplan.EplApi;" });
    expect(await run("search_files", { pattern: "API_KEY=abc" })).toEqual({
      ok: true,
      text: "No matches.",
    });
    expect(await run("search_files", { pattern: "(" })).toHaveProperty("ok", false);
  });

  test("write_file creates folders and reports a diff", async () => {
    const result = await run("write_file", { path: "out/new.txt", content: "a\nb\n" });
    expect(result).toMatchObject({
      ok: true,
      text: "Created out\\new.txt (2 lines).",
      diff: { path: "out\\new.txt", added: 2, removed: 0 },
    });
    expect(readFileSync(join(work, "out", "new.txt"), "utf8")).toBe("a\nb\n");
  });

  test("write_file refuses protected folders before asking", async () => {
    expect(await run("write_file", { path: "..\\system\\x.txt", content: "" })).toEqual({
      blocked: "protected-path",
    });
  });

  test("edit_file keeps CRLF and reports what changed", async () => {
    const result = await run("edit_file", {
      path: "scripts/Export.cs",
      old_text: "class Export {}\n",
      new_text: "class Export\n{\n}\n",
    });
    expect(result).toMatchObject({ ok: true, diff: { added: 3, removed: 1 } });
    expect(readFileSync(join(work, "scripts", "Export.cs"), "utf8")).toBe(
      "using Eplan.EplApi;\r\nclass Export\r\n{\r\n}\r\n",
    );
  });

  test("edit_file needs a unique match unless replace_all", async () => {
    writeFileSync(join(work, "twice.txt"), "x = 1\nx = 1\n");
    expect(
      await run("edit_file", { path: "twice.txt", old_text: "x = 1", new_text: "x = 2" }),
    ).toMatchObject({ ok: false });
    expect(
      await run("edit_file", { path: "twice.txt", old_text: "y", new_text: "z" }),
    ).toMatchObject({ ok: false });
    expect(
      await run("edit_file", {
        path: "twice.txt",
        old_text: "x = 1",
        new_text: "x = 2",
        replace_all: true,
      }),
    ).toMatchObject({ ok: true, diff: { added: 2, removed: 2 } });
  });

  test("reads ask nothing; writes ask", () => {
    expect(get("read_file").approval).toBe("never");
    expect(get("search_files").approval).toBe("never");
    expect(get("write_file").approval).toBe("ask");
    expect(get("edit_file").approval).toBe("ask");
  });
});

describe("findFiles", () => {
  test("matches by path, names first, and leaves out secrets, generated and hidden folders", async () => {
    mkdirSync(join(work, ".hidden"), { recursive: true });
    writeFileSync(join(work, ".hidden", "export-notes.txt"), "x");
    writeFileSync(join(work, "exports-list.txt"), "x");
    const all = await findFiles({ cwd: work, policy }, "", signal);
    expect(all).toContain("notes.txt");
    expect(all).toContain(".env.example");
    expect(all).not.toContain(".env");
    expect(all.some((f) => f.startsWith("node_modules/") || f.startsWith(".hidden/"))).toBe(false);
    expect(all.some((f) => f.startsWith("link/"))).toBe(false);
    expect(await findFiles({ cwd: work, policy }, "EXPORT", signal)).toEqual([
      "exports-list.txt",
      "scripts/Export.cs",
    ]);
    expect(await findFiles({ cwd: work, policy }, "scripts\\rep", signal)).toEqual([
      "scripts/Report.cs",
    ]);
  });
});
