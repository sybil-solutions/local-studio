import type { PaneId, WorkspaceState } from "@/features/agent/workspace/types";
import type { Session, SessionId } from "@/features/agent/runtime/types";

export function paneSessions(state: WorkspaceState, paneId: PaneId): Session[] {
  const session = activeSession(state, paneId);
  return session ? [session] : [];
}

export function activeSession(state: WorkspaceState, paneId: PaneId): Session | null {
  const pane = state.panesById.get(paneId);
  if (!pane) return null;
  return state.sessions.get(pane.sessionId) ?? null;
}

export function focusedSession(state: WorkspaceState): Session | null {
  return activeSession(state, state.focusedPaneId);
}

export function findPaneByPiSessionId(
  state: WorkspaceState,
  piSessionId: string,
): { paneId: PaneId; session: Session } | null {
  for (const [paneId, pane] of state.panesById.entries()) {
    const session = state.sessions.get(pane.sessionId);
    if (session?.piSessionId === piSessionId) return { paneId, session };
  }
  return null;
}

export function referencedSessionIds(state: WorkspaceState): Set<SessionId> {
  const ids = new Set<SessionId>();
  for (const pane of state.panesById.values()) {
    ids.add(pane.sessionId);
  }
  return ids;
}

// Moved to shared/agent/agent-turn.ts so the agent runtime package's /turn
// handler can share it; re-exported here for frontend callers.
export { controlTargetHasActiveTurn } from "@shared/agent/agent-turn";
