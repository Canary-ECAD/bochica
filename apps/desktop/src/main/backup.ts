import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Guardrails layer 6: no project change without a backup. Before the first project-changing
// tool call on a project in a session, Bochica backs the project up with eplan-mcp's own
// backup action (method BACKUP: a copy, the source is untouched). If the backup fails, the
// change does not run.

type CallTool = (
  tool: string,
  args: Record<string, unknown>,
) => Promise<{ ok: boolean; text: string }>;

export interface BackupResult {
  status: "done" | "already" | "no-project";
  project?: string;
  archive?: string;
}

const PROJECT_EXTENSION = /\.(elk|elp|els|elx|ell|elr|elt|ema|elm)$/i;
const PROJECT_ARGUMENTS = ["project_name", "project_path", "project", "projectPath", "PROJECT"];

/** The project a tool call names explicitly, if any. */
function projectFromInput(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  for (const key of PROJECT_ARGUMENTS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "string" && PROJECT_EXTENSION.test(value.trim())) return value.trim();
  }
  return undefined;
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** File name without folder or extension, safe for a folder and archive name. */
function projectBaseName(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? "project";
  return name.replace(PROJECT_EXTENSION, "").replace(/[<>:"/\\|?*]/g, "_") || "project";
}

const pad = (n: number): string => String(n).padStart(2, "0");

function timestamp(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export class BackupGuard {
  /** session id + project path (lower case) */
  private readonly backedUp = new Set<string>();

  constructor(
    private readonly call: CallTool,
    private readonly root: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Makes sure the project a call will change has a backup from this session. Throws when the
   * backup fails; the caller must then not run the change.
   */
  async ensure(
    sessionId: string,
    input: unknown,
    onStart: (project: string) => void = () => {},
  ): Promise<BackupResult> {
    const project = projectFromInput(input) ?? (await this.currentProject());
    if (!project) return { status: "no-project" };
    const name = projectBaseName(project);
    const key = `${sessionId}\u0000${project.toLowerCase()}`;
    if (this.backedUp.has(key)) return { status: "already", project: name };

    onStart(name);
    const destination = join(this.root, name);
    mkdirSync(destination, { recursive: true });
    const archive = `${name}-${timestamp(this.now())}.zw1`;
    const result = await this.call("eplan_backup_project", {
      destination_path: destination,
      archive_name: archive,
      project_name: project,
      backup_method: "BACKUP",
    });
    if (!result.ok || parseJson(result.text)?.["success"] === false) {
      throw new Error(`EPLAN could not back up ${name}: ${result.text.slice(0, 300)}`);
    }
    this.backedUp.add(key);
    return { status: "done", project: name, archive: join(destination, archive) };
  }

  private async currentProject(): Promise<string | undefined> {
    const result = await this.call("eplan_get_current_project", {});
    if (!result.ok) return undefined;
    const parameters = parseJson(result.text)?.["parameters"];
    const project =
      typeof parameters === "object" && parameters !== null
        ? (parameters as Record<string, unknown>)["PROJECT"]
        : undefined;
    return typeof project === "string" && project.trim() ? project.trim() : undefined;
  }
}
