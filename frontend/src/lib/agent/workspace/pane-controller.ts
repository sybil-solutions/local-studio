import {
  collectLeaves,
  removeLeaf,
  setSplitRatio as setLayoutSplitRatio,
  splitLeaf,
} from "@/lib/agent/workspace/layout";
import type { Project } from "@/lib/agent/projects/types";
import type { Session, SessionId, SessionsMap } from "@/lib/agent/sessions/types";
import {
  isEmptyStarterSession,
  patchSession as patchSessionInMap,
  setSession as setSessionInMap,
  setSessions as setSessionsInMap,
  pruneSessions,
} from "@/lib/agent/sessions/store";
import { findPaneByPiSessionId, referencedSessionIds } from "@/lib/agent/sessions/selectors";
import type {
  PaneId,
  PaneState,
  WorkspaceLayout,
  WorkspaceSessionPayload,
  WorkspaceState,
} from "./types";

type SessionPayload = { tab?: Session };
type RuntimePanePayload = { runtimeSessionId?: string };

export type OpenNewSessionPayload = SessionPayload &
  RuntimePanePayload & {
    project?: Project;
    paneId?: PaneId;
  };
export type ReplaySessionPayload = SessionPayload & { piSessionId: string; sessionTitle?: string };
export type ReplaySessionInSplitPayload = ReplaySessionPayload &
  RuntimePanePayload & {
    paneId?: PaneId;
  };
export type OpenSessionPayloadInPanePayload = SessionPayload & {
  paneId: PaneId;
  payload: WorkspaceSessionPayload;
};
export type SplitPaneWithPayloadPayload = SessionPayload &
  RuntimePanePayload & {
    paneId: PaneId;
    newPaneId?: PaneId;
    direction: "vertical" | "horizontal";
    side: "a" | "b";
    payload: WorkspaceSessionPayload;
  };
export type SplitTabPayload = SessionPayload &
  RuntimePanePayload & {
    sourcePaneId: PaneId;
    sourceTabId: SessionId;
    newPaneId?: PaneId;
  };
export type UrlNavigationPayload = SessionPayload &
  RuntimePanePayload & {
    key: string;
    project: Project | null;
    sessionId?: string | null;
    sessionTitle?: string;
    newSession?: boolean;
    split?: boolean;
    paneId?: PaneId;
  };

function isSession(value: Session | undefined): value is Session {
  return Boolean(
    value &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.runtimeSessionId === "string" &&
    value.runtimeSessionId.length > 0,
  );
}

function replaySessionTitle(sessionTitle?: string, fallback = "Loading session"): string {
  return sessionTitle?.trim() || fallback;
}

function validPaneRuntime(paneId: PaneId | undefined, runtimeSessionId: string | undefined) {
  return Boolean(
    paneId &&
    typeof paneId === "string" &&
    runtimeSessionId &&
    typeof runtimeSessionId === "string",
  );
}

function paneExists(state: WorkspaceState, paneId: PaneId): boolean {
  return state.panesById.has(paneId);
}

function leafExists(state: WorkspaceState, paneId: PaneId): boolean {
  return collectLeaves(state.layout).includes(paneId);
}

function setPane(state: WorkspaceState, paneId: PaneId, pane: PaneState): WorkspaceState {
  const next = new Map(state.panesById);
  next.set(paneId, pane);
  return { ...state, panesById: next };
}

function withSessions(state: WorkspaceState, sessions: SessionsMap): WorkspaceState {
  return state.sessions === sessions ? state : { ...state, sessions };
}

/** Remove sessions from the map that aren't referenced by any pane anymore. */
function pruneOrphanSessions(state: WorkspaceState): WorkspaceState {
  return withSessions(state, pruneSessions(state.sessions, referencedSessionIds(state)));
}

// Re-exported for back-compat: callers still use this predicate name.
export { isEmptyStarterSession as isEmptyStarterTab };

