import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { findSkillDirs, loadSkill, type Skill, type SkillLoad, SkillSet } from "@bochica/agent";
import type { SkillInfo, SkillInstallReport } from "@bochica/shared";

// Skills come from two places. Built in: eplan-scripting-skill and eec-pro-skill, each
// downloaded once at the commit pinned in components.lock.json and cached under userData, or
// read from local checkouts during development (BOCHICA_SKILLS_DIR); in Consult their guides go
// into the system prompt. Added by the user: copied from a folder they pick into
// userData\skills\user\<name>, which the file tools can't write, so the agent can never add or
// change a skill itself.

/** The built-in skills of each repository, as folders inside its skills/ folder. */
export const BUILTIN_SKILLS = {
  "eplan-scripting-skill": ["eplan-p8/eplan-scripting"],
  "eec-pro-skill": ["eec-pro-development"],
} as const;

/** The composer's own `/` commands (composer.tsx); no added skill may take these names. */
const APP_COMMANDS = ["new", "consult", "tasks", "draw", "settings", "compact"];

interface Source {
  repository: string;
  commit: string;
}

/** A loaded (or refused) skill and where it came from. */
interface SkillEntry {
  id: string;
  source: SkillInfo["source"];
  load: SkillLoad;
}

/** The built-in skills of one repository: downloaded at the pinned commit, or a local checkout. */
export class BuiltinSkills {
  /**
   * @param root the folder that contains the skill folders: a local checkout's `skills/`, or
   *   the cache, which mirrors it.
   * @param dirs the skill folders to use, relative to `root`.
   */
  constructor(
    private readonly root: string,
    private readonly dirs: readonly string[],
    private readonly source: Source | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Downloads the skills if they aren't cached yet, then reads them. Never throws. */
  async load(): Promise<SkillEntry[]> {
    try {
      if (this.source && !existsSync(join(this.root, ".complete")))
        await this.download(this.source);
      return this.dirs
        .filter((dir) => existsSync(join(this.root, dir, "SKILL.md")))
        .map((dir) => ({ id: dir, source: "builtin", load: loadSkill(join(this.root, dir), dir) }));
    } catch {
      return [];
    }
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
      (e) => e.type === "blob" && this.dirs.some((dir) => e.path.startsWith(`skills/${dir}/`)),
    );
    await Promise.all(
      wanted.map(async (entry) => {
        const file = await this.fetchImpl(
          `https://raw.githubusercontent.com/${repo}/${commit}/${entry.path}`,
          { signal: AbortSignal.timeout(20_000) },
        );
        if (!file.ok) throw new Error(`Downloading ${entry.path} failed: ${file.status}`);
        const target = join(this.root, entry.path.replace(/^skills\//, ""));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, await file.text());
      }),
    );
    // Written last: a download cut short is retried on the next start.
    writeFileSync(join(this.root, ".complete"), commit);
  }
}

/**
 * Deletes cached downloads of commits no longer pinned, inside `root` (userData\skills). Only
 * folders named like a commit are touched; added skills live in `user` and stay.
 */
export function removeStaleCaches(root: string, pinned: readonly string[]): void {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return;
  }
  for (const name of names) {
    if (/^[0-9a-f]{40}$/.test(name) && !pinned.includes(name))
      rmSync(join(root, name), { recursive: true, force: true });
  }
}

/** Where the on/off switches of added skills are kept (settings.json). */
export interface SkillSwitches {
  isSkillEnabled(id: string): boolean;
  setSkillEnabled(id: string, enabled: boolean): void;
}

export class SkillService {
  private entries: SkillEntry[] = [];

  /**
   * @param builtin one source per repository of built-in skills.
   * @param userRoot where added skills are copied, one folder per skill name.
   */
  constructor(
    private readonly builtin: readonly BuiltinSkills[],
    private readonly userRoot: string,
    private readonly switches: SkillSwitches,
  ) {}

  /** Reads every skill again. Never throws. */
  async load(): Promise<void> {
    // Each repository on its own: one that can't be downloaded doesn't hold back the others.
    const builtin = await Promise.all(this.builtin.map((source) => source.load()));
    this.entries = [...builtin.flat(), ...this.loadUser()];
  }

