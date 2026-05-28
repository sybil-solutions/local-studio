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
  pruneSessions,
} from "@/lib/agent/sessions/store";
import { findPaneByPiSessionId, referencedSessionIds } from "@/lib/agent/sessions/selectors";
import type { PaneId, PaneState, WorkspaceLayout, WorkspaceState } from "./types";
import type {
  OpenNewSessionPayload,
  OpenSessionPayloadInPanePayload,
  ReplaySessionInSplitPayload,
  ReplaySessionPayload,
  SplitPaneWithPayloadPayload,
  SplitTabPayload,
  UrlNavigationPayload,
} from "./pane-controller-types";

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

function paneWithSession(pane: PaneState, session: Session): PaneState {
  return { ...pane, sessionId: session.id, runtimeSessionId: session.runtimeSessionId };
}

function withSessions(state: WorkspaceState, sessions: SessionsMap): WorkspaceState {
  return state.sessions === sessions ? state : { ...state, sessions };
}

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
  if (!pane || pane.sessionId !== sessionId) return state;
  return {
    ...setPane(state, paneId, { ...pane, sessionId }),
    focusedPaneId: paneId,
  };
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
    setPane(withSessions(state, sessions), paneId, paneWithSession(pane, session)),
  );
  return { ...next, focusedPaneId: paneId };
}

function copySession(source: Session, fallback: Session | undefined): Session | null {
  if (!isSession(fallback)) return null;
  return { ...source, id: fallback.id, runtimeSessionId: fallback.runtimeSessionId };
}

function createPane(session: Session, runtimeSessionId: string): PaneState {
  return { sessionId: session.id, runtimeSessionId: session.runtimeSessionId || runtimeSessionId };
}

function splitPaneWithSession(
  state: WorkspaceState,
  payload: {
    sourcePaneId: PaneId;
    session: Session;
    newPaneId: PaneId | undefined;
    runtimeSessionId: string | undefined;
    direction?: "vertical" | "horizontal";
    side?: "a" | "b";
  },
): WorkspaceState | null {
  const {
    sourcePaneId,
    session,
    newPaneId,
    runtimeSessionId,
    direction = "vertical",
    side = "b",
  } = payload;
  if (!validPaneRuntime(newPaneId, runtimeSessionId)) return null;
  if (!leafExists(state, sourcePaneId)) return null;
  const nextPanes = new Map(state.panesById);
  nextPanes.set(newPaneId!, createPane(session, runtimeSessionId!));
  return {
    ...state,
    sessions: setSessionInMap(state.sessions, session),
    panesById: nextPanes,
    layout: splitLeaf(state.layout, sourcePaneId, newPaneId!, direction, side),
    focusedPaneId: newPaneId!,
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
  runtimeSessionId: string | undefined,
): WorkspaceState {
  const target = siblingPaneId(state, state.focusedPaneId);
  if (target) return replacePaneSession(state, target, session);
  return (
    splitPaneWithSession(state, {
      sourcePaneId: state.focusedPaneId,
      session,
      newPaneId,
      runtimeSessionId,
    }) ?? state
  );
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
  const panesById = new Map<PaneId, PaneState>();
  for (const paneId of leaves) {
    const pane = payload.panesById.get(paneId);
    if (!pane) return state;
    if (!pane.sessionId || !payload.sessions.has(pane.sessionId)) return state;
    panesById.set(paneId, pane);
  }
  return pruneOrphanSessions({
    ...state,
    layout: payload.layout,
    panesById,
    sessions: new Map(payload.sessions),
    focusedPaneId: payload.focusedPaneId,
    hydrated: true,
  });
}

function findEmptyStarterInPane(
  state: WorkspaceState,
  pane: PaneState,
  project: Project | undefined,
): Session | null {
  const session = state.sessions.get(pane.sessionId);
  if (!session || !isEmptyStarterSession(session)) return null;
  if (project?.id && session.projectId && session.projectId !== project.id) return null;
  if (project?.path && session.cwd && session.cwd !== project.path) return null;
  return session;
}

export function openNewSessionInFocusedPane(
  state: WorkspaceState,
  payload: OpenNewSessionPayload,
): WorkspaceState {
  const pane = state.panesById.get(state.focusedPaneId);
  if (!pane) return state;
  // Reuse an existing empty starter tab (avoid piling up blanks). The user's
  // mode choice doesn't matter here — there's nothing to displace. Reset the
  // starter's title/error/status so a stale carryover (e.g. a title persisted
  // by restorePaneState from before the user cleared its messages) can't bleed
  // into the freshly opened session's header.
  const existing = findEmptyStarterInPane(state, pane, payload.project);
  if (existing) {
    const freshTitle = isSession(payload.tab) ? payload.tab.title : "New session";
    const starterPatch: Partial<Session> = {
      title: freshTitle,
      piSessionId: null,
      messages: [],
      input: "",
      error: "",
      status: "idle",
      startedAt: undefined,
      tokenStats: undefined,
      usedSkills: undefined,
      contextUsage: null,
      activeAssistantId: undefined,
      lastEventSeq: undefined,
      queue: undefined,
      modelId: existing.modelId || state.selectedModel || undefined,
      ...(payload.project ? { projectId: payload.project.id, cwd: payload.project.path } : {}),
    };
    const sessions = patchSessionInMap(state.sessions, existing.id, starterPatch);
    return setPane(withSessions(state, sessions), state.focusedPaneId, {
      ...pane,
      sessionId: existing.id,
    });
  }
  if (!isSession(payload.tab)) return state;
  const session: Session = {
    ...payload.tab,
    projectId: payload.project?.id,
    cwd: payload.project?.path,
    modelId: payload.tab.modelId || state.selectedModel || undefined,
  };
  if (payload.mode === "split") {
    return openSessionAdjacentToFocusedPane(
      state,
      session,
      payload.paneId,
      payload.runtimeSessionId,
    );
  }
  if (payload.mode === "replace") {
    return replacePaneSession(state, state.focusedPaneId, session);
  }
  return replacePaneSession(state, state.focusedPaneId, session);
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
  const active = state.sessions.get(pane.sessionId) ?? null;
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
      sessionId: targetSession.id,
    });
  }

  const session: Session = {
    ...payload.tab!,
    piSessionId: payload.piSessionId,
    title: replaySessionTitle(payload.sessionTitle),
  };
  return replacePaneSession(state, state.focusedPaneId, session);
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
  return openSessionAdjacentToFocusedPane(state, session, payload.paneId, payload.runtimeSessionId);
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
    const session = copySession(sourceSession, payload.tab);
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
  return (
    splitPaneWithSession(state, {
      sourcePaneId: payload.paneId,
      session,
      newPaneId: payload.newPaneId,
      runtimeSessionId: payload.runtimeSessionId,
      direction: payload.direction,
      side: payload.side,
    }) ?? state
  );
}

