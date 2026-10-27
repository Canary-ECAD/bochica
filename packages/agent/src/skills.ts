import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { COMMAND_NAME, type ChatMessage, parseSlashCommand } from "@bochica/shared";
import { type InjectionFinding, scanContextFile } from "./injection";
import type { AgentTool } from "./tools";

// Skills in the agentskills.io format: a folder with a SKILL.md (front matter with name and
// description, then instructions) and optional reference files. Only name and description go
// into the prompt; the model loads the instructions with use_skill when a request needs them.

export interface Skill {
  /** Unique key: the folder inside its source, e.g. "eplan-p8/eplan-scripting" or "plc-labels". */
  id: string;
  name: string;
  description: string;
  /** The SKILL.md body, without its front matter. */
  body: string;
  /** Reference files as `<id>/<path inside the skill>`, for read_skill_file. */
  references: string[];
  /** The skill's folder on disk. */
  dir: string;
}

/** Why a folder is not a usable skill. */
export type SkillProblem =
  | "no-skill-file"
  | "no-front-matter"
  | "bad-name"
  | "missing-description"
  | "long-description"
  | "too-large";

/** An injection finding in one of the skill's Markdown files. */
export interface SkillFinding extends InjectionFinding {
  /** The file, relative to the skill's folder, with forward slashes. */
  file: string;
}

export type SkillLoad =
  | { status: "ok"; skill: Skill }
  | { status: "invalid"; problem: SkillProblem }
  | { status: "skipped"; name: string; description: string; findings: SkillFinding[] };

const MAX_DESCRIPTION = 1024;
const MAX_SKILL_FILES = 200;
const MAX_SKILL_BYTES = 5 * 1024 * 1024;

type ParsedSkill =
  | { ok: true; name: string; description: string; body: string }
  | { ok: false; problem: SkillProblem };

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) return v.slice(1, -1);
  return v;
}

/**
 * The front matter's top-level `key: value` fields. Enough YAML for skill headers: quoted
 * values, `>` / `|` blocks and indented continuation lines; nested maps are skipped.
 */
function frontMatterFields(front: string): Map<string, string> {
  const fields = new Map<string, string>();
  const lines = front.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i] ?? "");
    if (!match?.[1]) continue;
    const continuation: string[] = [];
    while (i + 1 < lines.length && /^([ \t]+\S|[ \t]*$)/.test(lines[i + 1] ?? "")) {
      continuation.push((lines[++i] ?? "").trim());
    }
    const inline = match[2] ?? "";
    const block = /^[>|][+-]?$/.test(inline.trim());
    const parts = block ? continuation : [inline, ...continuation];
    const joined = parts.filter((p) => p !== "").join(inline.trim().startsWith("|") ? "\n" : " ");
    fields.set(match[1], unquote(joined));
  }
  return fields;
}

/** A SKILL.md's name, description and body, or what is wrong with it. */
export function parseSkillFile(text: string): ParsedSkill {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) return { ok: false, problem: "no-front-matter" };
  const fields = frontMatterFields(match[1] ?? "");
  const name = fields.get("name") ?? "";
  const description = fields.get("description") ?? "";
  if (!COMMAND_NAME.test(name) || name.includes("--")) return { ok: false, problem: "bad-name" };
  if (!description) return { ok: false, problem: "missing-description" };
  if (description.length > MAX_DESCRIPTION) return { ok: false, problem: "long-description" };
  return { ok: true, name, description, body: (match[2] ?? "").trim() };
}

/** Every file under `dir`, relative to it with forward slashes. Links are not followed. */
function skillFiles(dir: string, sub = ""): string[] {
  return readdirSync(join(dir, sub)).flatMap((entry) => {
    const path = sub ? `${sub}/${entry}` : entry;
    const info = lstatSync(join(dir, path));
    if (info.isSymbolicLink()) return [];
    return info.isDirectory() ? skillFiles(dir, path) : [path];
  });
}

/**
 * Reads a skill folder. Every Markdown file is scanned for prompt injection (guardrails
 * layer 8): the instructions go into the model's context and references can be read later.
 */
export function loadSkill(dir: string, id: string): SkillLoad {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return { status: "invalid", problem: "no-skill-file" };
  const files = skillFiles(dir);
  const bytes = files.reduce((sum, path) => sum + lstatSync(join(dir, path)).size, 0);
  if (files.length > MAX_SKILL_FILES || bytes > MAX_SKILL_BYTES) {
    return { status: "invalid", problem: "too-large" };
  }
  const parsed = parseSkillFile(readFileSync(file, "utf8"));
  if (!parsed.ok) return { status: "invalid", problem: parsed.problem };
  const findings = files
    .filter((path) => /\.(md|markdown|txt)$/i.test(path))
    .flatMap((path) =>
      scanContextFile(readFileSync(join(dir, path), "utf8")).map((f) => ({ ...f, file: path })),
    );
  if (findings.length > 0) {
    return { status: "skipped", name: parsed.name, description: parsed.description, findings };
  }
  return {
    status: "ok",
    skill: {
      id,
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
      references: files.filter((path) => path !== "SKILL.md").map((path) => `${id}/${path}`),
      dir,
    },
  };
}

