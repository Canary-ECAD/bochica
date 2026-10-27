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
