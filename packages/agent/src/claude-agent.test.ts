import { describe, expect, test } from "bun:test";
import type { TurnEvent } from "@bochica/shared";
import { type ClaudeRequest, type ClaudeRun, claudeAgentModel, transcript } from "./claude-agent";
import { runTurn } from "./loop";
import type { AgentTool, Approver } from "./tools";

const usage = {
  input_tokens: 4,
  output_tokens: 7,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 20,
};

/** Claude Code's streamed text, as the Agent SDK delivers it. */
function* text(value: string, message = "m") {
  yield {
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "message_start", message },
  };
  yield {
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
  };
  yield {
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: value } },
  };
  yield {
    type: "stream_event",
    parent_tool_use_id: null,
    event: { type: "content_block_stop", index: 0 },
  };
}

const success = { type: "result", subtype: "success", is_error: false, result: "", usage };

function echoTool(approval: AgentTool["approval"], name = "mcp__bochica__echo"): AgentTool {
  return {
    name,
    server: "bochica",
    tool: name.split("__").at(-1) ?? name,
    description: "Echoes its input.",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
    approval,
    execute: async (input) => ({ ok: true, text: `Echo: ${JSON.stringify(input)}` }),
  };
}

async function collect(options: {
  run: ClaudeRun;
  tools?: AgentTool[];
  approve?: Approver;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of runTurn({
    model: claudeAgentModel("sonnet", options.run),
    messages: options.messages ?? [{ role: "user", content: "Hola" }],
    abortSignal: new AbortController().signal,
    system: "You are Bochica.",
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.approve ? { approve: options.approve } : {}),
  })) {
    events.push(event);
  }
  return events;
}

describe("claudeAgentModel", () => {
  test("streams Claude Code's text and reports its usage", async () => {
    let seen: ClaudeRequest | undefined;
    const events = await collect({
      run: async function* (request) {
        seen = request;
        yield* text("Buenas");
        yield success;
      },
    });

    expect(seen).toMatchObject({ model: "sonnet", system: "You are Bochica.", prompt: "Hola" });
    expect(seen?.tools).toEqual([]);
    expect(events.filter((e) => e.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Buenas" },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "turn-end",
      reason: "stop",
      usage: { inputTokens: 124, outputTokens: 7 },
    });
  });

  test("a tool call asks with Claude Code's id and reports its result", async () => {
    const asked: string[] = [];
    let answer = "";
    const events = await collect({
      tools: [echoTool("ask")],
      approve: async (call) => {
        asked.push(`${call.callId} ${call.server}/${call.tool}`);
        return "allow";
      },
      run: async function* (request) {
        expect(request.tools.map((t) => t.name)).toEqual(["bochica__echo"]);
        const outcome = await request.tools[0]?.call({ text: "x" }, "toolu_1");
        answer = outcome?.text ?? "";
        yield* text("Hecho");
        yield success;
      },
    });

    expect(asked).toEqual(["toolu_1 bochica/echo"]);
    expect(answer).toBe('Echo: {"text":"x"}');
    expect(events.map((e) => e.type)).toEqual([
      "tool-call",
      "tool-result",
      "text-delta",
      "turn-end",
    ]);
    expect(events[0]).toMatchObject({ callId: "toolu_1", server: "bochica", tool: "echo" });
    expect(events[1]).toMatchObject({ callId: "toolu_1", status: "ok" });
  });

  test("a denied call is reported as denied, to Claude Code too", async () => {
    let result: { text: string; isError: boolean } | undefined;
    const events = await collect({
      tools: [echoTool("ask")],
      approve: async () => "deny",
      run: async function* (request) {
        result = await request.tools[0]?.call({ text: "x" }, "toolu_2");
        yield* text("Vale");
        yield success;
      },
    });
    expect(result?.isError).toBe(true);
    expect(events.find((e) => e.type === "tool-result")).toMatchObject({ status: "denied" });
  });

  test("without an approver, anything that asks is denied, as in the loop", async () => {
    const events = await collect({
      tools: [echoTool("ask")],
      run: async function* (request) {
        await request.tools[0]?.call({}, "toolu_3");
        yield success;
      },
    });
    expect(events.find((e) => e.type === "tool-result")).toMatchObject({ status: "denied" });
  });

  test("a call without tools offers Claude Code none", async () => {
    let tools: unknown[] | undefined;
    await collect({
      run: async function* (request) {
        tools = request.tools;
        yield success;
      },
    });
    expect(tools).toEqual([]);
  });

  test.each([
    ["rate_limit", "rate_limit"],
    ["authentication_failed", "invalid_key"],
    ["billing_error", "quota"],
  ])("Claude Code's %s becomes %s", async (kind, code) => {
    const events = await collect({
      run: async function* () {
        yield { type: "assistant", parent_tool_use_id: null, error: kind, message: {} };
        yield { type: "result", subtype: "success", is_error: true, result: "Not now." };
      },
    });
    expect(events.at(-1)).toMatchObject({ type: "error", code });
  });

  test("text from Claude Code's own subagents is not shown", async () => {
    const events = await collect({
      run: async function* () {
        yield {
          type: "stream_event",
          parent_tool_use_id: "toolu_9",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "x" },
          },
        };
        yield success;
      },
    });
    expect(events.some((e) => e.type === "text-delta")).toBe(false);
  });
});

describe("transcript", () => {
  test("one message goes as it is", () => {
    expect(
      transcript([
        { role: "system", content: "S" },
        { role: "user", content: [{ type: "text", text: "Hola" }] },
      ]),
    ).toEqual({ system: "S", prompt: "Hola" });
  });

  test("earlier exchanges come first, the new message last", () => {
    const { prompt } = transcript([
      { role: "user", content: [{ type: "text", text: "¿Qué es un PLC?" }] },
      { role: "assistant", content: [{ type: "text", text: "Un autómata." }] },
      { role: "user", content: [{ type: "text", text: "¿Y una macro?" }] },
    ]);
    expect(prompt).toBe(
      "<conversation_so_far>\n<user>\n¿Qué es un PLC?\n</user>\n\n<assistant>\nUn autómata.\n</assistant>\n</conversation_so_far>\n\n¿Y una macro?",
    );
  });
});