/**
 * The skill folders under `root`: `root` itself when it has a SKILL.md, otherwise every folder
 * below it (up to three levels) that has one. Relative paths, "" for `root` itself.
 */
export function findSkillDirs(root: string, sub = "", depth = 0): string[] {
  if (existsSync(join(root, sub, "SKILL.md"))) return [sub];
  if (depth >= 3) return [];
  let entries: string[];
  try {
    entries = readdirSync(join(root, sub));
  } catch {
    return [];
  }
  return entries
    .filter((entry) => !entry.startsWith("."))
    .filter((entry) => {
      const info = lstatSync(join(root, sub, entry));
      return info.isDirectory() && !info.isSymbolicLink();
    })
    .flatMap((entry) => findSkillDirs(root, sub ? `${sub}/${entry}` : entry, depth + 1));
}

/** What use_skill and a `/skill` command give the model. */
function skillInstructions(skill: Skill): string {
  const references =
    skill.references.length > 0
      ? `\n\nReference files you can open with bochica__read_skill_file:\n${skill.references.map((r) => `- ${r}`).join("\n")}`
      : "";
  return `<skill name="${skill.name}">\n${skill.body}${references}\n</skill>`;
}

/** The skills the model can use this turn, and the two read-only tools that open them. */
export class SkillSet {
  constructor(readonly skills: readonly Skill[]) {}

  find(name: string): Skill | undefined {
    return this.skills.find((skill) => skill.name === name || skill.id === name);
  }

  /** Reads `<skill id>/<path>`; anything outside that skill's folder is refused. */
  read(path: string): string {
    const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
    const skill = this.skills
      .filter((s) => normalized.startsWith(`${s.id}/`))
      .toSorted((a, b) => b.id.length - a.id.length)[0];
    if (!skill) throw new Error(`No skill file ${path}. Use a path listed by the skill.`);
    const root = resolve(skill.dir);
    const target = resolve(root, normalized.slice(skill.id.length + 1));
    const inside = relative(root, target);
    if (
      !inside ||
      inside.startsWith("..") ||
      inside.includes(":") ||
      resolve(root, inside) !== target
    ) {
      throw new Error("Only files inside a skill's folder can be read.");
    }
    if (
      !existsSync(target) ||
      lstatSync(target).isDirectory() ||
      lstatSync(target).isSymbolicLink()
    )
      throw new Error(`No skill file ${path}.`);
    return readFileSync(target, "utf8");
  }

  tools(): AgentTool[] {
    if (this.skills.length === 0) return [];
    return [
      {
        name: "bochica__use_skill",
        server: "bochica",
        tool: "use_skill",
        description:
          "Load a skill's instructions (skills are listed in the system prompt). Call it before working on a request the skill covers, and follow what it says.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "The skill's name" } },
          required: ["name"],
        },
        approval: "never",
        execute: async (input) => {
          const name = (input as { name?: unknown }).name;
          const skill = typeof name === "string" ? this.find(name) : undefined;
          if (!skill) {
            const known = this.skills.map((s) => s.name).join(", ");
            return { ok: false, text: `No skill named ${String(name)}. Skills: ${known}.` };
          }
          return { ok: true, text: skillInstructions(skill) };
        },
      },
      {
        name: "bochica__read_skill_file",
        server: "bochica",
        tool: "read_skill_file",
        description:
          "Read a reference file of a skill or of the EPLAN scripting guide, by the path listed with it (e.g. eplan-p8/eplan-scripting/references/pitfalls.md).",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string", description: "Path of the reference file" } },
          required: ["path"],
        },
        approval: "never",
        execute: async (input) => {
          const path = (input as { path?: unknown }).path;
          if (typeof path !== "string") return { ok: false, text: "Missing path." };
          try {
            return { ok: true, text: this.read(path) };
          } catch (error) {
            return { ok: false, text: error instanceof Error ? error.message : String(error) };
          }
        },
      },
    ];
  }
}

/**
 * The history with every `/skill …` message replaced by the skill's instructions and the
 * request, so the model follows the skill the user called. Other messages are unchanged.
 */
export function expandSkillCommands(
  messages: ChatMessage[],
  find: (name: string) => Skill | undefined,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;
    const command = parseSlashCommand(message.content);
    const skill = command ? find(command.name) : undefined;
    if (!command || !skill) return message;
    return {
      ...message,
      content: `The user called the skill "${skill.name}" (/${skill.name}). Follow its instructions for this request.\n\n${skillInstructions(skill)}\n\nRequest: ${command.args || "(no details: do what the skill is for, and ask if you need more)"}`,
    };
  });
}
