import { describe, expect, test } from "bun:test";
import type { ConversationMessage, ToolPart } from "@bochica/shared";
import { currentTodos } from "./todos";

const call = (todos: unknown, status: ToolPart["status"] = "ok"): ToolPart => ({
  type: "tool",
  callId: crypto.randomUUID(),
  server: "bochica",
  tool: "todo_write",
  input: { todos },
  status,
});

const answer = (...parts: ToolPart[]): ConversationMessage => ({
  id: crypto.randomUUID(),
  role: "assistant",
  content: "",
  parts,
  status: "done",
});

const open = [
  { content: "Open the project", status: "completed" },
  { content: "Export to PDF", status: "in_progress" },
];

describe("currentTodos", () => {
  test("the latest successful list wins", () => {
    const messages = [
      answer(call([{ content: "Old", status: "pending" }])),
      answer(call(open), call([{ content: "Bad", status: "done" }], "error")),
    ];
    expect(currentTodos(messages)).toEqual(open);
  });

  test("nothing shows when every step is done, or there is no list", () => {
    expect(currentTodos([answer(call([{ content: "A", status: "completed" }]))])).toEqual([]);
    expect(currentTodos([answer()])).toEqual([]);
  });

  test("a malformed list is ignored", () => {
    expect(currentTodos([answer(call([{ content: 3, status: "pending" }]))])).toEqual([]);
  });
});
