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

describe("toHistory", () => {
  test("keeps complete exchanges in order", () => {
    expect(toHistory([userMessage("1", "Hi"), assistant("2", "Hello")])).toEqual([
      { role: "user", content: "Hi" },
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
      { role: "user", content: "third" },
      { role: "assistant", content: "partial" },
    ]);
  });
});
