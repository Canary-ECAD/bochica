import {
  ConversationMessage,
  MessagePart,
  type SessionDetail,
  type SessionSummary,
} from "@bochica/shared";
import { and, asc, desc, eq, gte, inArray, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { z } from "zod";
import type { SqlDriver } from "./driver";
import { prepare } from "./migrations";
import { checkpoints, messages, sessions } from "./schema";

/** What a file held before a turn first changed it. */
export type Snapshot =
  | { state: "file"; content: Buffer }
  | { state: "missing" }
  | { state: "too-large" };

export interface Checkpoint {
  turnId: string;
  path: string;
  snapshot: Snapshot;
}

/** Saved sessions and their messages. All writes come from main, as turns happen. */
export class SessionRepository {
  private readonly db;

  constructor(private readonly driver: SqlDriver) {
    prepare(driver);
    this.db = drizzle(
      async (sql, params, method) => driver.query(sql, params, method) as { rows: never },
    );
  }

  async createSession(id: string, title: string, folder: string, now = Date.now()): Promise<void> {
    await this.db
      .insert(sessions)
      .values({ id, title, folder, createdAt: now, updatedAt: now })
      .onConflictDoNothing();
  }

  /** The session's working folder, or null if it has none (sessions from before S7). */
  async getFolder(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ folder: sessions.folder })
      .from(sessions)
      .where(eq(sessions.id, id));
    return row?.folder ?? null;
  }

  async setFolder(id: string, folder: string): Promise<void> {
    await this.db.update(sessions).set({ folder }).where(eq(sessions.id, id));
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.db
      .select({ id: sessions.id, title: sessions.title, updatedAt: sessions.updatedAt })
      .from(sessions)
      .orderBy(desc(sessions.updatedAt));
  }

  async getSession(id: string): Promise<SessionDetail | null> {
    const [session] = await this.db.select().from(sessions).where(eq(sessions.id, id));
    if (!session) return null;
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, id))
      .orderBy(asc(messages.position));
    return {
      id: session.id,
      title: session.title,
      ...(session.folder ? { folder: session.folder } : {}),
      messages: rows.map(toMessage),
    };
  }

  /** Inserts a message at the end of its session, or updates it if it already exists. */
  async saveMessage(
    sessionId: string,
    message: ConversationMessage,
    now = Date.now(),
  ): Promise<void> {
    const [last] = await this.db
      .select({ position: max(messages.position) })
      .from(messages)
      .where(eq(messages.sessionId, sessionId));
    const fields = {
      role: message.role,
      content: message.content,
      parts: JSON.stringify(message.parts),
      status: message.status,
      error: message.error ? JSON.stringify(message.error) : null,
      meta:
        message.context || message.compaction
          ? JSON.stringify({ context: message.context, compaction: message.compaction })
          : null,
    };
    await this.db
      .insert(messages)
      .values({
        id: message.id,
        sessionId,
        position: (last?.position ?? -1) + 1,
        createdAt: now,
        ...fields,
      })
      .onConflictDoUpdate({ target: messages.id, set: fields });
    await this.db.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, sessionId));
  }

  async renameSession(id: string, title: string): Promise<void> {
    await this.db.update(sessions).set({ title }).where(eq(sessions.id, id));
  }

  /** Deletes the session and, through the foreign key, its messages. */
  async deleteSession(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  async deleteMessages(sessionId: string, ids: string[]): Promise<void> {
    await this.db
      .delete(messages)
      .where(and(eq(messages.sessionId, sessionId), inArray(messages.id, ids)));
  }

  /**
   * Deletes a message and every later one of its session, with their checkpoints. Returns the
   * ids deleted (none if the message isn't there).
   */
  async deleteMessagesFrom(sessionId: string, messageId: string): Promise<string[]> {
    const [from] = await this.db
      .select({ position: messages.position })
      .from(messages)
      .where(and(eq(messages.sessionId, sessionId), eq(messages.id, messageId)));
    if (!from) return [];
    const later = and(eq(messages.sessionId, sessionId), gte(messages.position, from.position));
    const deleted = await this.db.delete(messages).where(later).returning({ id: messages.id });
    const ids = deleted.map((row) => row.id);
    if (ids.length > 0) await this.db.delete(checkpoints).where(inArray(checkpoints.turnId, ids));
    return ids;
  }

  /** Saves what a file held before the turn changed it; only the first one per turn counts. */
  async saveCheckpoint(
    sessionId: string,
    turnId: string,
    path: string,
    snapshot: Snapshot,
    now = Date.now(),
  ): Promise<void> {
    await this.db
      .insert(checkpoints)
      .values({
        sessionId,
        turnId,
        path,
        state: snapshot.state,
        content: snapshot.state === "file" ? snapshot.content.toString("base64") : null,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  /** The checkpoints of these turns, oldest first. */
  async checkpointsOf(sessionId: string, turnIds: string[]): Promise<Checkpoint[]> {
    if (turnIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(checkpoints)
      .where(and(eq(checkpoints.sessionId, sessionId), inArray(checkpoints.turnId, turnIds)))
      .orderBy(asc(checkpoints.createdAt), asc(checkpoints.id));
    return rows.map((row) => ({
      turnId: row.turnId,
      path: row.path,
      snapshot:
        row.state === "file"
          ? { state: "file", content: Buffer.from(row.content ?? "", "base64") }
          : row.state === "missing"
            ? { state: "missing" }
            : { state: "too-large" },
    }));
  }

  /** Turns still "streaming" were cut off by a crash or a forced quit: show them as stopped. */
  async markInterruptedTurns(): Promise<number> {
    const interrupted = await this.db
      .update(messages)
      .set({ status: "stopped" })
      .where(eq(messages.status, "streaming"))
      .returning({ id: messages.id });
    return interrupted.length;
  }

  close(): void {
    this.driver.close();
  }
}

const StoredError = ConversationMessage.shape.error;
const StoredMeta = ConversationMessage.pick({ context: true, compaction: true });

function parseJson<T>(schema: z.ZodType<T>, text: string | null): T | undefined {
  if (text === null) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function toMessage(row: typeof messages.$inferSelect): ConversationMessage {
  const role = row.role === "user" ? "user" : "assistant";
  const status = ConversationMessage.shape.status.safeParse(row.status);
  // A damaged parts column falls back to the plain text, so the conversation still reads.
  const parts = parseJson(z.array(MessagePart), row.parts) ?? [
    { type: "text" as const, text: row.content },
  ];
  const error = parseJson(StoredError, row.error);
  const meta = parseJson(StoredMeta, row.meta);
  return {
    id: row.id,
    role,
    content: row.content,
    parts,
    status: status.success ? status.data : "done",
    ...(error ? { error } : {}),
    ...(meta?.context ? { context: meta.context } : {}),
    ...(meta?.compaction ? { compaction: meta.compaction } : {}),
  };
}
