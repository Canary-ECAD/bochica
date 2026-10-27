import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, win32 } from "node:path";
import type { AgentTool, Assessment, ToolRunResult } from "../tools";
import { diffFiles } from "./diff";
import { checkPath, isSecretFile, type PathBlock, type PathPolicy } from "./paths";

// The built-in file tools: read, list, search, write and edit. Paths are relative to the
// session's working folder unless absolute, and every one goes through checkPath first.

export interface FileToolOptions {
  /** The session's working folder. */
  cwd: string;
  policy: PathPolicy;
}

const READ_LIMIT_BYTES = 10 * 1024 * 1024;
const SEARCH_FILE_LIMIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_READ_LINES = 2_000;
const MAX_LINE_CHARS = 2_000;
const MAX_LIST_RESULTS = 500;
const MAX_MATCHES = 200;
const MAX_VISITED = 20_000;
/** Folders never walked into: huge, generated or system-owned. */
const SKIP_DIRS = new Set([".git", "node_modules", "$recycle.bin", "system volume information"]);

const pathBlockReasons: Record<PathBlock, string> = {
  "device-path": "device and NT namespace paths (\\\\?\\, \\\\.\\) are not allowed.",
  "invalid-path": "the path is not a valid file path (wildcards, alternate data streams…).",
  "protected-path":
    "the path is in a protected location (credentials, browser profiles, Bochica's own data, or Windows / Program Files for writes).",
  "secret-file": "files such as .env hold secrets; Bochica never reads them.",
};

function field(input: unknown, name: string): unknown {
  return typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)[name]
    : undefined;
}

function text(input: unknown, name: string): string {
  const value = field(input, name);
  return typeof value === "string" ? value : "";
}

/** The tools' assess hook: refuses a bad path before anyone is asked. */
function assessPath(options: FileToolOptions, op: "read" | "write", name = "path") {
  return (input: unknown): Assessment => {
    const raw = text(input, name) || ".";
    const check = checkPath(raw, options.cwd, op, options.policy);
    return "block" in check
      ? { block: check.block, reason: pathBlockReasons[check.block] }
      : { risks: [] };
  };
}

/** Resolves and checks again at run time; throws with the reason if refused. */
function resolvePath(options: FileToolOptions, raw: string, op: "read" | "write"): string {
  const check = checkPath(raw || ".", options.cwd, op, options.policy);
  if ("block" in check) throw new Error(`Refused: ${pathBlockReasons[check.block]}`);
  return check.path;
}

/** Shows a path relative to the working folder when it is inside it. */
function display(options: FileToolOptions, path: string): string {
  const rel = relative(options.cwd, path);
  return rel && !rel.startsWith("..") && !win32.isAbsolute(rel) ? rel : path;
}

interface Decoded {
  text: string;
  bom: "" | "utf8" | "utf16le";
}

function decode(buffer: Buffer): Decoded | null {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString("utf16le"), bom: "utf16le" };
  }
  const bom = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const body = bom ? buffer.subarray(3) : buffer;
  if (body.subarray(0, 8192).includes(0)) return null;
  return { text: body.toString("utf8"), bom: bom ? "utf8" : "" };
}

function encode(content: string, bom: Decoded["bom"]): Buffer {
  if (bom === "utf16le")
    return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, "utf16le")]);
  const body = Buffer.from(content, "utf8");
  return bom === "utf8" ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

async function readText(path: string, limit = READ_LIMIT_BYTES): Promise<Decoded> {
  const info = await stat(path);
  if (info.isDirectory()) throw new Error(`${path} is a folder, not a file. Use list_files.`);
  if (info.size > limit) {
    throw new Error(`${path} is too large (${Math.round(info.size / 1024)} KB) to read here.`);
  }
  const decoded = decode(await readFile(path));
  if (!decoded) throw new Error(`${path} is a binary file; it can't be read as text.`);
  return decoded;
}

/** `**` any folders, `*` any name part, `?` one character, `{a,b}` either. */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  const pattern = glob.replaceAll("\\", "/");
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? "";
    if (c === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "{") source += "(?:";
    else if (c === "}") source += ")";
    else if (c === ",") source += "|";
    else source += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i");
}

interface Walked {
  files: string[];
  truncated: boolean;
}

