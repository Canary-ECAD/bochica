import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentTool,
  checkPath,
  checkWorkingFolder,
  fileTools,
  type PathPolicy,
  powershellTool,
} from "@bochica/agent";
import type { ChatMode } from "@bochica/shared";

// Each session works in one folder: where relative paths start and where PowerShell runs.

export class FolderService {
  constructor(
    private readonly documents: string,
    readonly policy: PathPolicy,
  ) {}

  /** Documents\Bochica, unless the user picks another folder. */
  defaultFolder(): string {
    return join(this.documents, "Bochica");
  }

  /** Whether a folder can be a working folder: absolute, existing, not protected. */
  usable(folder: string): boolean {
    return (
      checkWorkingFolder(folder) === null &&
      "path" in checkPath(folder, folder, "write", this.policy)
    );
  }

  /** The folder a new session gets: the one asked for if usable, else the default. */
  resolve(requested: string | undefined): string {
    if (requested && this.usable(requested)) return requested;
    const folder = this.defaultFolder();
    mkdirSync(folder, { recursive: true });
    return folder;
  }
}

/**
 * The built-in tools of a mode. Consult: the file tools, to read scripts and save new ones.
 * Tasks: those plus PowerShell. Draw: none, it works on EPLAN pages only.
 */
export function builtinTools(
  mode: ChatMode,
  folder: string,
  policy: PathPolicy,
  env: Record<string, string | undefined>,
): AgentTool[] {
  if (mode === "draw") return [];
  const files = fileTools({ cwd: folder, policy });
  return mode === "tasks" ? [...files, powershellTool({ cwd: folder, env })] : files;
}
