import { randomUUID } from "node:crypto";
import { parseMentions, type TurnEvent } from "@bochica/shared";
import { type AgentTool, DISPLAY_OUTPUT_LIMIT, runTool, truncate } from "./tools";

// `@path` in the user's new message: Bochica reads each file with the read_file tool (same
// path checks, limits and blocks as when the model reads it) and hands the contents to the
// model with the message. Each read shows in the activity log.

/** More mentions than this in one message are left as plain text. */
const MAX_MENTIONS = 10;

/**
 * Reads the files `content` mentions, yielding a tool-call and tool-result event per file, and
 * returns what to append to the message for the model ("" when nothing was attached).
 * Mentions that aren't existing files (`@everyone`) are left alone without a trace in the log.
 */
export async function* attachMentions(
  content: string,
  readFile: AgentTool | undefined,
  exists: (path: string) => boolean,
  signal: AbortSignal,
): AsyncGenerator<TurnEvent, string> {
  if (!readFile) return "";
  const attached: string[] = [];
  for (const path of parseMentions(content).filter(exists).slice(0, MAX_MENTIONS)) {
    const callId = `mention-${randomUUID()}`;
    yield {
      type: "tool-call",
      callId,
      server: readFile.server,
      tool: readFile.tool,
      input: { path },
    };
    // One file at a time: the log shows them in the order the user wrote them.
    // oxlint-disable-next-line no-await-in-loop
    const outcome = await runTool(readFile, { path }, { callId, approve: undefined, signal });
    yield {
      type: "tool-result",
      callId,
      status: outcome.status,
      output: truncate(outcome.text, DISPLAY_OUTPUT_LIMIT),
      ...(outcome.blocked ? { blocked: outcome.blocked } : {}),
    };
    attached.push(
      outcome.status === "ok"
        ? `<file path="${path}">\n${outcome.text}\n</file>`
        : `<file path="${path}" error="true">\nBochica could not attach this file: ${outcome.text}\n</file>`,
    );
  }
  if (attached.length === 0) return "";
  return `\n\nFiles the user attached with @ (numbered lines):\n\n${attached.join("\n\n")}`;
}
