import { beforeEach, describe, expect, test } from "bun:test";
import { userMessage } from "@bochica/shared";
import { useSessions } from "./sessions";

// The event reducer itself is tested in @bochica/shared; these cover the store around it.

beforeEach(() => useSessions.setState({ sessions: {}, order: [], turnToSession: {} }));

describe("useSessions", () => {
  test("streams a turn into its session and titles it", () => {
    const store = useSessions.getState();
    const id = store.createSession();
    store.addExchange(id, "What is a macro?", "u1", "t1");
    store.applyEvent({ turnId: "t1", type: "text-delta", text: "A macro is…" });
    store.applyEvent({ turnId: "t1", type: "turn-end", reason: "stop" });

    const session = useSessions.getState().sessions[id];
    expect(session?.title).toBe("What is a macro?");
    expect(session?.messages.map((m) => [m.id, m.status, m.content])).toEqual([
      ["u1", "done", "What is a macro?"],
      ["t1", "done", "A macro is…"],
    ]);
  });

  test("approvals attach to their turn and clear when it ends", () => {
    const store = useSessions.getState();
    const id = store.createSession();
    store.addExchange(id, "do it", "u1", "t1");
    store.addApproval({
      requestId: "r1",
      turnId: "t1",
      server: "bochica",
      tool: "dev_echo",
      input: {},
      allowSession: true,
    });
    expect(useSessions.getState().sessions[id]?.messages.at(-1)?.approvals).toHaveLength(1);
    store.applyEvent({ turnId: "t1", type: "turn-end", reason: "aborted" });
    expect(useSessions.getState().sessions[id]?.messages.at(-1)?.approvals).toEqual([]);
  });

  test("saved sessions are listed without messages until loaded", () => {
    const store = useSessions.getState();
    store.setSummaries([
      { id: "a", title: "Newest", updatedAt: 2 },
      { id: "b", title: "Older", updatedAt: 1 },
    ]);
    expect(useSessions.getState().order).toEqual(["a", "b"]);
    expect(useSessions.getState().sessions["a"]).toMatchObject({ loaded: false, messages: [] });

    store.loadSession({ id: "a", title: "Newest", messages: [userMessage("u1", "hi")] });
    expect(useSessions.getState().sessions["a"]).toMatchObject({
      loaded: true,
      messages: [{ id: "u1", approvals: [] }],
    });
  });

  test("an unsent new session stays on top of the saved ones", () => {
    const store = useSessions.getState();
    const fresh = store.createSession();
    store.setSummaries([{ id: "a", title: "Saved", updatedAt: 1 }]);
    expect(useSessions.getState().order).toEqual([fresh, "a"]);
  });

  test("a new turn moves its session to the top", () => {
    const store = useSessions.getState();
    store.setSummaries([
      { id: "a", title: "A", updatedAt: 2 },
      { id: "b", title: "B", updatedAt: 1 },
    ]);
    store.loadSession({ id: "b", title: "B", messages: [] });
    store.addExchange("b", "again", "u1", "t1");
    expect(useSessions.getState().order).toEqual(["b", "a"]);
  });

  test("rename and remove", () => {
    const store = useSessions.getState();
    const id = store.createSession();
    store.rename(id, "Renamed");
    expect(useSessions.getState().sessions[id]?.title).toBe("Renamed");
    store.remove(id);
    expect(useSessions.getState().sessions[id]).toBeUndefined();
    expect(useSessions.getState().order).toEqual([]);
  });

  test("events for unknown turns are ignored", () => {
    const before = useSessions.getState();
    before.applyEvent({ turnId: "nope", type: "text-delta", text: "x" });
    expect(useSessions.getState().sessions).toEqual(before.sessions);
  });
});
