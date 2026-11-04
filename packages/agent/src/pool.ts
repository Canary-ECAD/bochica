import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";
import type { ProviderId } from "@bochica/shared";
import { APICallError } from "ai";

// Several keys for one provider: every model call goes to the first usable key, and a call the
// provider refuses before answering is sent again with the next one. Nothing of a refused call
// reached the loop, so moving on repeats nothing, also in the middle of a turn.

/** What a model call said about the key it used. */
export type KeyOutcome = "ok" | "invalid" | "rate_limit" | "quota";

export interface PooledKey {
  id: string;
  key: string;
  /** Rejected before, or paused after a rate limit or an empty balance. */
  paused: boolean;
}

/** The provider's keys in use order; owned by main, which decrypts them and keeps the pauses. */
export interface KeyPool {
  keys(): PooledKey[];
  report(id: string, outcome: KeyOutcome): void;
}

/** The refusals that are about the key, not the request: those move on to the next key. */
export function keyOutcome(error: unknown): Exclude<KeyOutcome, "ok"> | undefined {
  if (!APICallError.isInstance(error)) return undefined;
  const status = error.statusCode;
  if (status === 401 || status === 403) return "invalid";
  if (status === 429) return "rate_limit";
  if (status === 402) return "quota";
  return undefined;
}

/**
 * A model that spreads its calls over a pool of keys. `build` makes the provider's model for
 * one key. When every key is paused the call goes to the first one alone, so the SDK's own
 * retries behave as they do with a single key.
 */
export function pooledModel(
  provider: ProviderId,
  modelId: string,
  pool: KeyPool,
  build: (key: string) => LanguageModelV4,
): LanguageModelV4 {
  const built = new Map<string, LanguageModelV4>();
  const modelFor = (entry: PooledKey): LanguageModelV4 => {
    const cached = built.get(entry.id);
    if (cached) return cached;
    const model = build(entry.key);
    built.set(entry.id, model);
    return model;
  };
  const candidates = (): PooledKey[] => {
    const all = pool.keys();
    const usable = all.filter((entry) => !entry.paused);
    return usable.length > 0 ? usable : all.slice(0, 1);
  };

  async function call<T>(
    options: LanguageModelV4CallOptions,
    run: (model: LanguageModelV4) => PromiseLike<T>,
  ): Promise<T> {
    const keys = candidates();
    if (keys.length === 0) throw new Error(`No API key saved for ${provider}.`);
    let lastError: unknown;
    for (const entry of keys) {
      try {
        // oxlint-disable-next-line no-await-in-loop
        const result = await run(modelFor(entry));
        pool.report(entry.id, "ok");
        return result;
      } catch (error) {
        const outcome = keyOutcome(error);
        if (!outcome || options.abortSignal?.aborted) throw error;
        pool.report(entry.id, outcome);
        lastError = error;
      }
    }
    throw lastError;
  }

  return {
    specificationVersion: "v4",
    provider,
    modelId,
    // The URLs a provider fetches itself don't depend on the key.
    get supportedUrls() {
      const first = candidates()[0];
      return first ? modelFor(first).supportedUrls : {};
    },
    doGenerate: (options) => call(options, (model) => model.doGenerate(options)),
    doStream: (options) => call(options, (model) => model.doStream(options)),
  };
}