function focusExistingSession(
  state: WorkspaceState,
  paneId: PaneId,
  sessionId: SessionId,
): WorkspaceState {
  const pane = state.panesById.get(paneId);
  if (!pane || !pane.sessionIds.includes(sessionId)) return state;
  return {
    ...setPane(state, paneId, { ...pane, activeSessionId: sessionId }),
    focusedPaneId: paneId,
  };
}

function addSessionToPane(state: WorkspaceState, paneId: PaneId, session: Session): WorkspaceState {
  const pane = state.panesById.get(paneId);
  if (!pane || !isSession(session)) return state;
  const sessions = setSessionInMap(state.sessions, session);
  const next = setPane(withSessions(state, sessions), paneId, {
    ...pane,
    sessionIds: [...pane.sessionIds, session.id],
    activeSessionId: session.id,
  });
  return { ...next, focusedPaneId: paneId };
}

function copySession(source: Session, fallback: Session | undefined): Session | null {
  if (!isSession(fallback)) return null;
  return { ...source, id: fallback.id, runtimeSessionId: fallback.runtimeSessionId };
}

function createPane(session: Session, runtimeSessionId: string): PaneState {
  return { sessionIds: [session.id], activeSessionId: session.id, runtimeSessionId };
}

function splitFocusedWith(
  state: WorkspaceState,
  session: Session,
  newPaneId: PaneId | undefined,
  runtimeSessionId: string | undefined,
): WorkspaceState | null {
  if (!validPaneRuntime(newPaneId, runtimeSessionId)) return null;
  if (!leafExists(state, state.focusedPaneId)) return null;
  const nextPanes = new Map(state.panesById);
  nextPanes.set(newPaneId!, createPane(session, runtimeSessionId!));
  return {
    ...state,
    sessions: setSessionInMap(state.sessions, session),
    panesById: nextPanes,
    layout: splitLeaf(state.layout, state.focusedPaneId, newPaneId!, "vertical", "b"),
    focusedPaneId: newPaneId!,
  };
}

export function setWorkspaceLayout(
  state: WorkspaceState,
  payload: { layout: WorkspaceLayout },
): WorkspaceState {
  try {
    return collectLeaves(payload.layout).length > 0 ? { ...state, layout: payload.layout } : state;
  } catch {
    return state;
  }
}

export function setWorkspaceSplitRatio(
  state: WorkspaceState,
  payload: { path: number[]; ratio: number },
): WorkspaceState {
  if (!Array.isArray(payload.path) || !Number.isFinite(payload.ratio)) return state;
  return { ...state, layout: setLayoutSplitRatio(state.layout, payload.path, payload.ratio) };
}

export function restorePaneState(
  state: WorkspaceState,
  payload: {
    layout: WorkspaceLayout;
    panesById: ReadonlyMap<PaneId, PaneState>;
    sessions: SessionsMap;
    focusedPaneId: PaneId;
  },
): WorkspaceState {
  if (!payload.panesById.has(payload.focusedPaneId)) return state;
  const leaves = collectLeaves(payload.layout);
  if (leaves.length === 0 || leaves.some((id) => !payload.panesById.has(id))) return state;
  return {
    ...state,
    layout: payload.layout,
    panesById: new Map(payload.panesById),
    sessions: new Map(payload.sessions),
    focusedPaneId: payload.focusedPaneId,
    hydrated: true,
  };
}

function findEmptyStarterInPane(
  state: WorkspaceState,
  pane: PaneState,
  project: Project | undefined,
): Session | null {
  for (const id of pane.sessionIds) {
    const session = state.sessions.get(id);
    if (!session || !isEmptyStarterSession(session)) continue;
    if (project?.id && session.projectId && session.projectId !== project.id) continue;
    if (project?.path && session.cwd && session.cwd !== project.path) continue;
    return session;
  }
  return null;
}

function isPaneBusy(state: WorkspaceState, pane: PaneState): boolean {
  const s = state.sessions.get(pane.activeSessionId)?.status;
  return s === "running" || s === "starting" || s === "loading";
}

