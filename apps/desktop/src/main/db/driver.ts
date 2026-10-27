import { DatabaseSync } from "node:sqlite";

// The few things the app needs from SQLite. Drizzle talks to it through its sqlite-proxy
// driver, so the app can use node:sqlite (built into Electron's Node) while tests use
// bun:sqlite, with the same schema and queries.

type QueryMethod = "run" | "all" | "values" | "get";

export interface SqlDriver {
  /** Runs one or more statements without parameters (pragmas, migrations). */
  exec(sql: string): void;
  /** Rows as arrays of column values; for "get", the first row or undefined. */
  query(sql: string, params: unknown[], method: QueryMethod): { rows: unknown };
  close(): void;
}

type SqlValue = string | number | bigint | null | Uint8Array;

export function nodeSqliteDriver(path: string): SqlDriver {
  const db = new DatabaseSync(path);
  return {
    exec: (sql) => db.exec(sql),
    query: (sql, params, method) => {
      const statement = db.prepare(sql);
      const values = params as SqlValue[];
      if (method === "run") {
        statement.run(...values);
        return { rows: [] };
      }
      statement.setReturnArrays(true);
      if (method === "get") return { rows: statement.get(...values) };
      return { rows: statement.all(...values) };
    },
    close: () => db.close(),
  };
}
