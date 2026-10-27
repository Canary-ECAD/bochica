import type { ChatMessage, ContextUsage, ProviderId } from "@bochica/shared";
import type { AgentTool } from "./tools";

// How big the model's context is and how full a turn will make it. Providers report the real
// count after each call; before a call, and to split the total into parts, Bochica estimates
// from characters, which is close enough to decide when to compact.

/** Windows to assume when the model list doesn't say. Local servers start small. */
const DEFAULT_WINDOWS: Record<ProviderId, number> = {
  anthropic: 200_000,
  openai: 128_000,
  google: 1_000_000,
  openrouter: 128_000,
  ollama: 8_192,
  lmstudio: 8_192,
};

/** Above this share of the window, the older conversation is summarised before the turn. */
export const COMPACT_AT = 0.75;

export function contextWindowFor(provider: ProviderId, reported?: number): number {
  return reported ?? DEFAULT_WINDOWS[provider];
}

/** A rough token count: about 3.5 characters per token, on the high side on purpose. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export interface ContextEstimate {
  instructions: number;
  tools: number;
  conversation: number;
}

/** What a turn will send, by part, before anything is sent. */
export function estimateContext(
  system: string,
  tools: readonly AgentTool[],
  messages: readonly ChatMessage[],
): ContextEstimate {
  return {
    instructions: estimateTokens(system),
    tools: estimateTokens(JSON.stringify(tools.map((t) => [t.name, t.description, t.inputSchema]))),
    conversation: estimateTokens(messages.map((m) => m.content).join("\n")),
  };
}

export function total(estimate: ContextEstimate): number {
  return estimate.instructions + estimate.tools + estimate.conversation;
}

/**
 * The usage to show after a turn: the provider's real count when there is one. Instructions
 * and tools don't change during a turn, so whatever the turn added (tool results, the answer)
 * counts as conversation; when the estimate ran high, every part shrinks with it.
 */
export function contextUsage(
  reported: number | null | undefined,
  window: number,
  estimate: ContextEstimate,
): ContextUsage {
  const estimated = total(estimate);
  const used = reported ?? estimated;
  const scale = estimated > 0 ? Math.min(1, used / estimated) : 0;
  const instructions = Math.round(estimate.instructions * scale);
  const tools = Math.round(estimate.tools * scale);
  return {
    used,
    window,
    instructions,
    tools,
    conversation: Math.max(0, used - instructions - tools),
  };
}
