import {
  collectLeaves,
  removeLeaf,
  setSplitRatio as setLayoutSplitRatio,
  splitLeaf,
} from "@/features/agent/workspace/layout";
import type { Session, SessionId, SessionsMap } from "@/features/agent/runtime/types";
import {
  isEmptyStarterSession,
  patchSession as patchSessionInMap,
  setSession as setSessionInMap,
  pruneSessions,
} from "@/features/agent/runtime/store";
import {
  findPaneByPiSessionId,
  paneSessionId,
  referencedSessionIds,
} from "@/features/agent/runtime/selectors";
import type { Project } from "@/features/agent/projects/types";
import type {
  PaneId,
  PaneState,
  TerminalPaneState,
  WorkspaceSessionPayload,
  WorkspaceState,
} from "@/features/agent/workspace/types";

function isSession(value: Session | undefined): value is Session {
  return Boolean(value && typeof value.id === "string" && value.id.length > 0);
}

function replaySessionTitle(sessionTitle?: string, fallback = "Loading session"): string {
  return sessionTitle?.trim() || fallback;
}

function validPaneId(paneId: PaneId | undefined): paneId is PaneId {
  return Boolean(paneId && typeof paneId === "string");
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

function pruneOrphanSessions(state: WorkspaceState): WorkspaceState {
  return withSessions(state, pruneSessions(state.sessions, referencedSessionIds(state)));
}

function focusExistingSession(
  state: WorkspaceState,
  paneId: PaneId,
  sessionId: SessionId,
): WorkspaceState {
  const pane = state.panesById.get(paneId);
  if (!pane || paneSessionId(pane) !== sessionId) return state;
  return { ...state, focusedPaneId: paneId };
}

function replacePaneSession(
  state: WorkspaceState,
  paneId: PaneId,
  session: Session,
): WorkspaceState {
  const pane = state.panesById.get(paneId);
  if (!pane || !isSession(session)) return state;
  const sessions = setSessionInMap(state.sessions, session);
  const next = pruneOrphanSessions(
    setPane(withSessions(state, sessions), paneId, { sessionId: session.id }),
  );
  return { ...next, focusedPaneId: paneId };
}

function copySessionWithFreshRuntimeId(
  source: Session,
  fallback: Session | undefined,
): Session | null {
  if (!isSession(fallback)) return null;
  return { ...source, id: fallback.id };
}

function splitPaneWithSession(
  state: WorkspaceState,
  payload: {
    sourcePaneId: PaneId;
    session: Session;
    newPaneId: PaneId | undefined;
    direction?: "vertical" | "horizontal";
    side?: "a" | "b";
  },
): WorkspaceState | null {
  const { sourcePaneId, session, newPaneId, direction = "vertical", side = "b" } = payload;
  if (!validPaneId(newPaneId)) return null;
  if (!leafExists(state, sourcePaneId)) return null;
  const nextPanes = new Map(state.panesById);
  nextPanes.set(newPaneId, { sessionId: session.id });
  return {
    ...state,
    sessions: setSessionInMap(state.sessions, session),
    panesById: nextPanes,
    layout: splitLeaf(state.layout, sourcePaneId, newPaneId, direction, side),
    focusedPaneId: newPaneId,
  };
}

function siblingPaneId(state: WorkspaceState, sourcePaneId: PaneId): PaneId | null {
  const leaves = collectLeaves(state.layout);
  return leaves.find((id) => id !== sourcePaneId) ?? null;
}

function openSessionAdjacentToFocusedPane(
  state: WorkspaceState,
  session: Session,
  newPaneId: PaneId | undefined,
): WorkspaceState {
  const target = siblingPaneId(state, state.focusedPaneId);
  if (target) return replacePaneSession(state, target, session);
  return (
    splitPaneWithSession(state, {
      sourcePaneId: state.focusedPaneId,
      session,
      newPaneId,
    }) ?? state
  );
}

export function setWorkspaceSplitRatio(
  state: WorkspaceState,
  payload: { path: number[]; ratio: number },
): WorkspaceState {
  if (!Array.isArray(payload.path) || !Number.isFinite(payload.ratio)) return state;
  return { ...state, layout: setLayoutSplitRatio(state.layout, payload.path, payload.ratio) };
}

function chatTargetPaneId(state: WorkspaceState): PaneId {
  if (paneSessionId(state.panesById.get(state.focusedPaneId))) return state.focusedPaneId;
  for (const paneId of collectLeaves(state.layout)) {
    if (paneSessionId(state.panesById.get(paneId))) return paneId;
  }
  return state.focusedPaneId;
}

function openNewSessionInFocusedPane(
  state: WorkspaceState,
  payload: OpenNewSessionPayload,
): WorkspaceState {
  const targetPaneId = chatTargetPaneId(state);
  const pane = state.panesById.get(targetPaneId);
  if (!pane) return state;
  if (!isSession(payload.tab)) return state;
  const session: Session = {
    ...payload.tab,
    projectId: payload.project?.id,
    cwd: payload.project?.path,
    modelId: payload.tab.modelId || state.selectedModel || undefined,
  };
  return replacePaneSession(state, targetPaneId, session);
}

function replaySessionInFocusedPane(
  state: WorkspaceState,
  payload: ReplaySessionPayload,
): WorkspaceState {
  if (!payload.piSessionId) return state;
  const existing = findPaneByPiSessionId(state, payload.piSessionId);
  if (existing) return focusExistingSession(state, existing.paneId, existing.session.id);
  const targetPaneId = chatTargetPaneId(state);
  const pane = state.panesById.get(targetPaneId);
  if (!pane) return state;
  const activeId = paneSessionId(pane);
  const active = activeId ? (state.sessions.get(activeId) ?? null) : null;
  const targetSession = active && isEmptyStarterSession(active) ? active : null;
  if (!targetSession && !isSession(payload.tab)) return state;

  if (targetSession) {
    const sessions = patchSessionInMap(state.sessions, targetSession.id, {
      projectId: targetSession.projectId ?? payload.tab?.projectId,
      cwd: targetSession.cwd ?? payload.tab?.cwd,
      modelId: targetSession.modelId ?? payload.tab?.modelId,
      piSessionId: payload.piSessionId,
      title: replaySessionTitle(payload.sessionTitle, targetSession.title || "Loading session"),
      startedAt: targetSession.startedAt ?? payload.tab?.startedAt,
    });
    return setPane(withSessions(state, sessions), targetPaneId, {
      sessionId: targetSession.id,
    });
  }

  const session: Session = {
    ...payload.tab!,
    piSessionId: payload.piSessionId,
    title: replaySessionTitle(payload.sessionTitle),
  };
  return replacePaneSession(state, targetPaneId, session);
}

function replaySessionInSplitPane(
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
  return openSessionAdjacentToFocusedPane(state, session, payload.paneId);
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
    return replacePaneSession(state, payload.paneId, {
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
    const session = copySessionWithFreshRuntimeId(sourceSession, payload.tab);
    return session ? replacePaneSession(state, payload.paneId, session) : state;
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
  if (!validPaneId(payload.newPaneId)) return state;
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
      ? copySessionWithFreshRuntimeId(sourceSession, baseSession)
      : null) ?? baseSession;
  return (
    splitPaneWithSession(state, {
      sourcePaneId: payload.paneId,
      session,
      newPaneId: payload.newPaneId,
      direction: payload.direction,
      side: payload.side,
    }) ?? state
  );
}

export function focusPane(state: WorkspaceState, payload: { paneId: PaneId }): WorkspaceState {
  return paneExists(state, payload.paneId) ? { ...state, focusedPaneId: payload.paneId } : state;
}

export function focusPaneSession(
  state: WorkspaceState,
  payload: { paneId: PaneId; sessionId: SessionId },
): WorkspaceState {
  return focusExistingSession(state, payload.paneId, payload.sessionId);
}

export function renameTab(
  state: WorkspaceState,
  payload: { paneId: PaneId; tabId: SessionId; title: string },
): WorkspaceState {
  const pane = state.panesById.get(payload.paneId);
  if (!pane || paneSessionId(pane) !== payload.tabId) return state;
  const sessions = patchSessionInMap(state.sessions, payload.tabId, { title: payload.title });
  return withSessions(state, sessions);
}

export function splitTabIntoNewPane(
  state: WorkspaceState,
  payload: SplitTabPayload,
): WorkspaceState {
  const leaves = collectLeaves(state.layout);
  const sourcePane = state.panesById.get(payload.sourcePaneId);
  if (!sourcePane || paneSessionId(sourcePane) !== payload.sourceTabId) return state;
  const sourceSession = state.sessions.get(payload.sourceTabId);
  if (!sourceSession || !isSession(payload.tab)) return state;
  const session = copySessionWithFreshRuntimeId(sourceSession, payload.tab);
  if (!session) return state;
  const targetPaneId = leaves.length >= 2 ? siblingPaneId(state, state.focusedPaneId) : null;
  if (targetPaneId) return replacePaneSession(state, targetPaneId, session);
  return (
    splitPaneWithSession(state, {
      sourcePaneId: state.focusedPaneId,
      session,
      newPaneId: payload.newPaneId,
    }) ?? state
  );
}

function restoredTerminalOwnerPane(state: WorkspaceState, paneId: PaneId): WorkspaceState | null {
  const pane = state.panesById.get(paneId);
  if (pane?.kind !== "terminal" || !pane.ownerSessionId) return null;
  if (!state.sessions.has(pane.ownerSessionId)) return null;
  return {
    ...setPane(state, paneId, { sessionId: pane.ownerSessionId }),
    focusedPaneId: paneId,
  };
}

export function canRestoreTerminalOwner(state: WorkspaceState, paneId: PaneId): boolean {
  const pane = state.panesById.get(paneId);
  return (
    pane?.kind === "terminal" &&
    Boolean(pane.ownerSessionId && state.sessions.has(pane.ownerSessionId))
  );
}

export function closePane(state: WorkspaceState, payload: { paneId: PaneId }): WorkspaceState {
  const leaves = collectLeaves(state.layout);
  if (!leaves.includes(payload.paneId)) return state;
  if (leaves.length <= 1) return restoredTerminalOwnerPane(state, payload.paneId) ?? state;
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

export function openTerminalPane(
  state: WorkspaceState,
  payload: { sourcePaneId: PaneId },
): WorkspaceState {
  if (!leafExists(state, payload.sourcePaneId)) return state;
  const source = state.panesById.get(payload.sourcePaneId);
  if (source?.kind === "terminal") return { ...state, focusedPaneId: payload.sourcePaneId };
  const sourceSessionId = paneSessionId(source);
  const session = sourceSessionId ? state.sessions.get(sourceSessionId) : undefined;
  const pane: TerminalPaneState = {
    kind: "terminal",
    mountKey: session ? `pane-session:${session.id}` : `pane:${payload.sourcePaneId}`,
    cwd: session?.cwd ?? null,
    title: "Terminal",
    ownerSessionId: session?.id ?? null,
    ownerPiSessionId: session?.piSessionId ?? null,
  };
  return { ...setPane(state, payload.sourcePaneId, pane), focusedPaneId: payload.sourcePaneId };
}

export function setPaneSession(
  state: WorkspaceState,
  payload: { paneId: PaneId; session: Session },
): WorkspaceState {
  return replacePaneSession(state, payload.paneId, payload.session);
}

export function patchActiveTab(
  state: WorkspaceState,
  payload: { paneId: PaneId; patch: Partial<Session> },
): WorkspaceState {
  const sessionId = paneSessionId(state.panesById.get(payload.paneId));
  if (!sessionId) return state;
  const sessions = patchSessionInMap(state.sessions, sessionId, payload.patch);
  return withSessions(state, sessions);
}

export function applyUrlNavigation(
  state: WorkspaceState,
  payload: UrlNavigationPayload,
): WorkspaceState {
  if (state.lastHandledNavKey === payload.key) return state;
  if (!payload.project && !payload.sessionId && !payload.newSession) return state;
  const marked: WorkspaceState = { ...state, lastHandledNavKey: payload.key };
  const { paneId, tab, sessionTitle } = payload;
  const project = payload.project ?? undefined;
  if (payload.newSession && !payload.sessionId) {
    return openNewSessionInFocusedPane(marked, { project, tab });
  }
  if (payload.sessionId && payload.split) {
    return replaySessionInSplitPane(marked, {
      piSessionId: payload.sessionId,
      sessionTitle,
      tab,
      paneId,
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

type SessionPayload = { tab?: Session };

type OpenNewSessionPayload = SessionPayload & { project?: Project };
type ReplaySessionPayload = SessionPayload & { piSessionId: string; sessionTitle?: string };
type ReplaySessionInSplitPayload = ReplaySessionPayload & { paneId?: PaneId };
type OpenSessionPayloadInPanePayload = SessionPayload & {
  paneId: PaneId;
  payload: WorkspaceSessionPayload;
};
type SplitPaneWithPayloadPayload = SessionPayload & {
  paneId: PaneId;
  newPaneId?: PaneId;
  direction: "vertical" | "horizontal";
  side: "a" | "b";
  payload: WorkspaceSessionPayload;
};
type SplitTabPayload = SessionPayload & {
  sourcePaneId: PaneId;
  sourceTabId: SessionId;
  newPaneId?: PaneId;
};
type UrlNavigationPayload = SessionPayload & {
  key: string;
  project: Project | null;
  sessionId?: string | null;
  sessionTitle?: string;
  newSession?: boolean;
  split?: boolean;
  paneId?: PaneId;
};
