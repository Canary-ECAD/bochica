import type { SqlDriver } from "./driver";

// Schema changes, in order. Never edit a released entry: append a new one. The database's
// PRAGMA user_version is the number of entries already applied.

export const migrations: readonly string[] = [
  `CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE messages (
     id TEXT PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     position INTEGER NOT NULL,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     parts TEXT NOT NULL,
     status TEXT NOT NULL,
     error TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX messages_session ON messages(session_id, position);`,
  // S7: each session's working folder.
  `ALTER TABLE sessions ADD COLUMN folder TEXT;`,
  // S9: context usage and compaction summaries on answers.
  `ALTER TABLE messages ADD COLUMN meta TEXT;`,
  // S10: what each file held before a turn first changed it, for rewinding.
  `CREATE TABLE checkpoints (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     turn_id TEXT NOT NULL,
     path TEXT NOT NULL,
     state TEXT NOT NULL,
     content TEXT,
     created_at INTEGER NOT NULL,
     UNIQUE (turn_id, path)
   );
   CREATE INDEX checkpoints_session ON checkpoints(session_id);`,
];

function userVersion(driver: SqlDriver): number {
  const { rows } = driver.query("PRAGMA user_version", [], "get");
  const value = Array.isArray(rows) ? rows[0] : undefined;
  return typeof value === "number" ? value : Number(value ?? 0);
}

/** Applies pending migrations, each in its own transaction. Returns the resulting version. */
export function migrate(driver: SqlDriver, list: readonly string[] = migrations): number {
  let version = userVersion(driver);
  if (version > list.length) {
    throw new Error(
      `This database was created by a newer Bochica (schema ${version}, this one knows ${list.length}).`,
    );
  }
  for (; version < list.length; version++) {
    driver.exec(`BEGIN; ${list[version]}; PRAGMA user_version = ${version + 1}; COMMIT;`);
  }
  return version;
}

export function prepare(driver: SqlDriver): void {
  driver.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(driver);
}
