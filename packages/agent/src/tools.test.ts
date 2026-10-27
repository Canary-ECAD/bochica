import { describe, expect, test } from "bun:test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { TurnEvent } from "@bochica/shared";
import { MockLanguageModelV4 } from "ai/test";
import { runTurn } from "./loop";
import { type AgentTool, type Approver, qualifiedName, truncate } from "./tools";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const toStream = (chunks: LanguageModelV4StreamPart[]) =>
  new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

const callStep = (toolName: string, input: object, id = "call-1") => ({
  stream: toStream([
    { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) },
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

function searchTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: qualifiedName("docs", "search"),
    server: "docs",
    tool: "search",
    description: "Search the docs",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    approval: "never",
    execute: async (input) => ({ ok: true, text: `found: ${JSON.stringify(input)}` }),
    ...overrides,
  };
}

async function collect(
  model: MockLanguageModelV4,
  tools: AgentTool[],
  approve?: Approver,
  maxSteps?: number,
): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of runTurn({
    model,
    messages: [{ role: "user", content: "How do I make a macro?" }],
    abortSignal: new AbortController().signal,
    tools,
    ...(approve ? { approve } : {}),
    ...(maxSteps ? { maxSteps } : {}),
  })) {
    events.push(event);
  }
  return events;
}

