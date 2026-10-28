import { describe, expect, test } from "bun:test";
import { planModeTools, planTool } from "./plan";
import type { AgentTool } from "./tools";

function tool(name: string, overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name,
    server: "bochica",
    tool: name,
    description: name,
    inputSchema: { type: "object" },
    approval: "never",
    execute: async () => ({ ok: true, text: "" }),
    ...overrides,
  };
}

const signal = new AbortController().signal;

describe("plan mode", () => {
  test("keeps only tools that read, plus the task list, helpers and propose_plan", () => {
    const tools = [
      tool("read_file"),
      tool("write_file", { approval: "ask" }),
      tool("powershell", { approval: "ask" }),
      tool("eplan_page_read", { server: "eplan" }),
      tool("eplan_page_create", { server: "eplan", approval: "ask", changesProject: true }),
      tool("eplan_project_delete", {
        server: "eplan",
        confirmation: () => ({ type: "word" }),
      }),
      tool("eplan_fix", { server: "eplan", changesProject: true }),
      tool("todo_write"),
      tool("task"),
    ];
    expect(planModeTools(tools).map((t) => t.tool)).toEqual([
      "read_file",
      "eplan_page_read",
      "todo_write",
      "task",
      "propose_plan",
    ]);
  });

  test("propose_plan accepts a plan and tells the model to stop", async () => {
    const result = await planTool.execute({ plan: "1. Add page =A1/2" }, signal);
    expect(result).toMatchObject({ ok: true });
    expect(result.text).toContain("End your turn");
    expect(await planTool.execute({ plan: "  " }, signal)).toMatchObject({ ok: false });
    expect(await planTool.execute({ plan: "x".repeat(20_001) }, signal)).toMatchObject({
      ok: false,
    });
  });
});
