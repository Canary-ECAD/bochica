import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { assistantPlaceholder, type ConversationMessage, userMessage } from "@bochica/shared";
import { bunSqliteDriver } from "./bun-driver";
import type { SqlDriver } from "./driver";
import { migrate, migrations } from "./migrations";
import { SessionRepository } from "./repository";

let driver: SqlDriver;
let repo: SessionRepository;

beforeEach(() => {
  driver = bunSqliteDriver();
  repo = new SessionRepository(driver);
});
afterEach(() => repo.close());

const answer: ConversationMessage = {
  id: "t1",
  role: "assistant",
  content: "Use Insert → Macro.",
  parts: [
    {
      type: "tool",
      callId: "c1",
      server: "eplan-docs-2027",
      tool: "eplan2027_search",
      input: { query: "Macro" },
      status: "ok",
      output: "3 hits",
    },
    { type: "text", text: "Use Insert → Macro." },
  ],
  status: "done",
};

describe("SessionRepository", () => {
  test("saves and loads a conversation with tool parts", async () => {
    await repo.createSession("s1", "Macros", "C:/Work", 1000);
    await repo.saveMessage("s1", userMessage("u1", "How do I make a macro?"), 1001);
    await repo.saveMessage("s1", answer, 1002);

    expect(await repo.getSession("s1")).toEqual({
      id: "s1",
      title: "Macros",
      folder: "C:/Work",
      messages: [userMessage("u1", "How do I make a macro?"), answer],
    });
  });

  test("saving an existing message updates it in place", async () => {
    await repo.createSession("s1", "t", "C:/Work");
    await repo.saveMessage("s1", userMessage("u1", "q"));
    await repo.saveMessage("s1", assistantPlaceholder("t1"));
    await repo.saveMessage("s1", { ...answer, id: "t1" });
    const session = await repo.getSession("s1");
    expect(session?.messages.map((m) => [m.id, m.status])).toEqual([
      ["u1", "done"],
      ["t1", "done"],
    ]);
  });

  test("keeps context usage and compaction summaries", async () => {
    await repo.createSession("s1", "Long", "C:/Work", 1000);
    const usage = { used: 900, window: 8192, instructions: 300, tools: 200, conversation: 400 };
    const compaction = { summary: "Earlier: pages 1-3.", from: "u0" };
    await repo.saveMessage("s1", { ...answer, context: usage, compaction }, 1001);
    const [saved] = (await repo.getSession("s1"))?.messages ?? [];
    expect(saved?.context).toEqual(usage);
    expect(saved?.compaction).toEqual(compaction);
  });

  test("keeps errors", async () => {
    await repo.createSession("s1", "t", "C:/Work");
    const failed: ConversationMessage = {
      ...assistantPlaceholder("t1"),
      status: "error",
      error: { code: "rate_limit", message: "429" },
    };
    await repo.saveMessage("s1", failed);
    expect((await repo.getSession("s1"))?.messages[0]).toEqual(failed);
  });

  test("lists sessions by last activity, newest first", async () => {
    await repo.createSession("old", "Old", "C:/Work", 1);
    await repo.createSession("new", "New", "C:/Work", 2);
    await repo.saveMessage("old", userMessage("u1", "bump"), 3);
    expect((await repo.listSessions()).map((s) => s.id)).toEqual(["old", "new"]);
  });

  test("rename, delete messages, delete session with cascade", async () => {
    await repo.createSession("s1", "Before", "C:/Work");
    await repo.saveMessage("s1", userMessage("u1", "a"));
    await repo.saveMessage("s1", userMessage("u2", "b"));
    await repo.renameSession("s1", "After");
    await repo.deleteMessages("s1", ["u1"]);
    expect(await repo.getSession("s1")).toMatchObject({ title: "After", messages: [{ id: "u2" }] });

    await repo.deleteSession("s1");
    expect(await repo.getSession("s1")).toBeNull();
    const { rows } = driver.query("SELECT count(*) FROM messages", [], "get");
    expect(rows).toEqual([0]);
  });

  test("turns cut off by a crash come back as stopped", async () => {
    await repo.createSession("s1", "t", "C:/Work");
    await repo.saveMessage("s1", { ...assistantPlaceholder("t1"), content: "partial" });
    expect(await repo.markInterruptedTurns()).toBe(1);
    expect((await repo.getSession("s1"))?.messages[0]?.status).toBe("stopped");
  });

  test("a damaged parts column falls back to the text", async () => {
    await repo.createSession("s1", "t", "C:/Work");
    await repo.saveMessage("s1", answer);
    driver.query("UPDATE messages SET parts = ? WHERE id = ?", ["{not json", "t1"], "run");
    expect((await repo.getSession("s1"))?.messages[0]?.parts).toEqual([
      { type: "text", text: "Use Insert → Macro." },
    ]);
  });

  test("keeps each session's folder; older sessions have none until one is set", async () => {
    await repo.createSession("s1", "t", "C:/Work");
    await repo.createSession("s1", "t", "C:/Other");
    expect(await repo.getFolder("s1")).toBe("C:/Work");
    driver.query("UPDATE sessions SET folder = NULL WHERE id = ?", ["s1"], "run");
    expect(await repo.getFolder("s1")).toBeNull();
    expect(await repo.getSession("s1")).not.toHaveProperty("folder");
    await repo.setFolder("s1", "C:/Docs");
    expect(await repo.getSession("s1")).toMatchObject({ folder: "C:/Docs" });
  });

  test("unknown sessions are null", async () => {
    expect(await repo.getSession("nope")).toBeNull();
  });
});

