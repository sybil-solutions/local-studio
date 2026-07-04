import type { PaneId, PaneState, WorkspaceState } from "@/features/agent/workspace/types";
import type { Session, SessionId } from "@/features/agent/runtime/types";

export function paneSessions(state: WorkspaceState, paneId: PaneId): Session[] {
  const session = activeSession(state, paneId);
  return session ? [session] : [];
}

export function paneSessionId(pane: PaneState | undefined): SessionId | null {
  return pane && pane.kind !== "terminal" ? pane.sessionId : null;
}

export function activeSession(state: WorkspaceState, paneId: PaneId): Session | null {
  const sessionId = paneSessionId(state.panesById.get(paneId));
  return sessionId ? (state.sessions.get(sessionId) ?? null) : null;
}

export function focusedSession(state: WorkspaceState): Session | null {
  return activeSession(state, state.focusedPaneId);
}

export function findPaneByPiSessionId(
  state: WorkspaceState,
  piSessionId: string,
): { paneId: PaneId; session: Session } | null {
  for (const [paneId, pane] of state.panesById.entries()) {
    const sessionId = paneSessionId(pane);
    const session = sessionId ? state.sessions.get(sessionId) : undefined;
    if (session?.piSessionId === piSessionId) return { paneId, session };
  }
  return null;
}

export function referencedSessionIds(state: WorkspaceState): Set<SessionId> {
  const ids = new Set<SessionId>();
  for (const pane of state.panesById.values()) {
    const sessionId = paneSessionId(pane);
    if (sessionId) ids.add(sessionId);
    if (pane.kind === "terminal" && pane.ownerSessionId) ids.add(pane.ownerSessionId);
  }
  return ids;
}

export { controlTargetHasActiveTurn } from "@shared/agent/agent-turn";
