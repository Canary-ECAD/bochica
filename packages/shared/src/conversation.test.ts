import { describe, expect, test } from "bun:test";
import {
  applyTurnEvent,
  assistantPlaceholder,
  type ConversationMessage,
  toHistory,
  userMessage,
} from "./conversation";
import type { TurnEvent } from "./ipc";

const assistant = (
  id: string,
  content: string,
  status: ConversationMessage["status"] = "done",
): ConversationMessage => ({
  id,
  role: "assistant",
  content,
  parts: content ? [{ type: "text", text: content }] : [],
  status,
});

const compacted = (id: string, content: string, from?: string): ConversationMessage => ({
  ...assistant(id, content),
  compaction: { summary: "They asked about pages 1-3.", ...(from ? { from } : {}) },
});

const run = (events: TurnEvent[]) => events.reduce(applyTurnEvent, assistantPlaceholder("t1"));

describe("applyTurnEvent", () => {
  test("streams text into one part", () => {
    const message = run([
      { type: "text-delta", text: "A macro " },
      { type: "text-delta", text: "is…" },
      { type: "turn-end", reason: "stop" },
    ]);
    expect(message).toMatchObject({
      content: "A macro is…",
      parts: [{ type: "text", text: "A macro is…" }],
      status: "done",
    });
  });

  test("tool calls interleave with text in order", () => {
    const message = run([
      { type: "text-delta", text: "Let me check. " },
      {
        type: "tool-call",
        callId: "c1",
        server: "docs",
        tool: "search",
        input: { query: "macro" },
      },
      { type: "tool-result", callId: "c1", status: "ok", output: "3 hits" },
      { type: "text-delta", text: "Found it." },
    ]);
    expect(message.parts).toEqual([
      { type: "text", text: "Let me check. " },
      {
        type: "tool",
        callId: "c1",
        server: "docs",
        tool: "search",
        input: { query: "macro" },
        status: "ok",
        output: "3 hits",
      },
      { type: "text", text: "Found it." },
    ]);
    expect(message.content).toBe("Let me check. Found it.");
  });

  test.each([
    [{ type: "turn-end", reason: "aborted" }, "stopped"],
    [{ type: "turn-end", reason: "length" }, "length"],
    [{ type: "error", code: "rate_limit", message: "429" }, "error"],
  ] as const)("%o ends as %s", (event, status) => {
    expect(run([event]).status).toBe(status);
  });
});

test("context and compaction events are stored on the answer", () => {
  const usage = { used: 900, window: 8192, instructions: 300, tools: 200, conversation: 400 };
  const message = run([
    { type: "compacted", compaction: { summary: "S", from: "u1" } },
    { type: "context", usage },
  ]);
  expect(message.compaction).toEqual({ summary: "S", from: "u1" });
  expect(message.context).toEqual(usage);
});

describe("toHistory", () => {
  test("keeps complete exchanges in order", () => {
    expect(toHistory([userMessage("1", "Hi"), assistant("2", "Hello")])).toEqual([
      { role: "user", content: "Hi", id: "1" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  test("drops failed and empty exchanges so roles keep alternating", () => {
    expect(
      toHistory([
        userMessage("1", "first"),
        assistant("2", "", "error"),
        userMessage("3", "second"),
        assistant("4", "", "stopped"),
        userMessage("5", "third"),
        assistant("6", "partial", "stopped"),
      ]),
    ).toEqual([
      { role: "user", content: "third", id: "5" },
      { role: "assistant", content: "partial" },
    ]);
  });

  test("after a compaction, starts with the summary and the exchanges it kept", () => {
    const messages = [
      userMessage("1", "page 1?"),
      assistant("2", "one"),
      userMessage("3", "page 2?"),
      assistant("4", "two"),
      userMessage("5", "page 3?"),
      compacted("6", "three", "3"),
      userMessage("7", "page 4?"),
      assistant("8", "four"),
    ];
    expect(toHistory(messages).map((m) => m.content)).toEqual([
      expect.stringContaining("They asked about pages 1-3."),
      "Understood. I'll continue from that summary.",
      "page 2?",
      "two",
      "page 3?",
      "three",
      "page 4?",
      "four",
    ]);
  });

  test("without a kept part it starts at the compacting turn, and the latest summary wins", () => {
    const messages = [
      userMessage("1", "a"),
      compacted("2", "b"),
      userMessage("3", "c"),
      { ...compacted("4", "d"), compaction: { summary: "Newer summary." } },
    ];
    const history = toHistory(messages);
    expect(history[0]?.content).toContain("Newer summary.");
    expect(history.slice(2).map((m) => m.content)).toEqual(["c", "d"]);
  });

  test("a compaction survives its own turn failing", () => {
    const messages = [
      userMessage("1", "a"),
      assistant("2", "b"),
      userMessage("3", "c"),
      { ...compacted("4", ""), status: "error" as const },
    ];
    expect(toHistory(messages)).toHaveLength(2);
  });
});
