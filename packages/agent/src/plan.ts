import { helperCanUse } from "./subagent";
import type { AgentTool } from "./tools";

// Plan mode: the agent looks around with tools that only read, then proposes a plan with
// propose_plan and stops. The user approves it in the app, which switches the session back to
// asking and tells the agent to go ahead. The tool filter, not the prompt, is what keeps the
// agent from changing anything.

const MAX_PLAN_CHARS = 20_000;

export const planTool: AgentTool = {
  name: "bochica__propose_plan",
  server: "bochica",
  tool: "propose_plan",
  description:
    "Plan mode only: show the user your plan for their request, for approval. Call it once, when you know enough, then end your turn. The user sees it as a card with a button to go ahead.",
  inputSchema: {
    type: "object",
    properties: {
      plan: {
        type: "string",
        description:
          "The plan in Markdown, in the user's language: what you will change, in numbered steps, which EPLAN projects, pages or files it touches, and what the user should check afterwards.",
      },
    },
    required: ["plan"],
  },
  approval: "never",
  execute: async (input) => {
    const plan = (input as { plan?: unknown } | null)?.plan;
    if (typeof plan !== "string" || !plan.trim()) return { ok: false, text: "The plan is empty." };
    if (plan.length > MAX_PLAN_CHARS) {
      return {
        ok: false,
        text: `The plan is too long; keep it under ${MAX_PLAN_CHARS} characters.`,
      };
    }
    return {
      ok: true,
      text: "The plan is on the user's screen with a button to go ahead. End your turn now with one short sentence; do not repeat the plan and do not start on it.",
    };
  },
};

/** The tools of a plan-mode turn: the mode's read-only ones, the task list, helpers, propose_plan. */
export function planModeTools(tools: readonly AgentTool[]): AgentTool[] {
  return [
    ...tools.filter(
      (tool) =>
        helperCanUse(tool) ||
        (tool.server === "bochica" && (tool.tool === "todo_write" || tool.tool === "task")),
    ),
    planTool,
  ];
}