export function openNewSessionInFocusedPane(
  state: WorkspaceState,
  payload: OpenNewSessionPayload,
): WorkspaceState {
  const pane = state.panesById.get(state.focusedPaneId);
  if (!pane) return state;
  // Reuse an existing empty starter tab (avoid piling up blanks).
  const existing = findEmptyStarterInPane(state, pane, payload.project);
  if (existing) {
    const sessions = payload.project
      ? patchSessionInMap(state.sessions, existing.id, {
          projectId: payload.project.id,
          cwd: payload.project.path,
        })
      : state.sessions;
    return setPane(withSessions(state, sessions), state.focusedPaneId, {
      ...pane,
      activeSessionId: existing.id,
    });
  }
  if (!isSession(payload.tab)) return state;
  const session: Session = {
    ...payload.tab,
    projectId: payload.project?.id,
    cwd: payload.project?.path,
  };
  // If the focused pane is busy, keep its stream alive: drop the new chat
  // into the sibling leaf (if one exists) or split right.
  if (isPaneBusy(state, pane)) {
    const leaves = collectLeaves(state.layout);
    if (leaves.length >= 2) {
      const target = leaves.find((id) => id !== state.focusedPaneId) ?? state.focusedPaneId;
      return addSessionToPane(state, target, session);
    }
    const split = splitFocusedWith(state, session, payload.paneId, payload.runtimeSessionId);
    if (split) return split;
    // Caller didn't pre-allocate split metadata — fall through to in-pane.
  }
  return setPane(
    withSessions(state, setSessionInMap(state.sessions, session)),
    state.focusedPaneId,
    { ...pane, sessionIds: [...pane.sessionIds, session.id], activeSessionId: session.id },
  );
}

export function replaySessionInFocusedPane(
  state: WorkspaceState,
  payload: ReplaySessionPayload,
): WorkspaceState {
  if (!payload.piSessionId) return state;
  const existing = findPaneByPiSessionId(state, payload.piSessionId);
  if (existing) return focusExistingSession(state, existing.paneId, existing.session.id);
  const pane = state.panesById.get(state.focusedPaneId);
  if (!pane) return state;
  const active = state.sessions.get(pane.activeSessionId) ?? null;
  const targetSession = active && isEmptyStarterSession(active) ? active : null;
  if (!targetSession && !isSession(payload.tab)) return state;

  if (targetSession) {
    const sessions = patchSessionInMap(state.sessions, targetSession.id, {
      // Adopt project info from the incoming tab if the starter has none yet
      // — replay carries the project context the workspace doesn't track.
      projectId: targetSession.projectId ?? payload.tab?.projectId,
      cwd: targetSession.cwd ?? payload.tab?.cwd,
      piSessionId: payload.piSessionId,
      title: replaySessionTitle(payload.sessionTitle, targetSession.title || "Loading session"),
    });
    return setPane(withSessions(state, sessions), state.focusedPaneId, {
      ...pane,
      activeSessionId: targetSession.id,
    });
  }

  const session: Session = {
    ...payload.tab!,
    piSessionId: payload.piSessionId,
    title: replaySessionTitle(payload.sessionTitle),
  };
  const sessions = setSessionInMap(state.sessions, session);
  return setPane(withSessions(state, sessions), state.focusedPaneId, {
    ...pane,
    sessionIds: [...pane.sessionIds, session.id],
    activeSessionId: session.id,
  });
}

export function replaySessionInSplitPane(
  state: WorkspaceState,
  payload: ReplaySessionInSplitPayload,
): WorkspaceState {
  if (!payload.piSessionId) return state;
  const existing = findPaneByPiSessionId(state, payload.piSessionId);
  if (existing) return focusExistingSession(state, existing.paneId, existing.session.id);
  if (!isSession(payload.tab)) return state;
  const session: Session = {
    ...payload.tab,
    piSessionId: payload.piSessionId,
    title: replaySessionTitle(payload.sessionTitle),
  };
  const leaves = collectLeaves(state.layout);
  if (leaves.length >= 2) {
    const target = leaves.find((id) => id !== state.focusedPaneId) ?? state.focusedPaneId;
    return addSessionToPane(state, target, session);
  }
  return splitFocusedWith(state, session, payload.paneId, payload.runtimeSessionId) ?? state;
}