  private loadUser(): SkillEntry[] {
    let names: string[];
    try {
      names = readdirSync(this.userRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
    return names.map((name) => ({
      id: name,
      source: "user",
      load: loadSkill(join(this.userRoot, name), name),
    }));
  }

  private enabled(entry: SkillEntry): boolean {
    return entry.source === "builtin" || this.switches.isSkillEnabled(entry.id);
  }

  /** Every skill, for Settings: loaded, left out by the injection scan, or broken. */
  list(): SkillInfo[] {
    return this.entries.map(({ id, source, load }) => {
      const common = { id, source, enabled: this.enabled({ id, source, load }) };
      if (load.status === "ok") {
        const { name, description } = load.skill;
        return { ...common, name, description, status: "ok" };
      }
      if (load.status === "skipped") {
        const { name, description, findings } = load;
        return { ...common, name, description, status: "skipped", findings };
      }
      return { ...common, name: id, description: "", status: "invalid", problem: load.problem };
    });
  }

  /** Skills left out by the injection scan, for the log. */
  skipped(): Array<{
    id: string;
    findings: Extract<SkillLoad, { status: "skipped" }>["findings"];
  }> {
    return this.entries.flatMap(({ id, load }) =>
      load.status === "skipped" ? [{ id, findings: load.findings }] : [],
    );
  }

  /** Built-in skills that loaded: Consult puts their guides in the system prompt. */
  guides(): Skill[] {
    return this.entries.flatMap((entry) =>
      entry.source === "builtin" && entry.load.status === "ok" ? [entry.load.skill] : [],
    );
  }

  /** Skills the model may use this turn: built-in ones and the added ones switched on. */
  available(): SkillSet {
    return new SkillSet(
      this.entries.flatMap((entry) =>
        entry.load.status === "ok" && this.enabled(entry) ? [entry.load.skill] : [],
      ),
    );
  }

  /**
   * Adds the skill in `folder`, or every skill below it. Each one is checked before it is
   * copied (format, size, injection scan); one with the same name as an added skill replaces
   * it, one named like a built-in skill is refused.
   */
  async install(folder: string): Promise<SkillInstallReport> {
    const report: SkillInstallReport = { installed: [], refused: [] };
    const dirs = findSkillDirs(folder);
    if (dirs.length === 0) {
      report.refused.push({ folder: basename(folder), problem: "no-skill-file" });
      return report;
    }
    // The composer's app commands are typed like skills (`/tasks`), so their names are taken.
    const takenNames = new Set([...APP_COMMANDS, ...this.guides().map((skill) => skill.name)]);
    mkdirSync(this.userRoot, { recursive: true });
    for (const dir of dirs) {
      const source = dir ? join(folder, dir) : folder;
      const label = basename(source);
      const load = loadSkill(source, label);
      if (load.status === "invalid") {
        report.refused.push({ folder: label, problem: load.problem });
        continue;
      }
      if (load.status === "skipped") {
        report.refused.push({ folder: label, problem: "injection", findings: load.findings });
        continue;
      }
      const { name } = load.skill;
      if (takenNames.has(name)) {
        report.refused.push({ folder: label, problem: "name-taken" });
        continue;
      }
      // Copied to a temporary folder first, so a failed copy never leaves half a skill.
      const incoming = join(this.userRoot, `.incoming-${randomUUID()}`);
      try {
        cpSync(source, incoming, {
          recursive: true,
          // Links could point anywhere on the machine; Git metadata isn't part of a skill.
          filter: (path) => !lstatSync(path).isSymbolicLink() && basename(path) !== ".git",
        });
        const target = join(this.userRoot, name);
        rmSync(target, { recursive: true, force: true });
        renameSync(incoming, target);
        report.installed.push(name);
      } finally {
        rmSync(incoming, { recursive: true, force: true });
      }
    }
    await this.load();
    return report;
  }

  /** Deletes Bochica's copy of an added skill; the folder it came from is not touched. */
  async remove(id: string): Promise<void> {
    const entry = this.entries.find((e) => e.id === id && e.source === "user");
    if (!entry) throw new Error(`No added skill ${id}.`);
    rmSync(join(this.userRoot, entry.id), { recursive: true, force: true });
    await this.load();
  }

  setEnabled(id: string, enabled: boolean): void {
    if (!this.entries.some((e) => e.id === id && e.source === "user"))
      throw new Error(`No added skill ${id}.`);
    this.switches.setSkillEnabled(id, enabled);
  }
}
