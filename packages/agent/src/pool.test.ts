import { describe, expect, test } from "bun:test";
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { TurnEvent } from "@bochica/shared";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { runTurn } from "./loop";
import { type KeyOutcome, type KeyPool, keyOutcome, pooledModel, type PooledKey } from "./pool";

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

const apiError = (statusCode: number) =>
  new APICallError({
    message: `HTTP ${statusCode}`,
    url: "https://api.example.test/v1/chat",
    requestBodyValues: {},
    statusCode,
    isRetryable: false,
  });

function answering(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "t" });
          controller.enqueue({ type: "text-delta", id: "t", delta: text });
          controller.enqueue({ type: "text-end", id: "t" });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage,
          });
          controller.close();
        },
      }),
    }),
  });
}

function refusing(status: number): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw apiError(status);
    },
  });
}

/** A pool over fixed keys that records what the model reported. */
function fakePool(entries: Array<Partial<PooledKey> & { id: string }>) {
  const reports: Array<[string, KeyOutcome]> = [];
  const pool: KeyPool = {
    keys: () => entries.map((entry) => ({ key: `key-${entry.id}`, paused: false, ...entry })),
    report: (id, outcome) => reports.push([id, outcome]),
  };
  return { pool, reports };
}

async function answer(model: LanguageModelV4): Promise<string> {
  const events: TurnEvent[] = [];
  for await (const event of runTurn({
    model,
    messages: [{ role: "user", content: "Hi" }],
    abortSignal: new AbortController().signal,
  })) {
    events.push(event);
  }
  const failed = events.find((e) => e.type === "error");
  if (failed?.type === "error") return `error:${failed.code}`;
  return events.map((e) => (e.type === "text-delta" ? e.text : "")).join("");
}

describe("pooledModel", () => {
  test("a rejected key hands the call to the next one", async () => {
    const { pool, reports } = fakePool([{ id: "a" }, { id: "b" }]);
    const models: Record<string, MockLanguageModelV4> = {
      "key-a": refusing(401),
      "key-b": answering("from b"),
    };
    const model = pooledModel("openai", "gpt-test", pool, (key) => models[key] ?? refusing(500));

    expect(await answer(model)).toBe("from b");
    expect(reports).toEqual([
      ["a", "invalid"],
      ["b", "ok"],
    ]);
  });

  test("a rate limit and an empty balance move on too, with their own outcome", async () => {
    const { pool, reports } = fakePool([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const models: Record<string, MockLanguageModelV4> = {
      "key-a": refusing(429),
      "key-b": refusing(402),
      "key-c": answering("from c"),
    };
    const model = pooledModel("openrouter", "m", pool, (key) => models[key] ?? refusing(500));

    expect(await answer(model)).toBe("from c");
    expect(reports.map(([, outcome]) => outcome)).toEqual(["rate_limit", "quota", "ok"]);
  });

  test("an error that isn't about the key does not move on", async () => {
    const { pool, reports } = fakePool([{ id: "a" }, { id: "b" }]);
    const second = answering("never");
    const model = pooledModel("openai", "m", pool, (key) =>
      key === "key-a" ? refusing(500) : second,
    );

    expect(await answer(model)).toBe("error:provider_unavailable");
    expect(second.doStreamCalls).toHaveLength(0);
    expect(reports).toEqual([]);
  });

  test("paused keys are skipped; when all are paused only the first is tried", async () => {
    const skipped = fakePool([{ id: "a", paused: true }, { id: "b" }]);
    const used: string[] = [];
    const build = (key: string) => {
      used.push(key);
      return answering(key);
    };
    expect(await answer(pooledModel("openai", "m", skipped.pool, build))).toBe("key-b");

    const allPaused = fakePool([
      { id: "a", paused: true },
      { id: "b", paused: true },
    ]);
    const tried: string[] = [];
    const model = pooledModel("openai", "m", allPaused.pool, (key) => {
      tried.push(key);
      return refusing(429);
    });
    expect(await answer(model)).toBe("error:rate_limit");
    // The SDK retries a 429 itself, always with the first key.
    expect(new Set(tried)).toEqual(new Set(["key-a"]));
  });

  test("the last refusal reaches the loop when every key is refused", async () => {
    const { pool } = fakePool([{ id: "a" }, { id: "b" }]);
    const model = pooledModel("anthropic", "m", pool, () => refusing(401));
    expect(await answer(model)).toBe("error:invalid_key");
  });

  test("no keys at all is an error, not a hang", async () => {
    const { pool } = fakePool([]);
    const model = pooledModel("anthropic", "m", pool, () => answering("x"));
    expect(await answer(model)).toBe("error:unknown");
  });
});

describe("keyOutcome", () => {
  test.each([
    [401, "invalid"],
    [403, "invalid"],
    [429, "rate_limit"],
    [402, "quota"],
    [400, undefined],
    [500, undefined],
  ] as const)("HTTP %d → %s", (status, outcome) => {
    expect(keyOutcome(apiError(status))).toBe(outcome);
  });

  test("a network failure is not about the key", () => {
    expect(keyOutcome(new TypeError("fetch failed"))).toBeUndefined();
  });
});
