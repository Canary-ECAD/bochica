import {
  applyTurnEvent,
  type ApprovalDecision,
  type ApprovalRequest,
  assistantPlaceholder,
  type ChatEvent,
  type ConversationMessage,
  type ProviderId,
  type SessionDetail,
  type SessionSummary,
  titleFrom,
  toHistory,
  userMessage,
} from "@bochica/shared";
import { create } from "zustand";
import { useMode } from "./mode";

// The renderer's view of the conversations. Main saves everything as turns happen; this store
// mirrors it for the UI and loads saved sessions on demand.

export type { MessagePart, ToolPart } from "@bochica/shared";

/** A message as shown: what is saved, plus tool calls waiting for the user (never saved). */
export type Message = ConversationMessage & { approvals: ApprovalRequest[] };

interface Session {
  id: string;
  title: string;
  messages: Message[];
  /** False for a saved session listed in the sidebar whose messages aren't loaded yet. */
  loaded: boolean;
}

export interface ModelChoice {
  provider: ProviderId;
  model: string;
}

interface SessionsState {
  sessions: Record<string, Session>;
  /** Most recently active first. */
  order: string[];
  turnToSession: Record<string, string>;
  createSession(): string;
  setSummaries(summaries: SessionSummary[]): void;
  loadSession(detail: SessionDetail): void;
  addExchange(sessionId: string, text: string, userMessageId: string, turnId: string): void;
  removeMessages(sessionId: string, ids: string[]): void;
  applyEvent(event: ChatEvent): void;
  addApproval(request: ApprovalRequest): void;
  removeApproval(requestId: string): void;
  rename(sessionId: string, title: string): void;
  remove(sessionId: string): void;
}

const withApprovals = (message: ConversationMessage): Message => ({ ...message, approvals: [] });

export const useSessions = create<SessionsState>()((set) => ({
  sessions: {},
  order: [],
  turnToSession: {},

  createSession: () => {
    const id = crypto.randomUUID();
    set((state) => ({
      sessions: { ...state.sessions, [id]: { id, title: "", messages: [], loaded: true } },
      order: [id, ...state.order],
    }));
    return id;
  },

  setSummaries: (summaries) =>
    set((state) => {
      const sessions = { ...state.sessions };
      for (const summary of summaries) {
        sessions[summary.id] ??= {
          id: summary.id,
          title: summary.title,
          messages: [],
          loaded: false,
        };
      }
      // Sessions only in memory (nothing sent yet) stay on top; saved ones follow, newest first.
      const saved = new Set(summaries.map((s) => s.id));
      const unsaved = state.order.filter((id) => !saved.has(id));
      return { sessions, order: [...unsaved, ...summaries.map((s) => s.id)] };
    }),

  loadSession: (detail) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [detail.id]: {
          id: detail.id,
          title: detail.title,
          messages: detail.messages.map(withApprovals),
          loaded: true,
        },
      },
      order: state.order.includes(detail.id) ? state.order : [detail.id, ...state.order],
    })),

  addExchange: (sessionId, text, userMessageId, turnId) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      const messages: Message[] = [
        ...session.messages,
        withApprovals(userMessage(userMessageId, text)),
        withApprovals(assistantPlaceholder(turnId)),
      ];
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...session, title: session.title || titleFrom(text), messages },
        },
        order: [sessionId, ...state.order.filter((id) => id !== sessionId)],
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
      updateTurn(state, event.turnId, (m) => ({
        ...applyTurnEvent(m, event),
        // The turn is over: nothing can be waiting for approval any more.
        approvals: event.type === "turn-end" || event.type === "error" ? [] : m.approvals,
      })),
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

  rename: (sessionId, title) =>
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...session, title } } };
    }),

  remove: (sessionId) =>
    set((state) => {
      const { [sessionId]: _removed, ...sessions } = state.sessions;
      return { sessions, order: state.order.filter((id) => id !== sessionId) };
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

/** Fills the sidebar with the saved sessions. */
export async function loadSavedSessions(): Promise<void> {
  useSessions.getState().setSummaries(await window.bochica.sessions.list());
}

/** Loads a saved session's messages if needed. Resolves false if it doesn't exist. */
export async function ensureLoaded(sessionId: string): Promise<boolean> {
  if (useSessions.getState().sessions[sessionId]?.loaded) return true;
  const detail = await window.bochica.sessions.get(sessionId);
  if (!detail) return false;
  useSessions.getState().loadSession(detail);
  return true;
}

export function sendMessage(sessionId: string, text: string, choice: ModelChoice): void {
  const session = useSessions.getState().sessions[sessionId];
  if (!session) return;
  const turnId = crypto.randomUUID();
  const userMessageId = crypto.randomUUID();
  const messages = [...toHistory(session.messages), { role: "user" as const, content: text }];
  useSessions.getState().addExchange(sessionId, text, userMessageId, turnId);
  window.bochica.chat
    .send({
      turnId,
      sessionId,
      userMessageId,
      mode: useMode.getState().mode,
      provider: choice.provider,
      model: choice.model,
      messages,
    })
    .catch((error: unknown) =>
      useSessions.getState().applyEvent({
        turnId,
        type: "error",
        code: "unknown",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
}

/** Drops a failed answer and the question before it (here and on disk), then asks again. */
export function retry(sessionId: string, failedTurnId: string, choice: ModelChoice): void {
  const session = useSessions.getState().sessions[sessionId];
  const index = session?.messages.findIndex((m) => m.id === failedTurnId) ?? -1;
  const question = session?.messages[index - 1];
  if (!session || index < 1 || question?.role !== "user") return;
  const ids = [question.id, failedTurnId];
  useSessions.getState().removeMessages(sessionId, ids);
  void window.bochica.sessions.removeMessages({ sessionId, ids });
  sendMessage(sessionId, question.content, choice);
}

export function stopTurn(turnId: string): void {
  void window.bochica.chat.stop(turnId);
}

export function answerApproval(
  requestId: string,
  decision: ApprovalDecision,
  typed?: string,
): void {
  useSessions.getState().removeApproval(requestId);
  void window.bochica.approvals.respond({
    requestId,
    decision,
    ...(typed === undefined ? {} : { typed }),
  });
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  useSessions.getState().rename(sessionId, title);
  await window.bochica.sessions.rename({ id: sessionId, title });
}

export async function deleteSession(sessionId: string): Promise<void> {
  useSessions.getState().remove(sessionId);
  await window.bochica.sessions.remove(sessionId);
}