/** Files under `root`, skipping generated and protected folders. */
async function walk(root: string, options: FileToolOptions, signal: AbortSignal): Promise<Walked> {
  const files: string[] = [];
  let visited = 0;
  const queue = [root];
  while (queue.length > 0) {
    if (signal.aborted) throw new Error("Stopped.");
    const dir = queue.shift() ?? "";
    let entries;
    try {
      // One folder at a time on purpose: the walk stops early at its limits or on Stop.
      // oxlint-disable-next-line no-await-in-loop
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (++visited > MAX_VISITED) return { files, truncated: true };
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        if ("block" in checkPath(path, options.cwd, "read", options.policy)) continue;
        queue.push(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
  return { files, truncated: false };
}

const pathProperty = (description: string) => ({ type: "string", description });

function tool(name: string, rest: Omit<AgentTool, "name" | "server" | "tool">): AgentTool {
  return { name: `bochica__${name}`, server: "bochica", tool: name, ...rest };
}

export function fileTools(options: FileToolOptions): AgentTool[] {
  return [
    tool("read_file", {
      description:
        "Read a text file. Returns numbered lines. Paths are relative to the working folder unless absolute. Use offset and limit for long files.",
      inputSchema: {
        type: "object",
        properties: {
          path: pathProperty("The file to read."),
          offset: { type: "integer", minimum: 1, description: "First line to return (1-based)." },
          limit: { type: "integer", minimum: 1, description: "How many lines to return." },
        },
        required: ["path"],
      },
      approval: "never",
      assess: assessPath(options, "read"),
      execute: async (input): Promise<ToolRunResult> => {
        const path = resolvePath(options, text(input, "path"), "read");
        const { text: content } = await readText(path);
        const all = content === "" ? [] : content.replace(/\r?\n$/, "").split(/\r?\n/);
        const offset = Math.max(1, Number(field(input, "offset")) || 1);
        const limit = Math.max(1, Number(field(input, "limit")) || DEFAULT_READ_LINES);
        const slice = all.slice(offset - 1, offset - 1 + limit);
        const body = slice
          .map((line, i) => {
            const cut = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
            return `${offset + i}\t${cut}`;
          })
          .join("\n");
        const more =
          offset - 1 + slice.length < all.length
            ? `\n\n[${all.length} lines in total; use offset to read more]`
            : "";
        return { ok: true, text: (body || "[empty file]") + more };
      },
    }),

    tool("list_files", {
      description:
        "Find files by name with a glob pattern, e.g. **/*.cs or exports/*.pdf. Searches the working folder unless path is given.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern, relative to path." },
          path: pathProperty("Folder to search in."),
        },
        required: ["pattern"],
      },
      approval: "never",
      assess: assessPath(options, "read"),
      execute: async (input, signal): Promise<ToolRunResult> => {
        const root = resolvePath(options, text(input, "path"), "read");
        const pattern = globToRegExp(text(input, "pattern") || "**/*");
        const walked = await walk(root, options, signal);
        const matches = walked.files
          .map((file) => relative(root, file).replaceAll("\\", "/"))
          .filter((rel) => pattern.test(rel));
        if (matches.length === 0) return { ok: true, text: "No files found." };
        const shown = matches
          .slice(0, MAX_LIST_RESULTS)
          .map((rel) => display(options, join(root, rel)));
        const note =
          matches.length > MAX_LIST_RESULTS || walked.truncated
            ? `\n\n[showing ${shown.length} of ${matches.length}${walked.truncated ? "+" : ""} files; narrow the pattern]`
            : "";
        return { ok: true, text: shown.join("\n") + note };
      },
    }),

    tool("search_files", {
      description:
        "Search inside text files for a regular expression. Returns file:line: text for each match. Searches the working folder unless path is given; glob filters which files (e.g. *.cs).",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regular expression (JavaScript syntax)." },
          path: pathProperty("File or folder to search in."),
          glob: { type: "string", description: "Only search files matching this glob." },
          case_sensitive: { type: "boolean", description: "Default false." },
        },
        required: ["pattern"],
      },
      approval: "never",
      assess: assessPath(options, "read"),
      execute: async (input, signal): Promise<ToolRunResult> => {
        const root = resolvePath(options, text(input, "path"), "read");
        let regex: RegExp;
        try {
          regex = new RegExp(
            text(input, "pattern"),
            field(input, "case_sensitive") === true ? "" : "i",
          );
        } catch (error) {
          return { ok: false, text: `Invalid regular expression: ${(error as Error).message}` };
        }
        const globText = text(input, "glob");
        const glob = globText
          ? globToRegExp(globText.includes("/") ? globText : `**/${globText}`)
          : null;
        const info = await stat(root);
        const walked = info.isFile()
          ? { files: [root], truncated: false }
          : await walk(root, options, signal);
        const results: string[] = [];
        let total = 0;
        for (const file of walked.files) {
          if (signal.aborted) throw new Error("Stopped.");
          if (glob && !glob.test(relative(root, file).replaceAll("\\", "/"))) continue;
          if (isSecretFile(file)) continue;
          let decoded: Decoded;
          try {
            // One file at a time, so memory stays bounded on large folders.
            // oxlint-disable-next-line no-await-in-loop
            decoded = await readText(file, SEARCH_FILE_LIMIT_BYTES);
          } catch {
            continue;
          }
          const lines = decoded.text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = (lines[i] ?? "").slice(0, MAX_LINE_CHARS);
            if (!regex.test(line)) continue;
            total++;
            if (results.length < MAX_MATCHES) {
              results.push(`${display(options, file)}:${i + 1}: ${line.trim().slice(0, 300)}`);
            }
          }
        }
        if (total === 0) return { ok: true, text: "No matches." };
        const note =
          total > results.length
            ? `\n\n[${total} matches; showing the first ${results.length}]`
            : "";
        return { ok: true, text: results.join("\n") + note };
      },
    }),

    tool("write_file", {
      description:
        "Create a file, or replace a whole file, with the given text. Creates missing folders. Prefer edit_file for small changes to an existing file.",
      inputSchema: {
        type: "object",
        properties: {
          path: pathProperty("The file to write."),
          content: { type: "string", description: "The complete new content." },
        },
        required: ["path", "content"],
      },
      approval: "ask",
      assess: assessPath(options, "write"),
      execute: async (input): Promise<ToolRunResult> => {
        const path = resolvePath(options, text(input, "path"), "write");
        const content = text(input, "content");
        let before: Decoded | null = null;
        try {
          before = await readText(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, encode(content, before?.bom ?? ""));
        const lines = content === "" ? 0 : content.replace(/\r?\n$/, "").split(/\r?\n/).length;
        return {
          ok: true,
          text: `${before ? "Replaced" : "Created"} ${display(options, path)} (${lines} lines).`,
          diff: diffFiles(display(options, path), before?.text ?? "", content),
        };
      },
    }),

    tool("edit_file", {
      description:
        "Change part of a text file: replaces old_text with new_text exactly. old_text must appear once, unless replace_all is true; include enough surrounding lines to make it unique. Read the file first.",
      inputSchema: {
        type: "object",
        properties: {
          path: pathProperty("The file to edit."),
          old_text: { type: "string", description: "The exact text to replace." },
          new_text: { type: "string", description: "The text to put instead." },
          replace_all: { type: "boolean", description: "Replace every occurrence. Default false." },
        },
        required: ["path", "old_text", "new_text"],
      },
      approval: "ask",
      assess: assessPath(options, "write"),
      execute: async (input): Promise<ToolRunResult> => {
        const path = resolvePath(options, text(input, "path"), "write");
        const before = await readText(path);
        // Match the file's line endings, so text the model wrote with \n still matches.
        const crlf = before.text.includes("\r\n");
        const fix = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
        const oldText = fix(text(input, "old_text"));
        const newText = fix(text(input, "new_text"));
        if (oldText === "") return { ok: false, text: "old_text is empty." };
        if (oldText === newText) return { ok: false, text: "old_text and new_text are the same." };
        const count = before.text.split(oldText).length - 1;
        if (count === 0) {
          return {
            ok: false,
            text: "old_text was not found in the file. Read the file and copy the text exactly.",
          };
        }
        const all = field(input, "replace_all") === true;
        if (count > 1 && !all) {
          return {
            ok: false,
            text: `old_text appears ${count} times. Include more surrounding text to make it unique, or set replace_all.`,
          };
        }
        const after = all
          ? before.text.split(oldText).join(newText)
          : before.text.replace(oldText, () => newText);
        await writeFile(path, encode(after, before.bom));
        return {
          ok: true,
          text: `Edited ${display(options, path)}${all && count > 1 ? ` (${count} places)` : ""}.`,
          diff: diffFiles(display(options, path), before.text, after),
        };
      },
    }),
  ];
}

