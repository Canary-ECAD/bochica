import { type ChatMessage, type Compaction, summaryExchange } from "@bochica/shared";
import { generateText, type LanguageModel } from "ai";

// Summarising the older part of a conversation so it fits in the model's context. The summary
// replaces those messages for the model only; the user still sees all of them.

const SUMMARY_PROMPT = `You summarise a conversation between a user and Bochica, an assistant that helps electrical designers work with EPLAN. The summary replaces the conversation in Bochica's memory, so it must let Bochica continue the work as if it remembered everything that matters.

Write in the language the user writes in. Use short sections with bullet points:
- What the user wants overall, and what has been done so far.
- Decisions and facts established (names of EPLAN projects, pages, devices, properties, settings).
- Files read, created or changed, with their paths.
- The user's preferences and corrections (how they want things done).
- Open questions and the next step, if any.

Keep exact names, numbers and paths. Leave out greetings, small talk and tool output that no longer matters. At most about 600 words. Reply with the summary only.`;

/** Exchanges as user/assistant pairs, in order. */
function exchanges(history: readonly ChatMessage[]): ChatMessage[][] {
  const pairs: ChatMessage[][] = [];
  for (let i = 0; i < history.length; i += 2) pairs.push(history.slice(i, i + 2));
  return pairs;
}

/** How a previous summary starts, as toHistory puts it first. */
const PREVIOUS_SUMMARY = summaryExchange("")[0]?.content ?? "";

function render(list: readonly ChatMessage[]): string {
  return list.map((m) => `${m.role === "user" ? "User" : "Assistant"}:\n${m.content}`).join("\n\n");
}

function transcript(messages: readonly ChatMessage[], maxChars: number): string {
  // A previous summary is always kept whole: it stands for everything before it.
  const keepsSummary = messages[0]?.content.startsWith(PREVIOUS_SUMMARY) ?? false;
  const head = keepsSummary ? render(messages.slice(0, 2)) : "";
  const rest = render(keepsSummary ? messages.slice(2) : messages);
  const room = Math.max(0, maxChars - head.length);
  // Too long to summarise in one call: the oldest part goes first, the latest matters most.
  const tail = rest.length > room ? `[…]\n${rest.slice(rest.length - room)}` : rest;
  return head ? `${head}\n\n${tail}` : tail;
}

export interface CompactOptions {
  model: LanguageModel;
  /** The conversation before the new message, as toHistory builds it. */
  history: readonly ChatMessage[];
  /** Exchanges at the end kept word for word. */
  keep: number;
  /** The longest transcript to summarise, in characters (keep it well inside the window). */
  maxChars: number;
  abortSignal: AbortSignal;
}

export interface CompactResult {
  compaction: Compaction;
  /** The history to send from now on: the summary exchange and the kept exchanges. */
  kept: ChatMessage[];
}

/** Summarises all but the last `keep` exchanges; null when there is nothing to summarise. */
export async function compactConversation({
  model,
  history,
  keep,
  maxChars,
  abortSignal,
}: CompactOptions): Promise<CompactResult | null> {
  const pairs = exchanges(history);
  const split = Math.max(0, pairs.length - keep);
  const older = pairs.slice(0, split).flat();
  const kept = pairs.slice(split).flat();
  if (older.length === 0) return null;
  const { text } = await generateText({
    model,
    instructions: SUMMARY_PROMPT,
    messages: [{ role: "user", content: transcript(older, maxChars) }],
    abortSignal,
    maxRetries: 2,
  });
  const summary = text.trim();
  if (!summary) throw new Error("The model returned an empty summary.");
  const from = kept[0]?.id;
  return { compaction: { summary, ...(from ? { from } : {}) }, kept };
}