export function openSessionPayloadInPane(
  state: WorkspaceState,
  payload: OpenSessionPayloadInPanePayload,
): WorkspaceState {
  if (!paneExists(state, payload.paneId)) return state;
  if (payload.payload.piSessionId) {
    const existing = findPaneByPiSessionId(state, payload.payload.piSessionId);
    if (existing) return focusExistingSession(state, existing.paneId, existing.session.id);
    if (!isSession(payload.tab)) return state;
    return addSessionToPane(state, payload.paneId, {
      ...payload.tab,
      projectId: payload.payload.projectId,
      cwd: payload.payload.cwd,
      piSessionId: payload.payload.piSessionId,
      title: payload.payload.title ?? "Loading session",
    });
  }
  if (payload.payload.paneId && payload.payload.tabId) {
    const sourceSession = state.sessions.get(payload.payload.tabId);
    if (!sourceSession) return state;
    const session = copySession(sourceSession, payload.tab);
    return session ? addSessionToPane(state, payload.paneId, session) : state;
  }
  return { ...state, focusedPaneId: payload.paneId };
}

export function splitPaneWithPayload(
  state: WorkspaceState,
  payload: SplitPaneWithPayloadPayload,
): WorkspaceState {
  if (!leafExists(state, payload.paneId)) return state;
  if (payload.payload.piSessionId) {
    const existing = findPaneByPiSessionId(state, payload.payload.piSessionId);
    if (existing) return focusExistingSession(state, existing.paneId, existing.session.id);
  }
  if (collectLeaves(state.layout).length >= 2) return state;
  if (!validPaneRuntime(payload.newPaneId, payload.runtimeSessionId)) return state;
  if (!isSession(payload.tab)) return state;
  const baseSession: Session = {
    ...payload.tab,
    projectId: payload.payload.projectId,
    cwd: payload.payload.cwd,
    piSessionId: payload.payload.piSessionId ?? null,
    title: payload.payload.title ?? "Loading session",
  };
  const sourceSession = payload.payload.tabId ? state.sessions.get(payload.payload.tabId) : null;
  const session =
    (!payload.payload.piSessionId && sourceSession
      ? copySession(sourceSession, baseSession)
      : null) ?? baseSession;
  const nextPanes = new Map(state.panesById);
  nextPanes.set(payload.newPaneId!, createPane(session, payload.runtimeSessionId!));
  return {
    ...state,
    sessions: setSessionInMap(state.sessions, session),
    panesById: nextPanes,
    layout: splitLeaf(
      state.layout,
      payload.paneId,
      payload.newPaneId!,
      payload.direction,
      payload.side,
    ),
    focusedPaneId: payload.newPaneId!,
  };
}

export function focusPane(state: WorkspaceState, payload: { paneId: PaneId }): WorkspaceState {
  return paneExists(state, payload.paneId) ? { ...state, focusedPaneId: payload.paneId } : state;
}

export function focusTab(
  state: WorkspaceState,
  payload: { paneId: PaneId; tabId: SessionId },
): WorkspaceState {
  return focusExistingSession(state, payload.paneId, payload.tabId);
}

export function renameTab(
  state: WorkspaceState,
  payload: { paneId: PaneId; tabId: SessionId; title: string },
): WorkspaceState {
  const pane = state.panesById.get(payload.paneId);
  if (!pane || !pane.sessionIds.includes(payload.tabId)) return state;
  const sessions = patchSessionInMap(state.sessions, payload.tabId, { title: payload.title });
  return withSessions(state, sessions);
}

