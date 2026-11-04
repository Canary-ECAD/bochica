// Catalog of supported model providers. The agent loop never branches on a provider id: anything
// provider-specific belongs here, so adding a provider is a new entry, not a change to the loop.

import { ProviderId } from "@bochica/shared";

export const providerIds = ProviderId.options;

/** The cheapest authenticated request that proves a key works. */
interface ConnectionCheck {
  url: string;
  headers: (key: string) => Record<string, string>;
}

export interface Provider {
  id: ProviderId;
  label: string;
  /** "api_key" providers need a credential; "local" ones talk to a server on this machine. */
  auth: "api_key" | "local";
  /** Where the user gets a key, shown as the "where do I get my key?" link. */
  keyUrl?: string;
  /** Environment variables that may already hold a key, checked in order. */
  envVars: readonly string[];
  /** Default endpoint for local, OpenAI-compatible servers. */
  baseUrl?: string;
  check: ConnectionCheck;
  /** A browser sign-in that gives an API key (OAuth PKCE, loopback redirect); see oauth.ts. */
  login?: ProviderLogin;
}

export interface ProviderLogin {
  /** Page the browser opens, with `callback_url` and the PKCE challenge added. */
  authorizeUrl: string;
  /** Where the code from the redirect is swapped for the key. */
  exchangeUrl: string;
}

const bearer = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}` });

export const providers: readonly Provider[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    auth: "api_key",
    keyUrl: "https://console.anthropic.com/settings/keys",
    envVars: ["ANTHROPIC_API_KEY"],
    check: {
      url: "https://api.anthropic.com/v1/models?limit=1",
      headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
    },
  },
  {
    id: "openai",
    label: "OpenAI",
    auth: "api_key",
    keyUrl: "https://platform.openai.com/api-keys",
    envVars: ["OPENAI_API_KEY"],
    check: { url: "https://api.openai.com/v1/models", headers: bearer },
  },
  {
    id: "google",
    label: "Google Gemini",
    auth: "api_key",
    keyUrl: "https://aistudio.google.com/apikey",
    envVars: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    check: {
      url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      headers: (key) => ({ "x-goog-api-key": key }),
    },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    auth: "api_key",
    keyUrl: "https://openrouter.ai/keys",
    envVars: ["OPENROUTER_API_KEY"],
    check: { url: "https://openrouter.ai/api/v1/key", headers: bearer },
    // https://openrouter.ai/docs/guides/overview/auth/oauth: the key it gives is a normal,
    // user-owned API key; no client id, no secret, no refresh token.
    login: {
      authorizeUrl: "https://openrouter.ai/auth",
      exchangeUrl: "https://openrouter.ai/api/v1/auth/keys",
    },
  },
  {
    id: "ollama",
    label: "Ollama",
    auth: "local",
    envVars: [],
    baseUrl: "http://127.0.0.1:11434/v1",
    check: { url: "http://127.0.0.1:11434/v1/models", headers: () => ({}) },
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    auth: "local",
    envVars: [],
    baseUrl: "http://127.0.0.1:1234/v1",
    check: { url: "http://127.0.0.1:1234/v1/models", headers: () => ({}) },
  },
];

export function getProvider(id: ProviderId): Provider {
  const provider = providers.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}
