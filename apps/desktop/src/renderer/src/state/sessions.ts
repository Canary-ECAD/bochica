import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatErrorCode,
  ChatEvent,
  ChatMessage,
  ProviderId,
} from "@bochica/shared";
import { create } from "zustand";

// Conversations live in memory for now; S5 persists them in SQLite.

export interface ToolPart {
  type: "tool";
  callId: string;
  server: string;
  tool: string;
  input: unknown;
  status: "running" | "ok" | "error" | "denied";
  output?: string;
}

/** What an assistant message shows, in order: text interleaved with tool calls. */
export type MessagePart = { type: "text"; text: string } | ToolPart;

export interface Message {
  /** For assistant messages this is the turn id. */
  id: string;
  role: "user" | "assistant";
  /** All text of the message, without tool calls; this is what later turns send as history. */
  content: string;
  parts: MessagePart[];
  status: "streaming" | "done" | "stopped" | "length" | "error";
  error?: { code: ChatErrorCode; message: string };
  /** Tool calls of this turn waiting for the user. */
  approvals: ApprovalRequest[];
}

interface Session {
  id: string;
  title: string;
  messages: Message[];
}

export interface ModelChoice {
  provider: ProviderId;
  model: string;
}

interface SessionsState {
  sessions: Record<string, Session>;
  /** Newest first. */
  order: string[];
  turnToSession: Record<string, string>;
  createSession(): string;
  addExchange(sessionId: string, text: string, turnId: string): void;
  removeMessages(sessionId: string, ids: string[]): void;
  applyEvent(event: ChatEvent): void;
  addApproval(request: ApprovalRequest): void;
  removeApproval(requestId: string): void;
}

const TITLE_LENGTH = 48;

export const useSessions = create<SessionsState>()((set) => ({
  sessions: {},
  order: [],
  turnToSession: {},

  createSession: () => {
    const id = crypto.randomUUID();
    set((state) => ({
      sessions: { ...state.sessions, [id]: { id, title: "", messages: [] } },
      order: [id, ...state.order],
    }));
    return id;
  },

  addExchange: (sessionId, text, turnId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      const title =
        session.title ||
        (text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH).trimEnd()}…` : text);
      const messages: Message[] = [
        ...session.messages,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: text,
          parts: [{ type: "text", text }],
          status: "done",
          approvals: [],
        },
        {
          id: turnId,
          role: "assistant",
          content: "",
          parts: [],
          status: "streaming",
          approvals: [],
        },
      ];
      return {
        sessions: { ...state.sessions, [sessionId]: { ...session, title, messages } },
        turnToSession: { ...state.turnToSession, [turnId]: sessionId },
      };
    }),

  removeMessages: (sessionId, ids) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      const messages = session.messages.filter((m) => !ids.includes(m.id));
      return { sessions: { ...state.sessions, [sessionId]: { ...session, messages } } };
    }),

  applyEvent: (event) =>
    set((state) =>
      updateTurn(state, event.turnId, (m): Message => {
        switch (event.type) {
          case "text-delta":
            return {
              ...m,
              content: m.content + event.text,
              parts: appendText(m.parts, event.text),
            };
          case "tool-call":
            return {
              ...m,
              parts: [
                ...m.parts,
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
              ...m,
              parts: m.parts.map((p) =>
                p.type === "tool" && p.callId === event.callId
                  ? { ...p, status: event.status, output: event.output }
                  : p,
              ),
            };
          case "turn-end":
            return {
              ...m,
              status:
                event.reason === "aborted"
                  ? "stopped"
                  : event.reason === "length"
                    ? "length"
                    : "done",
              approvals: [],
            };
          case "error":
            return {
              ...m,
              status: "error",
              error: { code: event.code, message: event.message },
              approvals: [],
            };
        }
      }),
    ),

  addApproval: (request) =>
    set((state) =>
      updateTurn(state, request.turnId, (m) => ({ ...m, approvals: [...m.approvals, request] })),
    ),

  removeApproval: (requestId) =>
    set((state) => {
      const sessions = Object.fromEntries(
        Object.entries(state.sessions).map(([id, session]) => [
          id,
          {
            ...session,
            messages: session.messages.map((m) =>
              m.approvals.some((a) => a.requestId === requestId)
                ? { ...m, approvals: m.approvals.filter((a) => a.requestId !== requestId) }
                : m,
            ),
          },
        ]),
      );
      return { sessions };
    }),
}));

/** Applies `update` to the assistant message of a turn, wherever its session is. */
function updateTurn(
  state: SessionsState,
  turnId: string,
  update: (message: Message) => Message,
): Partial<SessionsState> {
  const sessionId = state.turnToSession[turnId];
  const session = sessionId ? state.sessions[sessionId] : undefined;
  if (!sessionId || !session) return state;
  const messages = session.messages.map((m) => (m.id === turnId ? update(m) : m));
  return { sessions: { ...state.sessions, [sessionId]: { ...session, messages } } };
}

function appendText(parts: MessagePart[], text: string): MessagePart[] {
  const last = parts.at(-1);
  if (last?.type === "text")
    return [...parts.slice(0, -1), { type: "text", text: last.text + text }];
  return [...parts, { type: "text", text }];
}

/**
 * The conversation as the model should see it: failed exchanges are left out entirely, so
 * user and assistant messages keep alternating.
 */
export function toHistory(messages: Message[]): ChatMessage[] {
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

export function sendMessage(sessionId: string, text: string, choice: ModelChoice): void {
  const session = useSessions.getState().sessions[sessionId];
  if (!session) return;
  const turnId = crypto.randomUUID();
  const messages = [...toHistory(session.messages), { role: "user" as const, content: text }];
  useSessions.getState().addExchange(sessionId, text, turnId);
  window.bochica.chat
    .send({ turnId, sessionId, provider: choice.provider, model: choice.model, messages })
    .catch((error: unknown) =>
      useSessions.getState().applyEvent({
        turnId,
        type: "error",
        code: "unknown",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
}

/** Drops a failed answer and the question before it, then asks again. */
export function retry(sessionId: string, failedTurnId: string, choice: ModelChoice): void {
  const session = useSessions.getState().sessions[sessionId];
  const index = session?.messages.findIndex((m) => m.id === failedTurnId) ?? -1;
  const question = session?.messages[index - 1];
  if (!session || index < 1 || question?.role !== "user") return;
  useSessions.getState().removeMessages(sessionId, [question.id, failedTurnId]);
  sendMessage(sessionId, question.content, choice);
}

export function stopTurn(turnId: string): void {
  void window.bochica.chat.stop(turnId);
}

export function answerApproval(requestId: string, decision: ApprovalDecision): void {
  useSessions.getState().removeApproval(requestId);
  void window.bochica.approvals.respond({ requestId, decision });
}
