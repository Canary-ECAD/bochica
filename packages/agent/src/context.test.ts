import { describe, expect, test } from "bun:test";
import { summaryExchange } from "@bochica/shared";
import { MockLanguageModelV4 } from "ai/test";
import { compactConversation } from "./compaction";
import { contextUsage, contextWindowFor, estimateContext } from "./context";

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const signal = new AbortController().signal;

describe("context", () => {
  test("windows come from the model list, or a default per provider", () => {
    expect(contextWindowFor("openrouter", 32_000)).toBe(32_000);
    expect(contextWindowFor("anthropic")).toBe(200_000);
    expect(contextWindowFor("lmstudio")).toBe(8_192);
  });

  test("the real count is split using the estimate", () => {
    const estimate = estimateContext(
      "x".repeat(350),
      [],
      [{ role: "user", content: "y".repeat(700) }],
    );
    expect(estimate).toEqual({ instructions: 100, tools: 1, conversation: 200 });
    // The turn added tool results and an answer: that is conversation.
    expect(contextUsage(602, 8_192, estimate)).toEqual({
      used: 602,
      window: 8_192,
      instructions: 100,
      tools: 1,
      conversation: 501,
    });
    // The estimate ran high: every part shrinks with it.
    expect(contextUsage(150, 8_192, estimate)).toMatchObject({
      instructions: 50,
      conversation: 100,
    });
    expect(contextUsage(null, 8_192, estimate).used).toBe(301);
  });
});

describe("compactConversation", () => {
  const history = [
    { role: "user" as const, content: "page 1?", id: "u1" },
    { role: "assistant" as const, content: "one" },
    { role: "user" as const, content: "page 2?", id: "u2" },
    { role: "assistant" as const, content: "two" },
    { role: "user" as const, content: "page 3?", id: "u3" },
    { role: "assistant" as const, content: "three" },
  ];

  test("summarises the older exchanges and keeps the last ones", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: " They asked about page 1. " }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      }),
    });
    const result = await compactConversation({
      model,
      history,
      keep: 2,
      maxChars: 10_000,
      abortSignal: signal,
    });
    expect(result?.compaction).toEqual({ summary: "They asked about page 1.", from: "u2" });
    expect(result?.kept.map((m) => m.content)).toEqual(["page 2?", "two", "page 3?", "three"]);
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("page 1?");
    expect(prompt).not.toContain("page 3?");
  });

  test("a long transcript loses its oldest part, never the previous summary", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "New summary." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      }),
    });
    const long = [
      ...summaryExchange("Pages 1 to 9 are done."),
      { role: "user" as const, content: `OLDEST ${"x".repeat(5_000)}`, id: "u1" },
      { role: "assistant" as const, content: "ok" },
      { role: "user" as const, content: `LATEST ${"y".repeat(500)}`, id: "u2" },
      { role: "assistant" as const, content: "ok" },
    ];
    await compactConversation({
      model,
      history: long,
      keep: 0,
      maxChars: 2_000,
      abortSignal: signal,
    });
    const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(sent).toContain("Pages 1 to 9 are done.");
    expect(sent).toContain("LATEST");
    expect(sent).not.toContain("OLDEST");
  });

  test("keep 0 summarises everything; nothing older means nothing to do", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "All of it." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      }),
    });
    const all = await compactConversation({
      model,
      history,
      keep: 0,
      maxChars: 10_000,
      abortSignal: signal,
    });
    expect(all).toEqual({ compaction: { summary: "All of it." }, kept: [] });
    expect(
      await compactConversation({ model, history, keep: 3, maxChars: 10_000, abortSignal: signal }),
    ).toBeNull();
  });
});
