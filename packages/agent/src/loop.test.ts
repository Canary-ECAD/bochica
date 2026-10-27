import { describe, expect, test } from "bun:test";
import type { TurnEvent } from "@bochica/shared";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runTurn } from "./loop";

const usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 3, text: 3, reasoning: 0 },
};

function streamingModel(chunks: LanguageModelV4StreamPart[]): MockLanguageModelV4 {
  const stream = new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new MockLanguageModelV4({ doStream: async () => ({ stream }) });
}

function failingModel(error: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw error;
    },
  });
}

async function collect(model: MockLanguageModelV4, signal = new AbortController().signal) {
  const events: TurnEvent[] = [];
  for await (const event of runTurn({
    model,
    messages: [{ role: "user", content: "Hi" }],
    abortSignal: signal,
  })) {
    events.push(event);
  }
  return events;
}

const apiError = (statusCode: number) =>
  new APICallError({
    message: `HTTP ${statusCode} for key sk-ant-api03-SECRETSECRETSECRET`,
    url: "https://api.example.test/v1/messages",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });

const step = (input: number, output: number, chunks: LanguageModelV4StreamPart[]) => ({
  stream: new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.enqueue({
        type: "finish",
        finishReason:
          chunks.length > 1
            ? { unified: "stop", raw: "stop" }
            : { unified: "tool-calls", raw: "tool_use" },
        usage: {
          inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: output, text: output, reasoning: 0 },
        },
      });
      controller.close();
    },
  }),
});

describe("runTurn", () => {
  test("streams text deltas and ends with usage", async () => {
    const model = streamingModel([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Hel" },
      { type: "text-delta", id: "t", delta: "lo" },
      { type: "text-end", id: "t" },
      { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
    ]);
    expect(await collect(model)).toEqual([
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
      {
        type: "turn-end",
        reason: "stop",
        usage: { inputTokens: 12, outputTokens: 3, contextTokens: 15 },
      },
    ]);
  });

  test("the context is the last model call, not the sum of every step", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        step(100, 10, [{ type: "tool-call", toolCallId: "c1", toolName: "look", input: "{}" }]),
        step(130, 5, [
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Done" },
          { type: "text-end", id: "t" },
        ]),
      ],
    });
    const events: TurnEvent[] = [];
    for await (const event of runTurn({
      model,
      messages: [{ role: "user", content: "Hi", id: "u1" }],
      abortSignal: new AbortController().signal,
      tools: [
        {
          name: "look",
          server: "bochica",
          tool: "look",
          description: "Look",
          inputSchema: { type: "object", properties: {} },
          approval: "never",
          execute: async () => ({ ok: true, text: "seen" }),
        },
      ],
    })) {
      events.push(event);
    }
    expect(events.at(-1)).toEqual({
      type: "turn-end",
      reason: "stop",
      usage: { inputTokens: 230, outputTokens: 15, contextTokens: 135 },
    });
    // Message ids are Bochica's own and never reach the provider.
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).not.toContain("u1");
  });

  test("sends the system prompt and the conversation", async () => {
    const model = streamingModel([
      { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
    ]);
    await collect(model);
    const prompt = model.doStreamCalls[0]?.prompt ?? [];
    expect(prompt[0]?.role).toBe("system");
    expect(prompt.at(-1)).toMatchObject({ role: "user" });
  });

  test("reports a cut-off answer as length", async () => {
    const model = streamingModel([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "…" },
      { type: "finish", finishReason: { unified: "length", raw: "max_tokens" }, usage },
    ]);
    expect((await collect(model)).at(-1)).toMatchObject({ type: "turn-end", reason: "length" });
  });

  test.each([
    [401, "invalid_key"],
    [403, "invalid_key"],
    [404, "model_not_found"],
    [429, "rate_limit"],
    [529, "provider_unavailable"],
    [400, "unknown"],
  ])("HTTP %i becomes %s", async (status, code) => {
    const events = await collect(failingModel(apiError(status)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", code });
  });

  test("redacts secrets from error messages", async () => {
    const [event] = await collect(failingModel(apiError(401)));
    expect(JSON.stringify(event)).not.toContain("SECRETSECRET");
  });

  test("a network failure is reported as network", async () => {
    const [event] = await collect(failingModel(new TypeError("fetch failed")));
    expect(event).toMatchObject({ type: "error", code: "network" });
  });

  test("an aborted turn ends as aborted", async () => {
    const controller = new AbortController();
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => ({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(stream) {
            stream.enqueue({ type: "text-start", id: "t" });
            stream.enqueue({ type: "text-delta", id: "t", delta: "partial" });
            abortSignal?.addEventListener("abort", () => stream.error(abortSignal.reason));
          },
        }),
      }),
    });
    const events: TurnEvent[] = [];
    for await (const event of runTurn({
      model,
      messages: [{ role: "user", content: "Hi" }],
      abortSignal: controller.signal,
    })) {
      events.push(event);
      if (event.type === "text-delta") controller.abort();
    }
    expect(events).toEqual([
      { type: "text-delta", text: "partial" },
      { type: "turn-end", reason: "aborted" },
    ]);
  });
});