export function focusPane(state: WorkspaceState, payload: { paneId: PaneId }): WorkspaceState {
  return paneExists(state, payload.paneId) ? { ...state, focusedPaneId: payload.paneId } : state;
}

export function renameTab(
  state: WorkspaceState,
  payload: { paneId: PaneId; tabId: SessionId; title: string },
): WorkspaceState {
  const pane = state.panesById.get(payload.paneId);
  if (!pane || pane.sessionId !== payload.tabId) return state;
  const sessions = patchSessionInMap(state.sessions, payload.tabId, { title: payload.title });
  return withSessions(state, sessions);
}

export function splitTabIntoNewPane(
  state: WorkspaceState,
  payload: SplitTabPayload,
): WorkspaceState {
  const leaves = collectLeaves(state.layout);
  const sourcePane = state.panesById.get(payload.sourcePaneId);
  if (!sourcePane || sourcePane.sessionId !== payload.sourceTabId) return state;
  const sourceSession = state.sessions.get(payload.sourceTabId);
  if (!sourceSession || !isSession(payload.tab)) return state;
  const session = copySession(sourceSession, payload.tab);
  if (!session) return state;
  const targetPaneId = leaves.length >= 2 ? siblingPaneId(state, state.focusedPaneId) : null;
  if (targetPaneId) return replacePaneSession(state, targetPaneId, session);
  return (
    splitPaneWithSession(state, {
      sourcePaneId: state.focusedPaneId,
      session,
      newPaneId: payload.newPaneId,
      runtimeSessionId: payload.runtimeSessionId,
    }) ?? state
  );
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
  const pane = state.panesById.get(payload.paneId);
  if (!pane) return state;
  const sessions = patchSessionInMap(state.sessions, pane.sessionId, payload.patch);
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
    // URL-driven `new=1` shares the dropdown's default "New session" intent:
    // always replace the focused pane. The legacy "split when busy" heuristic
    // made the same URL produce different results depending on what the
    // focused pane currently held, which is the source of the "sometimes
    // opens, sometimes doesn't" complaint about new chats.
    return openNewSessionInFocusedPane(marked, {
      project,
      tab,
      paneId,
      runtimeSessionId,
      mode: "replace",
    });
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
