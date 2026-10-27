import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { AgentTool } from "@bochica/agent";

// eplan-scripting-skill for Consult mode. Downloaded once at the commit pinned in
// components.lock.json and cached under userData, or read from a local checkout during
// development (BOCHICA_SKILLS_DIR). The general skills system comes in S8.

export interface Skill {
  name: string;
  description: string;
  /** The SKILL.md body, without its front matter. */
  body: string;
  /** Reference files, relative to the skills folder, for bochica__read_skill_file. */
  references: string[];
}

/** The skills Consult mode loads, inside the repository's skills/ folder. */
const SKILL_DIRS = ["eplan-p8/eplan-scripting", "eec-pro/eec-pro-development"];

interface Source {
  repository: string;
  commit: string;
}

function parseSkill(text: string): { name: string; description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const front = match?.[1] ?? "";
  const field = (key: string) =>
    new RegExp(`^${key}:\\s*(.+)$`, "m")
      .exec(front)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "") ?? "";
  return {
    name: field("name"),
    description: field("description"),
    body: (match?.[2] ?? text).trim(),
  };
}

function listFiles(root: string, dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(join(root, path)).isDirectory() ? listFiles(root, path) : [path];
  });
}

export class SkillStore {
  private skills: Skill[] = [];

  /**
   * @param skillsRoot the folder that contains the skill folders: a local checkout's
   *   `skills/`, or the cache, which mirrors it.
   */
  constructor(
    private readonly skillsRoot: string,
    private readonly source: Source | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  loaded(): Skill[] {
    return this.skills;
  }

  /** Downloads the skill if it isn't cached yet, then reads it. Never throws. */
  async load(): Promise<Skill[]> {
    try {
      if (this.source && !existsSync(join(this.skillsRoot, ".complete")))
        await this.download(this.source);
      this.skills = SKILL_DIRS.flatMap((dir) => {
        const file = join(this.skillsRoot, dir, "SKILL.md");
        if (!existsSync(file)) return [];
        const parsed = parseSkill(readFileSync(file, "utf8"));
        const references = listFiles(this.skillsRoot, dir)
          .filter((path) => !path.endsWith("SKILL.md"))
          .map((path) => path.split(sep).join("/"));
        return [{ ...parsed, name: parsed.name || dir, references }];
      });
    } catch {
      this.skills = [];
    }
    return this.skills;
  }

  /** Reads a file inside the skills folder; anything outside it is refused. */
  read(path: string): string {
    const root = resolve(this.skillsRoot);
    const target = resolve(root, path);
    const inside = relative(root, target);
    if (
      !inside ||
      inside.startsWith("..") ||
      resolve(root, inside) !== target ||
      inside.includes(":")
    ) {
      throw new Error("Only files inside the scripting skill can be read.");
    }
    if (!existsSync(target) || statSync(target).isDirectory())
      throw new Error(`No such skill file: ${path}`);
    return readFileSync(target, "utf8");
  }

  /** Read-only tool for the model to open a reference file the SKILL.md points to. */
  readTool(): AgentTool {
    return {
      name: "bochica__read_skill_file",
      server: "bochica",
      tool: "read_skill_file",
      description:
        "Read a reference file of the EPLAN scripting guide (paths are listed in the system prompt, e.g. eplan-p8/eplan-scripting/references/pitfalls.md).",
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
    };
  }

  private async download({ repository, commit }: Source): Promise<void> {
    const repo = repository.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
    const tree = await this.fetchImpl(
      `https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!tree.ok) throw new Error(`GitHub answered ${tree.status}`);
    const { tree: entries } = (await tree.json()) as {
      tree: Array<{ path: string; type: string }>;
    };
    const wanted = entries.filter(
      (e) => e.type === "blob" && SKILL_DIRS.some((dir) => e.path.startsWith(`skills/${dir}/`)),
    );
    await Promise.all(
      wanted.map(async (entry) => {
        const file = await this.fetchImpl(
          `https://raw.githubusercontent.com/${repo}/${commit}/${entry.path}`,
          { signal: AbortSignal.timeout(20_000) },
        );
        if (!file.ok) throw new Error(`Downloading ${entry.path} failed: ${file.status}`);
        const target = join(this.skillsRoot, entry.path.replace(/^skills\//, ""));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, await file.text());
      }),
    );
    // Written last: a download cut short is retried on the next start.
    writeFileSync(join(this.skillsRoot, ".complete"), commit);
  }
}