describe("tools in the loop", () => {
  test("a read-only tool runs and the answer continues", async () => {
    const tool = searchTool();
    const model = new MockLanguageModelV4({
      doStream: [callStep(tool.name, { query: "macro" }), textStep("Use Insert → Macro.")],
    });
    const events = await collect(model, [tool]);
    expect(events.map((e) => e.type)).toEqual([
      "tool-call",
      "tool-result",
      "text-delta",
      "turn-end",
    ]);
    expect(events[0]).toMatchObject({ server: "docs", tool: "search", input: { query: "macro" } });
    expect(events[1]).toMatchObject({ status: "ok", output: 'found: {"query":"macro"}' });

    // The second model call received the tool result as text.
    const prompt = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(prompt).toContain("found:");
  });

  test("a failing tool is reported and the model gets the error", async () => {
    const tool = searchTool({ execute: async () => ({ ok: false, text: "index offline" }) });
    const model = new MockLanguageModelV4({
      doStream: [callStep(tool.name, {}), textStep("The docs are unavailable.")],
    });
    const events = await collect(model, [tool]);
    expect(events[1]).toMatchObject({
      type: "tool-result",
      status: "error",
      output: "index offline",
    });
  });

  test("a throwing tool becomes an error result, not a crashed turn", async () => {
    const tool = searchTool({
      execute: async () => {
        throw new Error("boom with sk-ant-api03-SECRETSECRETSECRET");
      },
    });
    const model = new MockLanguageModelV4({ doStream: [callStep(tool.name, {}), textStep("ok")] });
    const events = await collect(model, [tool]);
    expect(events[1]).toMatchObject({ type: "tool-result", status: "error" });
    expect(JSON.stringify(events)).not.toContain("SECRETSECRET");
    expect(events.at(-1)).toMatchObject({ type: "turn-end", reason: "stop" });
  });

  test("tools that need approval wait for the answer", async () => {
    let ran = false;
    const tool = searchTool({
      approval: "ask",
      execute: async () => {
        ran = true;
        return { ok: true, text: "done" };
      },
    });
    const asked: string[] = [];
    const approve: Approver = async (call) => {
      asked.push(call.tool);
      return "allow";
    };
    const model = new MockLanguageModelV4({ doStream: [callStep(tool.name, {}), textStep("ok")] });
    const events = await collect(model, [tool], approve);
    expect(asked).toEqual(["search"]);
    expect(ran).toBe(true);
    expect(events[1]).toMatchObject({ status: "ok" });
  });

  test("a denied call does not run and tells the model", async () => {
    let ran = false;
    const tool = searchTool({
      approval: "ask",
      execute: async () => {
        ran = true;
        return { ok: true, text: "done" };
      },
    });
    const model = new MockLanguageModelV4({ doStream: [callStep(tool.name, {}), textStep("ok")] });
    const events = await collect(model, [tool], async () => "deny");
    expect(ran).toBe(false);
    expect(events[1]).toMatchObject({ status: "denied" });
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("did not allow");
  });

  test("a destructive call asks every time with what to type, even on a read-only tool", async () => {
    const tool = searchTool({
      approval: "never",
      confirmation: (input) =>
        (input as { query?: string }).query === "purge" ? { type: "word" } : null,
    });
    const asked: Array<Parameters<Approver>[0]> = [];
    const approve: Approver = async (call) => {
      asked.push(call);
      return "allow";
    };
    const harmless = new MockLanguageModelV4({
      doStream: [callStep(tool.name, { query: "macro" }), textStep("ok")],
    });
    await collect(harmless, [tool], approve);
    expect(asked).toEqual([]);

    const destructive = new MockLanguageModelV4({
      doStream: [callStep(tool.name, { query: "purge" }), textStep("ok")],
    });
    await collect(destructive, [tool], approve);
    expect(asked).toMatchObject([{ approval: "always", confirm: { type: "word" } }]);
  });

  test("a blocked call is refused before anyone is asked, and the model is told why", async () => {
    let ran = false;
    const tool = searchTool({
      approval: "ask",
      assess: () => ({ block: "system-delete", reason: "deleting Windows is never allowed." }),
      execute: async () => {
        ran = true;
        return { ok: true, text: "done" };
      },
    });
    const asked: string[] = [];
    const model = new MockLanguageModelV4({ doStream: [callStep(tool.name, {}), textStep("ok")] });
    const events = await collect(model, [tool], async (call) => {
      asked.push(call.tool);
      return "allow";
    });
    expect(ran).toBe(false);
    expect(asked).toEqual([]);
    expect(events[1]).toMatchObject({ status: "blocked", blocked: "system-delete" });
    const prompt = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(prompt).toContain("deleting Windows is never allowed");
    expect(prompt).toContain("Do not retry");
  });

  test("a risky call asks every time and carries its risks", async () => {
    const tool = searchTool({
      approval: "ask",
      assess: (input) =>
        (input as { query?: string }).query === "rm" ? { risks: ["delete"] } : { risks: [] },
    });
    const asked: Array<Parameters<Approver>[0]> = [];
    const approve: Approver = async (call) => {
      asked.push(call);
      return "allow";
    };
    const step = (query: string) =>
      new MockLanguageModelV4({ doStream: [callStep(tool.name, { query }), textStep("ok")] });
    await collect(step("ls"), [tool], approve);
    await collect(step("rm"), [tool], approve);
    expect(asked[0]).toMatchObject({ approval: "ask" });
    expect(asked[0]).not.toHaveProperty("risks");
    expect(asked[1]).toMatchObject({ approval: "always", risks: ["delete"] });
  });

  test("a file diff reaches the event, redacted", async () => {
    const tool = searchTool({
      execute: async () => ({
        ok: true,
        text: "Edited a.txt.",
        diff: {
          path: "a.txt",
          added: 1,
          removed: 0,
          patch: "+key sk-ant-api03-SECRETSECRETSECRET",
        },
      }),
    });
    const model = new MockLanguageModelV4({ doStream: [callStep(tool.name, {}), textStep("ok")] });
    const events = await collect(model, [tool]);
    expect(events[1]).toMatchObject({ diff: { path: "a.txt", added: 1, removed: 0 } });
    expect(JSON.stringify(events)).not.toContain("SECRETSECRET");
  });

  test("without an approver, calls that need approval are denied", async () => {
    const tool = searchTool({ approval: "ask" });
    const model = new MockLanguageModelV4({ doStream: [callStep(tool.name, {}), textStep("ok")] });
    expect((await collect(model, [tool]))[1]).toMatchObject({ status: "denied" });
  });

  test("the step limit stops a tool loop", async () => {
    const tool = searchTool();
    const model = new MockLanguageModelV4({
      doStream: [
        callStep(tool.name, {}, "a"),
        callStep(tool.name, {}, "b"),
        callStep(tool.name, {}, "c"),
      ],
    });
    const events = await collect(model, [tool], undefined, 2);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(events.filter((e) => e.type === "tool-call")).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "turn-end" });
  });

  test("long output is truncated for display", async () => {
    const tool = searchTool({ execute: async () => ({ ok: true, text: "x".repeat(5_000) }) });
    const model = new MockLanguageModelV4({ doStream: [callStep(tool.name, {}), textStep("ok")] });
    const result = (await collect(model, [tool]))[1];
    expect(result?.type === "tool-result" && result.output.length).toBeLessThan(2_100);
  });
});

describe("helpers", () => {
  test("qualifiedName is safe for every provider", () => {
    expect(qualifiedName("eplan-docs-2027", "eplan2027_search")).toBe(
      "mcp__eplan-docs-2027__eplan2027_search",
    );
    expect(qualifiedName("a b", "c.d")).toBe("mcp__a_b__c_d");
    expect(qualifiedName("s", "x".repeat(100))).toHaveLength(64);
  });

  test("truncate leaves short text alone and notes what it cut", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("0123456789abc", 10)).toContain("3 more characters");
  });
});
