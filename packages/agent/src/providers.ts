// Catalog of supported model providers. The agent loop never branches on a provider id: anything
// provider-specific belongs here, so adding a provider is a new entry, not a change to the loop.

export type ProviderId = "anthropic" | "openai" | "google" | "openrouter" | "ollama" | "lmstudio";

export interface Provider {
  id: ProviderId;
  label: string;
  /** "api_key" providers need a credential; "local" ones talk to a server on this machine. */
  auth: "api_key" | "local";
  /** Where the user gets a key, shown as the "where do I get my key?" link. */
  keyUrl?: string;
  /** Default endpoint for local, OpenAI-compatible servers. */
  baseUrl?: string;
}

export const providers: readonly Provider[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    auth: "api_key",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    auth: "api_key",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "google",
    label: "Google Gemini",
    auth: "api_key",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    auth: "api_key",
    keyUrl: "https://openrouter.ai/keys",
  },
  { id: "ollama", label: "Ollama", auth: "local", baseUrl: "http://127.0.0.1:11434/v1" },
  { id: "lmstudio", label: "LM Studio", auth: "local", baseUrl: "http://127.0.0.1:1234/v1" },
];

export function getProvider(id: ProviderId): Provider {
  const provider = providers.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}
