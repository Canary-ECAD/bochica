import { z } from "zod";
import { ChatErrorCode, type ChatMessage, type TurnEvent } from "./ipc";

// The conversation model shared by main (which saves it) and the renderer (which shows it).
// Both build assistant messages from chat events with the same reducer, so what is saved is
// exactly what was on screen.

export const ToolPart = z.object({
  type: z.literal("tool"),
  callId: z.string(),
  server: z.string(),
  tool: z.string(),
  input: z.unknown(),
  status: z.enum(["running", "ok", "error", "denied"]),
  output: z.string().optional(),
});
export type ToolPart = z.infer<typeof ToolPart>;

export const MessagePart = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  ToolPart,
]);
export type MessagePart = z.infer<typeof MessagePart>;

export const ConversationMessage = z.object({
  /** For assistant messages this is the turn id. */
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  /** All text of the message, without tool calls; this is what later turns send as history. */
  content: z.string(),
  /** What the message shows, in order: text interleaved with tool calls. */
  parts: z.array(MessagePart),
  status: z.enum(["streaming", "done", "stopped", "length", "error"]),
  error: z.object({ code: ChatErrorCode, message: z.string() }).optional(),
});
export type ConversationMessage = z.infer<typeof ConversationMessage>;

export const SessionSummary = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.number(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const SessionDetail = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(ConversationMessage),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

const TITLE_LENGTH = 48;

/** A session's title from its first message: the message itself, shortened. */
export function titleFrom(text: string): string {
  const line = text.trim().split(/\r?\n/)[0] ?? "";
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH).trimEnd()}…` : line;
}

export function userMessage(id: string, text: string): ConversationMessage {
  return { id, role: "user", content: text, parts: [{ type: "text", text }], status: "done" };
}

export function assistantPlaceholder(turnId: string): ConversationMessage {
  return { id: turnId, role: "assistant", content: "", parts: [], status: "streaming" };
}

function appendText(parts: MessagePart[], text: string): MessagePart[] {
  const last = parts.at(-1);
  if (last?.type === "text")
    return [...parts.slice(0, -1), { type: "text", text: last.text + text }];
  return [...parts, { type: "text", text }];
}

/** The assistant message after one more event of its turn. */
export function applyTurnEvent(
  message: ConversationMessage,
  event: TurnEvent,
): ConversationMessage {
  switch (event.type) {
    case "text-delta":
      return {
        ...message,
        content: message.content + event.text,
        parts: appendText(message.parts, event.text),
      };
    case "tool-call":
      return {
        ...message,
        parts: [
          ...message.parts,
          {
            type: "tool",
            callId: event.callId,
            server: event.server,
            tool: event.tool,
            input: event.input,
            status: "running",
          },
        ],
      };
    case "tool-result":
      return {
        ...message,
        parts: message.parts.map((p) =>
          p.type === "tool" && p.callId === event.callId
            ? { ...p, status: event.status, output: event.output }
            : p,
        ),
      };
    case "turn-end":
      return {
        ...message,
        status:
          event.reason === "aborted" ? "stopped" : event.reason === "length" ? "length" : "done",
      };
    case "error":
      return { ...message, status: "error", error: { code: event.code, message: event.message } };
  }
}

/**
 * The conversation as the model should see it: failed exchanges are left out entirely, so
 * user and assistant messages keep alternating.
 */
export function toHistory(messages: ConversationMessage[]): ChatMessage[] {
  const history: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const reply = messages[i + 1];
    if (message?.role !== "user" || reply?.role !== "assistant") continue;
    if (reply.status === "error" || reply.status === "streaming" || !reply.content) continue;
    history.push({ role: "user", content: message.content });
    history.push({ role: "assistant", content: reply.content });
    i++;
  }
  return history;
}
