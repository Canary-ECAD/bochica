import { describe, expect, test } from "bun:test";
import type { ProviderId } from "@bochica/shared";
import { createModel, listModels } from "./models";
import { providerIds } from "./providers";

const respondWith = (body: unknown, status = 200): typeof fetch =>
  Object.assign(async () => Response.json(body, { status }), { preconnect: () => {} });

describe("listModels", () => {
  test("Anthropic: uses display names, keeps the API order", async () => {
    const body = {
      data: [
        { id: "claude-newer", display_name: "Claude Newer" },
        { id: "claude-older", display_name: "Claude Older" },
      ],
    };
    expect(await listModels("anthropic", "k", respondWith(body))).toEqual([
      { id: "claude-newer", label: "Claude Newer" },
      { id: "claude-older", label: "Claude Older" },
    ]);
  });

  test("OpenAI: keeps chat models only, newest first", async () => {
    const body = {
      data: [
        { id: "gpt-old", created: 1 },
        { id: "text-embedding-3-small", created: 5 },
        { id: "gpt-realtime-preview", created: 6 },
        { id: "whisper-1", created: 7 },
        { id: "gpt-new", created: 9 },
        { id: "o4-mini", created: 3 },
      ],
    };
    const models = await listModels("openai", "k", respondWith(body));
    expect(models.map((m) => m.id)).toEqual(["gpt-new", "o4-mini", "gpt-old"]);
  });

  test("Google: Gemini models that can generate content, without the models/ prefix", async () => {
    const body = {
      models: [
        {
          name: "models/gemini-pro-x",
          displayName: "Gemini Pro X",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/gemini-embedding",
          displayName: "Embedding",
          supportedGenerationMethods: ["embedContent"],
        },
        {
          name: "models/other",
          displayName: "Other",
          supportedGenerationMethods: ["generateContent"],
        },
      ],
    };
    expect(await listModels("google", "k", respondWith(body))).toEqual([
      { id: "gemini-pro-x", label: "Gemini Pro X" },
    ]);
  });

  test("OpenRouter and local servers: OpenAI-style lists", async () => {
    expect(
      await listModels("openrouter", "k", respondWith({ data: [{ id: "a/b", name: "A: B" }] })),
    ).toEqual([{ id: "a/b", label: "A: B" }]);
    expect(await listModels("ollama", "", respondWith({ data: [{ id: "llama-x" }] }))).toEqual([
      { id: "llama-x", label: "llama-x" },
    ]);
  });

  test("a failed request rejects", async () => {
    await expect(listModels("anthropic", "bad", respondWith({}, 401))).rejects.toThrow("401");
  });
});

describe("createModel", () => {
  test.each(providerIds.map((id) => [id]))("builds a model for %s", (id: ProviderId) => {
    const model = createModel(id, "k", "some-model");
    expect(typeof model === "string" ? model : model.modelId).toBe("some-model");
  });
});
