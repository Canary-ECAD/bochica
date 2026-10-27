import { Database } from "bun:sqlite";
import type { SqlDriver } from "./driver";

// Test-only: the same SqlDriver over bun:sqlite, because bun has no node:sqlite. Never
// imported by the app.

type SqlValue = string | number | bigint | boolean | null | Uint8Array;

export function bunSqliteDriver(path = ":memory:"): SqlDriver {
  const db = new Database(path);
  return {
    exec: (sql) => db.exec(sql),
    query: (sql, params, method) => {
      const statement = db.query(sql);
      const values = params as SqlValue[];
      if (method === "run") {
        statement.run(...values);
        return { rows: [] };
      }
      const rows = statement.values(...values);
      return { rows: method === "get" ? rows[0] : rows };
    },
    close: () => db.close(),
  };
}
