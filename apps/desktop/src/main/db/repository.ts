import {
  ConversationMessage,
  MessagePart,
  type SessionDetail,
  type SessionSummary,
} from "@bochica/shared";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { z } from "zod";
import type { SqlDriver } from "./driver";
import { prepare } from "./migrations";
import { messages, sessions } from "./schema";

/** Saved sessions and their messages. All writes come from main, as turns happen. */
export class SessionRepository {
  private readonly db;

  constructor(private readonly driver: SqlDriver) {
    prepare(driver);
    this.db = drizzle(
      async (sql, params, method) => driver.query(sql, params, method) as { rows: never },
    );
  }

  async createSession(id: string, title: string, now = Date.now()): Promise<void> {
    await this.db
      .insert(sessions)
      .values({ id, title, createdAt: now, updatedAt: now })
      .onConflictDoNothing();
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
    return { id: session.id, title: session.title, messages: rows.map(toMessage) };
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
  return {
    id: row.id,
    role,
    content: row.content,
    parts,
    status: status.success ? status.data : "done",
    ...(error ? { error } : {}),
  };
}
