import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./logger";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("writes timestamped lines and never the secret itself", () => {
  dir = mkdtempSync(join(tmpdir(), "bochica-log-"));
  const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz";
  const logger = createLogger(dir);

  logger.info("started");
  logger.error(`request failed for ${key}`, new Error(`401 with ${key}`));

  const log = readFileSync(join(dir, "main.log"), "utf8");
  expect(log).toMatch(/^\d{4}-\d{2}-\d{2}T.+ INFO started$/m);
  expect(log).toContain("ERROR request failed for [REDACTED]: Error: 401 with [REDACTED]");
  expect(log).not.toContain(key);
});
