import type { ChatErrorCode, ChatEvent, ChatMessage, ProviderId } from "@bochica/shared";
import { create } from "zustand";

// Conversations live in memory for now; S5 persists them in SQLite.

export interface Message {
  /** For assistant messages this is the turn id. */
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "stopped" | "length" | "error";
  error?: { code: ChatErrorCode; message: string };
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
        { id: crypto.randomUUID(), role: "user", content: text, status: "done" },
        { id: turnId, role: "assistant", content: "", status: "streaming" },
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
    set((state) => {
      const sessionId = state.turnToSession[event.turnId];
      const session = sessionId ? state.sessions[sessionId] : undefined;
      if (!sessionId || !session) return state;
      const messages = session.messages.map((m): Message => {
        if (m.id !== event.turnId) return m;
        switch (event.type) {
          case "text-delta":
            return { ...m, content: m.content + event.text };
          case "turn-end":
            return {
              ...m,
              status:
                event.reason === "aborted"
                  ? "stopped"
                  : event.reason === "length"
                    ? "length"
                    : "done",
            };
          case "error":
            return { ...m, status: "error", error: { code: event.code, message: event.message } };
        }
      });
      return { sessions: { ...state.sessions, [sessionId]: { ...session, messages } } };
    }),
}));

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
    .send({ turnId, provider: choice.provider, model: choice.model, messages })
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
