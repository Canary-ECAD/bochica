import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Must match migrations.ts; the migration test checks every column exists.

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  folder: text("folder"),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** JSON: MessagePart[] */
    parts: text("parts").notNull(),
    status: text("status").notNull(),
    /** JSON: { code, message } or null */
    error: text("error"),
    /** JSON: { context?, compaction? } or null */
    meta: text("meta"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("messages_session").on(table.sessionId, table.position)],
);

export const checkpoints = sqliteTable(
  "checkpoints",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    turnId: text("turn_id").notNull(),
    /** Absolute path of the file. */
    path: text("path").notNull(),
    /** "file": `content` holds it. "missing": it didn't exist. "too-large": not saved. */
    state: text("state").notNull(),
    /** Base64 of the file's bytes, for state "file". */
    content: text("content"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("checkpoints_session").on(table.sessionId)],
);
