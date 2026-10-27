import type { AgentTool } from "./tools";

// The agent's task list for longer jobs. The model sends the whole list every time; the UI
// shows the latest one. Nothing is stored apart from the tool call itself.

type TodoStatus = "pending" | "in_progress" | "completed";

export interface Todo {
  content: string;
  status: TodoStatus;
}

const MAX_TODOS = 30;
const STATUSES = new Set<string>(["pending", "in_progress", "completed"]);

/** The list in a todo_write input, or why it is not valid. */
export function parseTodos(input: unknown): { todos: Todo[] } | { problem: string } {
  const raw =
    typeof input === "object" && input !== null ? (input as { todos?: unknown }).todos : undefined;
  if (!Array.isArray(raw)) return { problem: "todos must be a list." };
  if (raw.length > MAX_TODOS) return { problem: `At most ${MAX_TODOS} items.` };
  const todos: Todo[] = [];
  for (const item of raw) {
    const { content, status } = (item ?? {}) as { content?: unknown; status?: unknown };
    if (typeof content !== "string" || !content.trim())
      return { problem: "Every item needs a content text." };
    if (typeof status !== "string" || !STATUSES.has(status))
      return { problem: "status must be pending, in_progress or completed." };
    todos.push({ content: content.trim().slice(0, 300), status: status as TodoStatus });
  }
  if (todos.filter((t) => t.status === "in_progress").length > 1)
    return { problem: "Only one item can be in_progress at a time." };
  return { todos };
}

export const todoTool: AgentTool = {
  name: "bochica__todo_write",
  server: "bochica",
  tool: "todo_write",
  description:
    "Write the task list the user sees next to the chat. Send the whole list every time (it replaces the previous one). Use it for jobs with three or more steps: add the steps, mark one in_progress before starting it, and mark it completed as soon as it is done.",
  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "The step, in the user's language." },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["content", "status"],
        },
      },
    },
    required: ["todos"],
  },
  approval: "never",
  execute: async (input) => {
    const parsed = parseTodos(input);
    if ("problem" in parsed) return { ok: false, text: parsed.problem };
    const done = parsed.todos.filter((t) => t.status === "completed").length;
    return { ok: true, text: `Task list updated: ${done} of ${parsed.todos.length} done.` };
  },
};