export function splitTabIntoNewPane(
  state: WorkspaceState,
  payload: SplitTabPayload,
): WorkspaceState {
  const leaves = collectLeaves(state.layout);
  const sourcePane = state.panesById.get(payload.sourcePaneId);
  if (!sourcePane || !sourcePane.sessionIds.includes(payload.sourceTabId)) return state;
  const sourceSession = state.sessions.get(payload.sourceTabId);
  if (!sourceSession || !isSession(payload.tab)) return state;
  const session = copySession(sourceSession, payload.tab);
  if (!session) return state;
  if (leaves.length >= 2) {
    const targetPaneId =
      leaves.find((leafId) => leafId !== state.focusedPaneId) ?? state.focusedPaneId;
    return addSessionToPane(state, targetPaneId, session);
  }
  return splitFocusedWith(state, session, payload.newPaneId, payload.runtimeSessionId) ?? state;
}

export function closePane(state: WorkspaceState, payload: { paneId: PaneId }): WorkspaceState {
  const leaves = collectLeaves(state.layout);
  if (leaves.length <= 1 || !leaves.includes(payload.paneId)) return state;
  const nextPanes = new Map(state.panesById);
  nextPanes.delete(payload.paneId);
  const remaining = leaves.filter((id) => id !== payload.paneId);
  return pruneOrphanSessions({
    ...state,
    layout: removeLeaf(state.layout, payload.paneId) ?? state.layout,
    panesById: nextPanes,
    focusedPaneId:
      state.focusedPaneId === payload.paneId
        ? (remaining[0] ?? state.focusedPaneId)
        : state.focusedPaneId,
  });
}

/**
 * Replace the session list of a pane. The incoming list is the authoritative
 * snapshot of the pane's sessions — we write all of them into the flat map
 * (so messages/queue/etc updates land) and rebuild `pane.sessionIds`.
 */
export function setPaneTabs(
  state: WorkspaceState,
  payload: { paneId: PaneId; tabs: Session[] },
): WorkspaceState {
  const pane = state.panesById.get(payload.paneId);
  if (!pane || !Array.isArray(payload.tabs) || payload.tabs.length === 0) return state;
  const ids = payload.tabs.map((session) => session.id);
  return pruneOrphanSessions(
    setPane(withSessions(state, setSessionsInMap(state.sessions, payload.tabs)), payload.paneId, {
      ...pane,
      sessionIds: ids,
      activeSessionId: ids.includes(pane.activeSessionId) ? pane.activeSessionId : ids[0],
    }),
  );
}

export function patchActiveTab(
  state: WorkspaceState,
  payload: { paneId: PaneId; patch: Partial<Session> },
): WorkspaceState {
  const pane = state.panesById.get(payload.paneId);
  if (!pane || !pane.sessionIds.includes(pane.activeSessionId)) return state;
  const sessions = patchSessionInMap(state.sessions, pane.activeSessionId, payload.patch);
  return withSessions(state, sessions);
}

export function applyUrlNavigation(
  state: WorkspaceState,
  payload: UrlNavigationPayload,
): WorkspaceState {
  if (state.lastHandledNavKey === payload.key) return state;
  if (!payload.project && !payload.sessionId && !payload.newSession) return state;
  const marked: WorkspaceState = { ...state, lastHandledNavKey: payload.key };
  const { paneId, runtimeSessionId, tab, sessionTitle } = payload;
  const project = payload.project ?? undefined;
  if (payload.newSession && !payload.sessionId) {
    return openNewSessionInFocusedPane(marked, { project, tab, paneId, runtimeSessionId });
  }
  if (payload.sessionId && payload.split) {
    return replaySessionInSplitPane(marked, {
      piSessionId: payload.sessionId,
      sessionTitle,
      tab,
      paneId,
      runtimeSessionId,
    });
  }
  if (payload.sessionId) {
    return replaySessionInFocusedPane(marked, {
      piSessionId: payload.sessionId,
      sessionTitle,
      tab,
    });
  }
  return marked;
}
