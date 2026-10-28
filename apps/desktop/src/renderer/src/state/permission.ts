import { create } from "zustand";

/**
 * How much Bochica asks in a session. ask: the usual cards. plan: the agent only reads and
 * proposes a plan. auto: calls run without asking, except what must always ask.
 */
export type PermissionMode = "ask" | "plan" | "auto";

interface PermissionState {
  /** Per session, in memory only: after a restart every session is back to "ask". */
  bySession: Record<string, PermissionMode>;
  /** What the next new session starts with, picked on the new-session page. */
  next: PermissionMode;
  set(sessionId: string | undefined, mode: PermissionMode): void;
}

export const usePermission = create<PermissionState>()((set) => ({
  bySession: {},
  next: "ask",
  set: (sessionId, mode) =>
    set((state) =>
      sessionId ? { bySession: { ...state.bySession, [sessionId]: mode } } : { next: mode },
    ),
}));

export function permissionOf(sessionId: string): PermissionMode {
  return usePermission.getState().bySession[sessionId] ?? "ask";
}

/**
 * Changes a session's mode (or, without a session, the next new session's). Main keeps the
 * Auto switch and applies it at once, also to a turn already running.
 */
export function setPermission(sessionId: string | undefined, mode: PermissionMode): void {
  const before = sessionId ? permissionOf(sessionId) : undefined;
  usePermission.getState().set(sessionId, mode);
  if (sessionId && (before === "auto") !== (mode === "auto"))
    void window.bochica.approvals.setAuto({ sessionId, on: mode === "auto" });
}

/** Gives a just-created session the mode picked on the new-session page; the next starts at Ask. */
export function startSessionWith(sessionId: string): void {
  setPermission(sessionId, usePermission.getState().next);
  usePermission.getState().set(undefined, "ask");
}
