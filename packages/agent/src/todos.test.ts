import { describe, expect, test } from "bun:test";
import { parseTodos, todoTool } from "./todos";

const signal = new AbortController().signal;

describe("todo_write", () => {
  test.each([
    [
      {
        todos: [
          { content: "Open the project", status: "completed" },
          { content: "Export", status: "in_progress" },
        ],
      },
      true,
    ],
    [{ todos: [] }, true],
    [
      {
        todos: [
          { content: "a", status: "in_progress" },
          { content: "b", status: "in_progress" },
        ],
      },
      false,
    ],
    [{ todos: [{ content: "", status: "pending" }] }, false],
    [{ todos: [{ content: "a", status: "done" }] }, false],
    [{ todos: Array.from({ length: 31 }, () => ({ content: "a", status: "pending" })) }, false],
    [{}, false],
  ])("%j valid: %p", async (input, ok) => {
    expect("todos" in parseTodos(input)).toBe(ok);
    expect((await todoTool.execute(input, signal)).ok).toBe(ok);
  });
});
