import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ConversationMessage, userMessage } from "@bochica/shared";
import { CheckpointService } from "./checkpoints";
import { bunSqliteDriver } from "./db/bun-driver";
import { SessionRepository } from "./db/repository";

let root: string;
let work: string;
let repo: SessionRepository;
let service: CheckpointService;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "bochica-checkpoints-"));
  work = join(root, "work");
  mkdirSync(work);
  repo = new SessionRepository(bunSqliteDriver());
  service = new CheckpointService({
    sessions: repo,
    policy: { secret: [join(root, "secret")], readOnly: [] },
    changesProject: (server, tool) => server === "eplan" && tool === "eplan_page_create",
  });
  await repo.createSession("s1", "t", work);
});
afterEach(() => {
  repo.close();
  rmSync(root, { recursive: true, force: true });
});

function answer(id: string, tools: Array<[string, string, string?]> = []): ConversationMessage {
  return {
    id,
    role: "assistant",
    content: "done",
    parts: tools.map(([server, tool, output], i) => ({
      type: "tool",
      callId: `${id}-${i}`,
      server,
      tool,
      input: {},
      status: "ok",
      ...(output ? { output } : {}),
    })),
    status: "done",
  };
}

/** Two exchanges: the first turn creates b.txt and edits a.txt, the second edits a.txt again. */
async function twoTurns(): Promise<void> {
  const a = join(work, "a.txt");
  const b = join(work, "b.txt");
  writeFileSync(a, "original");
  await repo.saveMessage("s1", userMessage("u1", "write them"));
  await service.record("s1", "t1", a);
  await service.record("s1", "t1", b);
  writeFileSync(a, "first change");
  writeFileSync(b, "new file");
  await repo.saveMessage("s1", answer("t1", [["bochica", "write_file"]]));
  await repo.saveMessage("s1", userMessage("u2", "again"));
  await service.record("s1", "t2", a);
  writeFileSync(a, "second change");
  await repo.saveMessage(
    "s1",
    answer("t2", [
      ["bochica", "edit_file"],
      ["bochica", "backup_project", "C:\\Backups\\Demo.zw1"],
      ["eplan", "eplan_page_create"],
      ["bochica", "powershell"],
    ]),
  );
}

describe("CheckpointService", () => {
  test("the preview lists each file once, with what rewinding does to it", async () => {
    await twoTurns();
    expect(await service.preview("s1", "u1")).toEqual({
      files: [
        { path: join(work, "a.txt"), change: "restore" },
        { path: join(work, "b.txt"), change: "delete" },
      ],
      eplanChanges: true,
      commands: true,
      backups: ["C:\\Backups\\Demo.zw1"],
    });
    const second = await service.preview("s1", "u2");
    expect(second.files).toEqual([{ path: join(work, "a.txt"), change: "restore" }]);
  });

  test("before the EPLAN change and the command, the preview has neither", async () => {
    await repo.saveMessage("s1", userMessage("u1", "hi"));
    await repo.saveMessage("s1", answer("t1"));
    const preview = await service.preview("s1", "u1");
    expect(preview).toMatchObject({ files: [], eplanChanges: false, commands: false });
  });

  test("rewinding files puts them back as before that message; the conversation stays", async () => {
    await twoTurns();
    expect(await service.rewind({ sessionId: "s1", messageId: "u1", restore: "files" })).toEqual({
      restored: 2,
      failed: [],
    });
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("original");
    expect(existsSync(join(work, "b.txt"))).toBe(false);
    expect((await repo.getSession("s1"))?.messages).toHaveLength(4);
  });

  test("rewinding to the second message keeps the first turn's work", async () => {
    await twoTurns();
    await service.rewind({ sessionId: "s1", messageId: "u2", restore: "all" });
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("first change");
    expect(readFileSync(join(work, "b.txt"), "utf8")).toBe("new file");
    expect((await repo.getSession("s1"))?.messages.map((m) => m.id)).toEqual(["u1", "t1"]);
  });

  test("conversation only leaves the files alone", async () => {
    await twoTurns();
    await service.rewind({ sessionId: "s1", messageId: "u1", restore: "conversation" });
    expect(readFileSync(join(work, "a.txt"), "utf8")).toBe("second change");
    expect((await repo.getSession("s1"))?.messages).toEqual([]);
  });

  test("files that weren't saved or are now protected are reported, not touched", async () => {
    const secret = join(root, "secret");
    mkdirSync(secret);
    await repo.saveMessage("s1", userMessage("u1", "x"));
    await repo.saveCheckpoint("s1", "t1", join(work, "big.bin"), { state: "too-large" });
    await repo.saveCheckpoint("s1", "t1", join(secret, "k.txt"), {
      state: "file",
      content: Buffer.from("old"),
    });
    await repo.saveMessage("s1", answer("t1"));
    const result = await service.rewind({ sessionId: "s1", messageId: "u1", restore: "files" });
    expect(result.restored).toBe(0);
    expect(result.failed.toSorted()).toEqual([join(secret, "k.txt"), join(work, "big.bin")]);
    expect(existsSync(join(secret, "k.txt"))).toBe(false);
  });

  test("only the user's messages can be rewound to", async () => {
    await twoTurns();
    expect(service.preview("s1", "t1")).rejects.toThrow();
    expect(service.preview("s1", "nope")).rejects.toThrow();
  });
});
