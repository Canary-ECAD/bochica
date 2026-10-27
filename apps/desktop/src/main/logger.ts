import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets } from "@bochica/agent";

export interface Logger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  return String(error);
}

/** Appends to `<dir>/main.log`. Every line goes through redactSecrets before it hits disk. */
export function createLogger(dir: string): Logger {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "main.log");
  const write = (level: string, message: string): void => {
    appendFileSync(file, `${new Date().toISOString()} ${level} ${redactSecrets(message)}\n`);
  };
  return {
    info: (message) => write("INFO", message),
    error: (message, error) =>
      write("ERROR", error === undefined ? message : `${message}: ${describe(error)}`),
  };
}