/** How many files the `@` menu offers at most. */
const MAX_PICKER_FILES = 50;

/**
 * Files of the working folder whose relative path contains `query` (case-insensitive), for the
 * composer's `@` menu: files whose name matches come first, then shallower ones. Hidden
 * folders, generated folders, protected places and secret files are left out.
 */
export async function findFiles(
  options: FileToolOptions,
  query: string,
  signal: AbortSignal,
): Promise<string[]> {
  const needle = query.trim().replaceAll("\\", "/").toLowerCase();
  const walked = await walk(options.cwd, options, signal);
  return walked.files
    .map((file) => relative(options.cwd, file).replaceAll("\\", "/"))
    .filter(
      (rel) =>
        !rel
          .split("/")
          .slice(0, -1)
          .some((dir) => dir.startsWith(".")),
    )
    .filter((rel) => !isSecretFile(rel) && rel.toLowerCase().includes(needle))
    .map((rel) => {
      const name = rel.split("/").at(-1)?.toLowerCase() ?? "";
      return { rel, rank: name.startsWith(needle) ? 0 : name.includes(needle) ? 1 : 2 };
    })
    .toSorted((a, b) => a.rank - b.rank || a.rel.split("/").length - b.rel.split("/").length)
    .slice(0, MAX_PICKER_FILES)
    .map(({ rel }) => rel);
}
