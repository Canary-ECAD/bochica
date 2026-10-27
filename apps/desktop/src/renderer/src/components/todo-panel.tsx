import { CircleCheck, Circle, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Todo } from "@/lib/todos";
import { cn } from "@/lib/utils";

/** The agent's task list for the current job, above the composer. */
export function TodoPanel({ todos }: { todos: Todo[] }) {
  const { t } = useTranslation();
  const done = todos.filter((todo) => todo.status === "completed").length;

  return (
    <div className="mb-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium">{t("todos.title")}</span>
        <span>{t("todos.progress", { done, total: todos.length })}</span>
      </div>
      <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {todos.map((todo, index) => (
          <li key={`${index}-${todo.content}`} className="flex items-start gap-2">
            {todo.status === "completed" ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
            ) : todo.status === "in_progress" ? (
              <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                todo.status === "completed" && "text-muted-foreground line-through",
                todo.status === "in_progress" && "font-medium",
              )}
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
