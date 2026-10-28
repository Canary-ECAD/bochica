import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { judgeCommand } from "./smart-approval";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const signal = new AbortController().signal;

const answering = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    }),
  });

const judge = (model: MockLanguageModelV4, timeoutMs?: number) =>
  judgeCommand({
    model,
    command: "Get-ChildItem",
    description: "List the files",
    abortSignal: signal,
    ...(timeoutMs ? { timeoutMs } : {}),
  });

describe("judgeCommand", () => {
  test.each([
    ["APPROVE", true],
    [" approve. ", true],
    ["ESCALATE", false],
    ["APPROVE, but be careful", false],
    ["Yes, it is harmless", false],
    ["", false],
  ])("%p means %p", async (answer, expected) => {
    expect(await judge(answering(answer))).toBe(expected);
  });

  test("the model sees the command and what it is for", async () => {
    const model = answering("APPROVE");
    await judge(model);
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("Get-ChildItem");
    expect(prompt).toContain("List the files");
  });

  test("a failure or a slow answer shows the card", async () => {
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("rate limited");
      },
    });
    expect(await judge(failing)).toBe(false);
    const slow = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) => {
        await new Promise((_, reject) =>
          abortSignal?.addEventListener("abort", () => reject(new Error("aborted"))),
        );
        throw new Error("unreachable");
      },
    });
    expect(await judge(slow, 20)).toBe(false);
  });
});
