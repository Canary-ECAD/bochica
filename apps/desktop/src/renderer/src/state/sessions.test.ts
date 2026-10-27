import { beforeEach, describe, expect, test } from "bun:test";
import { type Message, toHistory, useSessions } from "./sessions";

const user = (id: string, content: string): Message => ({
  id,
  role: "user",
  content,
  status: "done",
});
const assistant = (id: string, content: string, status: Message["status"] = "done"): Message => ({
  id,
  role: "assistant",
  content,
  status,
});

describe("toHistory", () => {
  test("keeps complete exchanges in order", () => {
    expect(toHistory([user("1", "Hi"), assistant("2", "Hello")])).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  test("drops failed and empty exchanges so roles keep alternating", () => {
    const messages = [
      user("1", "first"),
      assistant("2", "", "error"),
      user("3", "second"),
      assistant("4", "", "stopped"),
      user("5", "third"),
      assistant("6", "partial", "stopped"),
    ];
    expect(toHistory(messages)).toEqual([
      { role: "user", content: "third" },
      { role: "assistant", content: "partial" },
    ]);
  });
});

describe("useSessions", () => {
  beforeEach(() => useSessions.setState({ sessions: {}, order: [], turnToSession: {} }));

  test("streams a turn into its session", () => {
    const store = useSessions.getState();
    const id = store.createSession();
    store.addExchange(id, "What is a macro?", "t1");
    store.applyEvent({ turnId: "t1", type: "text-delta", text: "A macro " });
    store.applyEvent({ turnId: "t1", type: "text-delta", text: "is…" });
    store.applyEvent({ turnId: "t1", type: "turn-end", reason: "stop" });

    const session = useSessions.getState().sessions[id];
    expect(session?.title).toBe("What is a macro?");
    expect(session?.messages.at(-1)).toMatchObject({ content: "A macro is…", status: "done" });
  });

  test("marks stopped, cut-off and failed turns", () => {
    const store = useSessions.getState();
    const id = store.createSession();
    store.addExchange(id, "a", "t1");
    store.addExchange(id, "b", "t2");
    store.addExchange(id, "c", "t3");
    store.applyEvent({ turnId: "t1", type: "turn-end", reason: "aborted" });
    store.applyEvent({ turnId: "t2", type: "turn-end", reason: "length" });
    store.applyEvent({ turnId: "t3", type: "error", code: "rate_limit", message: "429" });

    const statuses = useSessions
      .getState()
      .sessions[id]?.messages.filter((m) => m.role === "assistant")
      .map((m) => m.status);
    expect(statuses).toEqual(["stopped", "length", "error"]);
  });

  test("long first messages become a shortened title", () => {
    const store = useSessions.getState();
    const id = store.createSession();
    store.addExchange(id, "x".repeat(100), "t1");
    expect(useSessions.getState().sessions[id]?.title).toBe(`${"x".repeat(48)}…`);
  });

  test("events for unknown turns are ignored", () => {
    const before = useSessions.getState();
    before.applyEvent({ turnId: "nope", type: "text-delta", text: "x" });
    expect(useSessions.getState().sessions).toEqual(before.sessions);
  });
});
