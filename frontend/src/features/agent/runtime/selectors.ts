import type { PaneId, PaneState, WorkspaceState } from "@/features/agent/workspace/types";
import type { Session, SessionId } from "@/features/agent/runtime/types";

export function paneSessionId(pane: PaneState | undefined): SessionId | null {
  return pane?.sessionId ?? null;
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

export function findWorkspaceSessionByPiSessionId(
  state: WorkspaceState,
  piSessionId: string,
): { paneId: PaneId | null; session: Session } | null {
  const inPane = findPaneByPiSessionId(state, piSessionId);
  if (inPane) return inPane;
  let best: Session | null = null;
  for (const session of state.sessions.values()) {
    if (session.piSessionId !== piSessionId) continue;
    if (!best || sessionOutranks(session, best)) best = session;
  }
  return best ? { paneId: null, session: best } : null;
}

function sessionOutranks(candidate: Session, current: Session): boolean {
  const candidateWorking = candidate.status === "running" || candidate.status === "starting";
  const currentWorking = current.status === "running" || current.status === "starting";
  if (candidateWorking !== currentWorking) return candidateWorking;
  if (candidate.messages.length !== current.messages.length) {
    return candidate.messages.length > current.messages.length;
  }
  return (candidate.lastEventSeq ?? 0) > (current.lastEventSeq ?? 0);
}

export function referencedSessionIds(state: WorkspaceState): Set<SessionId> {
  const ids = new Set<SessionId>();
  for (const pane of state.panesById.values()) {
    ids.add(pane.sessionId);
  }
  return ids;
}

export { controlTargetHasActiveTurn } from "@shared/agent/agent-turn";
