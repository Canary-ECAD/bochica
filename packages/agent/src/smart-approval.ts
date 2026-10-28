import { generateText, type LanguageModel } from "ai";

// Smart approvals (guardrails layer 5, optional): before a card is shown for a PowerShell
// command that has no risk flags, the turn's own model is asked whether it is clearly harmless.
// Only a clear yes lets it run; a no, anything unclear, a failure or a slow answer shows the
// card as usual. It never sees risky or destructive calls: those always ask.

const JUDGE_PROMPT = `You review one Windows PowerShell command that an AI assistant wants to run on a user's computer, before the user is asked to approve it.

Answer APPROVE only if the command is clearly harmless: it only reads or shows information (lists folders, reads files, shows dates, versions, sizes, git status or log) and changes nothing — no files written, moved or deleted, no settings, processes, services, installs, network uploads or downloads.
Answer ESCALATE in every other case, and whenever you are not sure.

Reply with exactly one word: APPROVE or ESCALATE.`;

const DEFAULT_TIMEOUT_MS = 20_000;

export interface JudgeOptions {
  model: LanguageModel;
  command: string;
  /** What the assistant said the command does. */
  description: string;
  abortSignal: AbortSignal;
  timeoutMs?: number;
}

/** Whether the model judged the command clearly harmless. Never throws. */
export async function judgeCommand({
  model,
  command,
  description,
  abortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: JudgeOptions): Promise<boolean> {
  const timeout = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A provider that ignores the abort must not keep the card waiting either.
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      timeout.abort();
      resolve(false);
    }, timeoutMs);
  });
  const answer = generateText({
    model,
    instructions: JUDGE_PROMPT,
    messages: [
      {
        role: "user",
        content: `Command:\n${command}\n\nThe assistant says it will: ${description || "(no description)"}`,
      },
    ],
    abortSignal: AbortSignal.any([abortSignal, timeout.signal]),
    maxRetries: 0,
  }).then(
    ({ text }) =>
      text
        .trim()
        .replace(/[.!]+$/, "")
        .toUpperCase() === "APPROVE",
    () => false,
  );
  try {
    return await Promise.race([answer, late]);
  } finally {
    clearTimeout(timer);
  }
}
