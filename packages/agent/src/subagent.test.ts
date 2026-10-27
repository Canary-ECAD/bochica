import { describe, expect, test } from "bun:test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { helperCanUse, subagentTool } from "./subagent";
import type { AgentTool } from "./tools";

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const signal = new AbortController().signal;

const toStream = (chunks: LanguageModelV4StreamPart[]) =>
  new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
const callStep = (toolName: string, input: object) => ({
  stream: toStream([
    { type: "tool-call", toolCallId: `c-${toolName}`, toolName, input: JSON.stringify(input) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage },
  ]),
});
const textStep = (text: string) => ({
  stream: toStream([
    { type: "text-start", id: "t" },
    { type: "text-delta", id: "t", delta: text },
    { type: "text-end", id: "t" },
    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
  ]),
});

function tool(name: string, overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name,
    server: "bochica",
    tool: name,
    description: name,
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    approval: "never",
    execute: async (input) => ({ ok: true, text: `${name}: ${JSON.stringify(input)}` }),
    ...overrides,
  };
}

describe("subagents", () => {
  const read = tool("read_file");
  const write = tool("write_file", { approval: "ask" });
  const eplanWrite = tool("eplan_set_property", { changesProject: true });

  test("only tools that never ask and never change a project", () => {
    expect(
      [read, write, eplanWrite, tool("task"), tool("todo_write")].filter(helperCanUse),
    ).toEqual([read]);
  });

  test("the helper reads, then reports; it never sees write tools", async () => {
    const model = new MockLanguageModelV4({
      doStream: [callStep("read_file", { path: "notes.txt" }), textStep("Motor M1 is on page 3.")],
    });
    const helper = subagentTool({
      model,
      tools: [read, write, eplanWrite],
      context: "Folder: C:/Work",
    });
    const result = await helper.execute(
      { description: "Find motor M1", prompt: "Where is motor M1?" },
      signal,
    );
    expect(result).toEqual({
      ok: true,
      text: "Motor M1 is on page 3.\n\n[Helper used: bochica/read_file]",
    });
    const offered = (model.doStreamCalls[0]?.tools ?? []).map((t) => t.name);
    expect(offered).toEqual(["read_file"]);
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("Folder: C:/Work");
  });

  test("a helper that fails says so", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const result = await subagentTool({ model, tools: [read] }).execute(
      { description: "x", prompt: "y" },
      signal,
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain("The helper failed");
  });
});
