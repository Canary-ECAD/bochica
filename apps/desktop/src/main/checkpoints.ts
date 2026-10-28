import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { checkPath, type PathPolicy } from "@bochica/agent";
import type {
  ConversationMessage,
  RewindPreview,
  RewindRequest,
  RewindResult,
} from "@bochica/shared";
import type { Checkpoint, SessionRepository, Snapshot } from "./db/repository";

// Checkpoints and rewind. Before the file tools change a file for the first time in a turn,
// what it held is saved. Rewinding to one of the user's messages puts every file changed since
// then back as it was before, and can cut the conversation there too. Only the file tools are
// tracked: what PowerShell commands and EPLAN tools changed stays, and the preview says so.

/** Larger files are not saved; rewinding says it can't restore them. */
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

export interface CheckpointOptions {
  sessions: SessionRepository;
  policy: PathPolicy;
  /** Whether a tool call changed an EPLAN project (from the tool policy). */
  changesProject(server: string, tool: string): boolean;
}

/** The first snapshot of each file among these checkpoints: what it held before all of them. */
function earliest(checkpoints: Checkpoint[]): Checkpoint[] {
  const seen = new Set<string>();
  return checkpoints.filter((checkpoint) => {
    const key = checkpoint.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class CheckpointService {
  constructor(private readonly options: CheckpointOptions) {}

  /** Reads what the file holds now. Never throws: an unreadable file is "too-large". */
  async snapshot(path: string): Promise<Snapshot> {
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > MAX_SNAPSHOT_BYTES) return { state: "too-large" };
      return { state: "file", content: await readFile(path) };
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT"
        ? { state: "missing" }
        : { state: "too-large" };
    }
  }

  /** Saves the file as it is, before the turn's first change to it. */
  async record(sessionId: string, turnId: string, path: string): Promise<void> {
    await this.options.sessions.saveCheckpoint(sessionId, turnId, path, await this.snapshot(path));
  }

  /** The messages from `messageId` on, which a rewind would undo. Throws if it isn't a user message. */
  private async later(sessionId: string, messageId: string): Promise<ConversationMessage[]> {
    const session = await this.options.sessions.getSession(sessionId);
    const index = session?.messages.findIndex((m) => m.id === messageId) ?? -1;
    if (!session || index < 0 || session.messages[index]?.role !== "user")
      throw new Error("That message can't be rewound to.");
    return session.messages.slice(index);
  }

  private async changedFiles(sessionId: string, later: ConversationMessage[]) {
    const turns = later.filter((m) => m.role === "assistant").map((m) => m.id);
    return earliest(await this.options.sessions.checkpointsOf(sessionId, turns));
  }

  async preview(sessionId: string, messageId: string): Promise<RewindPreview> {
    const later = await this.later(sessionId, messageId);
    const files = await this.changedFiles(sessionId, later);
    const calls = later.flatMap((m) => m.parts).filter((p) => p.type === "tool");
    const session = await this.options.sessions.getSession(sessionId);
    const backups = (session?.messages ?? [])
      .flatMap((m) => m.parts)
      .flatMap((p) =>
        p.type === "tool" && p.tool === "backup_project" && p.status === "ok" && p.output
          ? [p.output]
          : [],
      );
    return {
      files: files.map(({ path, snapshot }) => ({
        path,
        change:
          snapshot.state === "file"
            ? "restore"
            : snapshot.state === "missing"
              ? "delete"
              : "too-large",
      })),
      eplanChanges: calls.some(
        (p) => p.status === "ok" && this.options.changesProject(p.server, p.tool),
      ),
      commands: calls.some((p) => p.server === "bochica" && p.tool === "powershell"),
      backups: [...new Set(backups)],
    };
  }

  /** Puts the files back and/or cuts the conversation. Files that can't be restored are listed. */
  async rewind({ sessionId, messageId, restore }: RewindRequest): Promise<RewindResult> {
    const later = await this.later(sessionId, messageId);
    const result: RewindResult = { restored: 0, failed: [] };
    if (restore !== "conversation") {
      for (const { path, snapshot } of await this.changedFiles(sessionId, later)) {
        // oxlint-disable-next-line no-await-in-loop
        if (await this.restoreFile(path, snapshot)) result.restored++;
        else result.failed.push(path);
      }
    }
    if (restore !== "files") await this.options.sessions.deleteMessagesFrom(sessionId, messageId);
    return result;
  }

  private async restoreFile(path: string, snapshot: Snapshot): Promise<boolean> {
    // The path was allowed when the tool wrote it; it is checked again, in case the rules changed.
    if ("block" in checkPath(path, dirname(path), "write", this.options.policy)) return false;
    try {
      if (snapshot.state === "too-large") return false;
      if (snapshot.state === "missing") {
        if (existsSync(path) && statSync(path).isFile()) await rm(path);
        return true;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, snapshot.content);
      return true;
    } catch {
      return false;
    }
  }
}
