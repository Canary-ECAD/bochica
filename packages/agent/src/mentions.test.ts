import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnEvent } from "@bochica/shared";
import { fileTools } from "./builtin/files";
import { attachMentions } from "./mentions";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bochica-mentions-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function run(content: string): Promise<{ events: TurnEvent[]; message: string }> {
  const readFile = fileTools({ cwd: root, policy: { secret: [], readOnly: [] } }).find(
    (t) => t.tool === "read_file",
  );
  const generator = attachMentions(
    content,
    readFile,
    (path) => existsSync(join(root, path)),
    new AbortController().signal,
  );
  const events: TurnEvent[] = [];
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop
    const next = await generator.next();
    if (next.done) return { events, message: content + next.value };
    events.push(next.value);
  }
}

describe("attachMentions", () => {
  test("appends each mentioned file and logs the read", async () => {
    writeFileSync(join(root, "notes.txt"), "first\nsecond\n");
    const { events, message } = await run("summarise @notes.txt please");
    expect(message).toStartWith("summarise @notes.txt please\n\nFiles the user attached");
    expect(message).toContain('<file path="notes.txt">\n1\tfirst\n2\tsecond\n</file>');
    expect(events.map((e) => e.type)).toEqual(["tool-call", "tool-result"]);
    expect(events[0]).toMatchObject({
      server: "bochica",
      tool: "read_file",
      input: { path: "notes.txt" },
    });
    expect(events[1]).toMatchObject({ status: "ok" });
  });

  test("a secret file is blocked, logged, and the model is told", async () => {
    writeFileSync(join(root, ".env"), "API_KEY=x");
    const { events, message } = await run("what is in @.env");
    expect(events[1]).toMatchObject({ status: "blocked", blocked: "secret-file" });
    expect(message).toContain('<file path=".env" error="true">');
    expect(message).not.toContain("API_KEY");
  });

  test("mentions that aren't files are left alone", async () => {
    const { events, message } = await run("thanks @everyone");
    expect(events).toEqual([]);
    expect(message).toBe("thanks @everyone");
  });
});
