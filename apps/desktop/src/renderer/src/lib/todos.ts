import type { ConversationMessage } from "@bochica/shared";

// The agent's task list, as the latest successful todo_write call of the session left it.

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

const STATUSES = new Set(["pending", "in_progress", "completed"]);

function asTodos(input: unknown): Todo[] | null {
  const raw =
    typeof input === "object" && input !== null ? (input as { todos?: unknown }).todos : null;
  if (!Array.isArray(raw)) return null;
  const todos = raw.filter(
    (item): item is Todo =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as Todo).content === "string" &&
      STATUSES.has((item as Todo).status),
  );
  return todos.length === raw.length ? todos : null;
}

/** The session's current task list; empty when there is none or everything is done. */
export function currentTodos(messages: readonly ConversationMessage[]): Todo[] {
  for (const message of messages.toReversed()) {
    for (const part of message.parts.toReversed()) {
      if (part.type !== "tool" || part.server !== "bochica" || part.tool !== "todo_write") continue;
      if (part.status !== "ok") continue;
      const todos = asTodos(part.input) ?? [];
      return todos.every((t) => t.status === "completed") ? [] : todos;
    }
  }
  return [];
}
