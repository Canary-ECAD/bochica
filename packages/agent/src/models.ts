import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelInfo, ProviderId } from "@bochica/shared";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { getProvider } from "./providers";

// Main-process side of the provider catalog: building SDK models and listing what a key can
// use. Kept apart from providers.ts so the renderer can import the catalog without pulling in
// the SDKs.

const localModel = (id: ProviderId) => (key: string, modelId: string) =>
  createOpenAICompatible({
    name: id,
    baseURL: getProvider(id).baseUrl ?? "",
    ...(key ? { apiKey: key } : {}),
  }).chatModel(modelId);

const factories: Record<ProviderId, (key: string, modelId: string) => LanguageModel> = {
  anthropic: (key, modelId) => createAnthropic({ apiKey: key })(modelId),
  openai: (key, modelId) => createOpenAI({ apiKey: key })(modelId),
  google: (key, modelId) => createGoogle({ apiKey: key })(modelId),
  openrouter: (key, modelId) =>
    createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: key,
    }).chatModel(modelId),
  ollama: localModel("ollama"),
  lmstudio: localModel("lmstudio"),
};

export function createModel(provider: ProviderId, key: string, modelId: string): LanguageModel {
  return factories[provider](key, modelId);
}

interface ModelSource {
  url: string;
  parse: (body: unknown) => ModelInfo[];
}

const IdList = z.object({ data: z.array(z.object({ id: z.string() })) });

const openAiChat = /^(gpt-|o\d|chatgpt-)/;
const openAiNonChat = /(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct)/;

const sources: Record<ProviderId, ModelSource> = {
  anthropic: {
    url: "https://api.anthropic.com/v1/models?limit=100",
    parse: (body) =>
      z
        .object({ data: z.array(z.object({ id: z.string(), display_name: z.string() })) })
        .parse(body)
        .data.map((m) => ({ id: m.id, label: m.display_name })),
  },
  openai: {
    url: "https://api.openai.com/v1/models",
    parse: (body) =>
      z
        .object({ data: z.array(z.object({ id: z.string(), created: z.number() })) })
        .parse(body)
        .data.filter((m) => openAiChat.test(m.id) && !openAiNonChat.test(m.id))
        .toSorted((a, b) => b.created - a.created)
        .map((m) => ({ id: m.id, label: m.id })),
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    parse: (body) =>
      z
        .object({
          models: z.array(
            z.object({
              name: z.string(),
              displayName: z.string(),
              supportedGenerationMethods: z.array(z.string()).default([]),
            }),
          ),
        })
        .parse(body)
        .models.filter(
          (m) =>
            m.name.includes("gemini") && m.supportedGenerationMethods.includes("generateContent"),
        )
        .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName })),
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/models",
    parse: (body) =>
      z
        .object({ data: z.array(z.object({ id: z.string(), name: z.string() })) })
        .parse(body)
        .data.map((m) => ({ id: m.id, label: m.name })),
  },
  ollama: {
    url: "http://127.0.0.1:11434/v1/models",
    parse: (body) => IdList.parse(body).data.map((m) => ({ id: m.id, label: m.id })),
  },
  lmstudio: {
    url: "http://127.0.0.1:1234/v1/models",
    parse: (body) => IdList.parse(body).data.map((m) => ({ id: m.id, label: m.id })),
  },
};

/** The chat models a key can use, in the provider's own order (newest first where it has one). */
export async function listModels(
  provider: ProviderId,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelInfo[]> {
  const source = sources[provider];
  const response = await fetchImpl(source.url, {
    headers: getProvider(provider).check.headers(key),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Listing models failed with HTTP ${response.status}`);
  return source.parse(await response.json());
}
