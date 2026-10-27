import type { LanguageModel } from "ai";
import { runTurn } from "./loop";
import type { AgentTool } from "./tools";

// A helper the main agent can hand a research job to. It starts with a fresh conversation,
// gets only tools that never ask and never change a project, and answers with a report: the
// main conversation gets the report, not everything the helper read.

const MAX_HELPER_STEPS = 10;

const HELPER_PROMPT = `You are a helper working for Bochica, an assistant that helps electrical designers work with EPLAN. Bochica's main assistant gave you one task. Nobody else reads your messages: the main assistant gets your final reply and uses it to answer the user.

- Use your tools to find out what the task asks. You can only read and search; you cannot change anything, and you cannot ask the user questions.
- Reply with a concise report: what you found, with exact names, paths, pages or documentation references, and what you could not find. Write it in the language the task is written in.`;

/** Whether a tool is safe to give a helper: it never asks and never changes a project. */
export function helperCanUse(tool: AgentTool): boolean {
  return (
    tool.approval === "never" &&
    !tool.changesProject &&
    !tool.confirmation &&
    tool.tool !== "task" &&
    tool.tool !== "todo_write"
  );
}

export interface SubagentOptions {
  model: LanguageModel;
  /** The mode's tools; the helper gets only those `helperCanUse` allows. */
  tools: readonly AgentTool[];
  /** Extra context for the helper, such as the working folder. */
  context?: string;
}

export function subagentTool({ model, tools, context }: SubagentOptions): AgentTool {
  const allowed = tools.filter(helperCanUse);
  return {
    name: "bochica__task",
    server: "bochica",
    tool: "task",
    description: `Hand a research job to a helper that works on its own and reports back, so the details don't fill this conversation. Use it for searches that may take many steps (looking through documentation or many files). The helper can only read and search (${allowed.length} tools); it cannot change anything or ask the user. Give it a complete prompt: it sees nothing of this conversation. Several helpers can run at the same time.`,
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "What the helper does, in 3 to 8 words, in the user's language.",
        },
        prompt: {
          type: "string",
          description: "The full task, with everything the helper needs to know.",
        },
      },
      required: ["description", "prompt"],
    },
    approval: "never",
    execute: async (input, signal) => {
      const prompt = (input as { prompt?: unknown }).prompt;
      if (typeof prompt !== "string" || !prompt.trim()) {
        return { ok: false, text: "The helper needs a prompt." };
      }
      let report = "";
      const used = new Map<string, number>();
      for await (const event of runTurn({
        model,
        messages: [{ role: "user", content: prompt }],
        abortSignal: signal,
        system: context ? `${HELPER_PROMPT}\n\n${context}` : HELPER_PROMPT,
        tools: allowed,
        maxSteps: MAX_HELPER_STEPS,
      })) {
        if (event.type === "text-delta") report += event.text;
        if (event.type === "tool-call") {
          const key = `${event.server}/${event.tool}`;
          used.set(key, (used.get(key) ?? 0) + 1);
        }
        if (event.type === "error") {
          return { ok: false, text: `The helper failed: ${event.message}` };
        }
        if (event.type === "turn-end" && event.reason === "aborted") {
          return { ok: false, text: "The helper was stopped." };
        }
      }
      const tally = [...used].map(([tool, n]) => (n > 1 ? `${tool} ×${n}` : tool)).join(", ");
      return {
        ok: true,
        text: `${report.trim() || "(The helper gave no report.)"}${tally ? `\n\n[Helper used: ${tally}]` : ""}`,
      };
    },
  };
}