describe("checkpoints", () => {
  test("keeps the first snapshot of a file per turn, oldest first, bytes intact", async () => {
    await repo.createSession("s1", "t", "C:/Work");
    const bytes = Buffer.from([0xef, 0xbb, 0xbf, 0x41, 0x0d, 0x0a, 0x00]);
    await repo.saveCheckpoint("s1", "t1", "C:/Work/a.txt", { state: "file", content: bytes }, 1);
    await repo.saveCheckpoint("s1", "t1", "C:/Work/a.txt", { state: "missing" }, 2);
    await repo.saveCheckpoint("s1", "t1", "C:/Work/b.txt", { state: "missing" }, 3);
    await repo.saveCheckpoint("s1", "t2", "C:/Work/big.bin", { state: "too-large" }, 4);
    const saved = await repo.checkpointsOf("s1", ["t1", "t2"]);
    expect(saved).toEqual([
      { turnId: "t1", path: "C:/Work/a.txt", snapshot: { state: "file", content: bytes } },
      { turnId: "t1", path: "C:/Work/b.txt", snapshot: { state: "missing" } },
      { turnId: "t2", path: "C:/Work/big.bin", snapshot: { state: "too-large" } },
    ]);
    expect(await repo.checkpointsOf("s1", ["t2"])).toHaveLength(1);
    expect(await repo.checkpointsOf("s1", [])).toEqual([]);
  });

  test("deleting from a message removes it, what follows, and their checkpoints", async () => {
    await repo.createSession("s1", "t", "C:/Work");
    await repo.saveMessage("s1", userMessage("u1", "one"));
    await repo.saveMessage("s1", { ...answer, id: "t1" });
    await repo.saveMessage("s1", userMessage("u2", "two"));
    await repo.saveMessage("s1", { ...answer, id: "t2" });
    await repo.saveCheckpoint("s1", "t1", "C:/Work/a.txt", { state: "missing" });
    await repo.saveCheckpoint("s1", "t2", "C:/Work/a.txt", { state: "missing" });
    expect((await repo.deleteMessagesFrom("s1", "u2")).toSorted()).toEqual(["t2", "u2"]);
    expect((await repo.getSession("s1"))?.messages.map((m) => m.id)).toEqual(["u1", "t1"]);
    expect(await repo.checkpointsOf("s1", ["t1", "t2"])).toHaveLength(1);
    expect(await repo.deleteMessagesFrom("s1", "nope")).toEqual([]);
  });
});

describe("migrations", () => {
  test("a fresh database ends at the latest version with every column", () => {
    const fresh = bunSqliteDriver();
    expect(migrate(fresh)).toBe(migrations.length);
    const columns = (table: string) =>
      (fresh.query(`PRAGMA table_info(${table})`, [], "all").rows as unknown[][]).map((c) => c[1]);
    expect(columns("sessions")).toEqual(["id", "title", "created_at", "updated_at", "folder"]);
    expect(columns("messages")).toEqual([
      "id",
      "session_id",
      "position",
      "role",
      "content",
      "parts",
      "status",
      "error",
      "created_at",
      "meta",
    ]);
    expect(columns("checkpoints")).toEqual([
      "id",
      "session_id",
      "turn_id",
      "path",
      "state",
      "content",
      "created_at",
    ]);
    fresh.close();
  });

  test("running again changes nothing", () => {
    expect(migrate(driver)).toBe(migrations.length);
  });

  test("a database from a newer version is refused", () => {
    const newer = bunSqliteDriver();
    newer.exec("PRAGMA user_version = 99");
    expect(() => migrate(newer)).toThrow("newer Bochica");
    newer.close();
  });
});
