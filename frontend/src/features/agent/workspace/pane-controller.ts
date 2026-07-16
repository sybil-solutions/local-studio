import {
  collectLeaves,
  removeLeaf,
  setSplitRatio as setLayoutSplitRatio,
  splitLeafWithinLimits,
} from "@/features/agent/workspace/layout";
import type { Session, SessionId, SessionsMap } from "@/features/agent/runtime/types";
import {
  isEmptyStarterSession,
  patchSession as patchSessionInMap,
  setSession as setSessionInMap,
  pruneSessions,
} from "@/features/agent/runtime/store";
import {
  findWorkspaceSessionByPiSessionId,
  paneSessionId,
  referencedSessionIds,
} from "@/features/agent/runtime/selectors";
import type { Project } from "@/features/agent/projects/types";
import type {
  PaneId,
  PaneState,
  WorkspaceSessionPayload,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import { restoreSessionDraft } from "@/features/agent/workspace/session-drafts";

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

export function claimCanonicalSession(state: WorkspaceState, canonical: Session): WorkspaceState {
  if (!canonical.piSessionId) return state;
  const duplicateIds = new Set(
    [...state.sessions]
      .filter(
        ([id, session]) => id !== canonical.id && session.piSessionId === canonical.piSessionId,
      )
      .map(([id]) => id),
  );
  if (duplicateIds.size === 0) return state;
  const sessions = new Map(state.sessions);
  for (const id of duplicateIds) sessions.delete(id);
  const panesById = new Map(state.panesById);
  for (const [paneId, pane] of panesById) {
    if (duplicateIds.has(pane.sessionId)) panesById.set(paneId, { sessionId: canonical.id });
  }
  return { ...state, sessions, panesById };
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
  const restored = restoreSessionDraft(session, state.sessionDrafts);
  const sessions = setSessionInMap(state.sessions, restored);
  const next = pruneOrphanSessions(
    setPane(withSessions(state, sessions), paneId, { sessionId: restored.id }),
  );
  return claimCanonicalSession({ ...next, focusedPaneId: paneId }, restored);
}

function focusSessionAsOnlyPane(
  state: WorkspaceState,
  paneId: PaneId,
  sessionId: SessionId,
): WorkspaceState {
  const pane = state.panesById.get(paneId);
  if (!pane || paneSessionId(pane) !== sessionId) return state;
  const next = pruneOrphanSessions({
    ...state,
    layout: { kind: "leaf", paneId },
    panesById: new Map([[paneId, pane]]),
    focusedPaneId: paneId,
  });
  const session = next.sessions.get(sessionId);
  return session ? claimCanonicalSession(next, session) : next;
}

function replaceWorkspaceSession(
  state: WorkspaceState,
  paneId: PaneId | undefined,
  session: Session | undefined,
): WorkspaceState {
  if (!validPaneId(paneId) || !isSession(session)) return state;
  const restored = restoreSessionDraft(session, state.sessionDrafts);
  const next = pruneOrphanSessions({
    ...withSessions(state, setSessionInMap(state.sessions, restored)),
    layout: { kind: "leaf", paneId },
    panesById: new Map([[paneId, { sessionId: restored.id }]]),
    focusedPaneId: paneId,
  });
  return claimCanonicalSession(next, restored);
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
  const restored = restoreSessionDraft(session, state.sessionDrafts);
  const layout = splitLeafWithinLimits(state.layout, sourcePaneId, newPaneId, direction, side);
  if (!layout) return null;
  const nextPanes = new Map(state.panesById);
  nextPanes.set(newPaneId, { sessionId: restored.id });
  return {
    ...state,
    sessions: setSessionInMap(state.sessions, restored),
    panesById: nextPanes,
    layout,
    focusedPaneId: newPaneId,
  };
}

function siblingPaneId(state: WorkspaceState, sourcePaneId: PaneId): PaneId | null {
  return collectLeaves(state.layout).find((id) => id !== sourcePaneId) ?? null;
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

function openNewSessionInFocusedPane(
  state: WorkspaceState,
  payload: OpenNewSessionPayload,
): WorkspaceState {
  const targetPaneId = state.focusedPaneId;
  const pane = state.panesById.get(targetPaneId);
  if (!pane) return state;
  if (!isSession(payload.tab)) return state;
  const session: Session = {
    ...payload.tab,
    projectId: payload.project?.id,
    cwd: payload.project?.path,
    modelId: payload.tab.modelId || state.selectedModel || undefined,
  };
  if (payload.replaceWorkspace) {
    return replaceWorkspaceSession(state, targetPaneId, session);
  }
  const activeId = paneSessionId(pane);
  const active = activeId ? state.sessions.get(activeId) : undefined;
  const focusedIsEmptyStarter = Boolean(active) && isEmptyStarterSession(active!);
  if (focusedIsEmptyStarter || collectLeaves(state.layout).length >= 2) {
    return replacePaneSession(state, targetPaneId, session);
  }
  return (
    splitPaneWithSession(state, {
      sourcePaneId: targetPaneId,
      session,
      newPaneId: payload.newPaneId,
    }) ?? replacePaneSession(state, targetPaneId, session)
  );
}

function replaySessionInFocusedPane(
  state: WorkspaceState,
  payload: ReplaySessionPayload,
): WorkspaceState {
  if (!payload.piSessionId) return state;
  const existing = findWorkspaceSessionByPiSessionId(state, payload.piSessionId);
  if (existing) {
    if (existing.paneId) {
      return payload.replaceWorkspace
        ? focusSessionAsOnlyPane(state, existing.paneId, existing.session.id)
        : focusExistingSession(state, existing.paneId, existing.session.id);
    }
    return payload.replaceWorkspace
      ? replaceWorkspaceSession(state, state.focusedPaneId, existing.session)
      : replacePaneSession(state, state.focusedPaneId, existing.session);
  }
  const targetPaneId = state.focusedPaneId;
  if (payload.replaceWorkspace) {
    if (!isSession(payload.tab)) return state;
    return replaceWorkspaceSession(state, targetPaneId, {
      ...payload.tab,
      piSessionId: payload.piSessionId,
      title: replaySessionTitle(payload.sessionTitle),
    });
  }
  const pane = state.panesById.get(targetPaneId);
  if (!pane) return state;
  const activeId = paneSessionId(pane);
  const active = activeId ? (state.sessions.get(activeId) ?? null) : null;
  const targetSession = active && isEmptyStarterSession(active) ? active : null;
  if (targetSession) {
    return adoptReplaySession(state, targetPaneId, targetSession, payload);
  }
  if (!isSession(payload.tab)) return state;
  const session: Session = {
    ...payload.tab,
    piSessionId: payload.piSessionId,
    title: replaySessionTitle(payload.sessionTitle),
  };
  return replacePaneSession(state, targetPaneId, session);
}

function adoptReplaySession(
  state: WorkspaceState,
  paneId: PaneId,
  target: Session,
  payload: ReplaySessionPayload,
): WorkspaceState {
  const input = state.sessionDrafts.get(payload.piSessionId) ?? target.input;
  const sessions = patchSessionInMap(state.sessions, target.id, {
    projectId: target.projectId ?? payload.tab?.projectId,
    cwd: target.cwd ?? payload.tab?.cwd,
    modelId: target.modelId ?? payload.tab?.modelId,
    piSessionId: payload.piSessionId,
    title: replaySessionTitle(payload.sessionTitle, target.title || "Loading session"),
    startedAt: target.startedAt ?? payload.tab?.startedAt,
    input,
  });
  return setPane(withSessions(state, sessions), paneId, { sessionId: target.id });
}

function replaySessionInSplitPane(
  state: WorkspaceState,
  payload: ReplaySessionInSplitPayload,
): WorkspaceState {
  if (!payload.piSessionId) return state;
  const existing = findWorkspaceSessionByPiSessionId(state, payload.piSessionId);
  if (existing?.paneId) return focusExistingSession(state, existing.paneId, existing.session.id);
  if (existing) return openSessionAdjacentToFocusedPane(state, existing.session, payload.paneId);
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
    const existing = findWorkspaceSessionByPiSessionId(state, payload.payload.piSessionId);
    if (existing?.paneId) return focusExistingSession(state, existing.paneId, existing.session.id);
    if (existing) return replacePaneSession(state, payload.paneId, existing.session);
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
    const existing = findWorkspaceSessionByPiSessionId(state, payload.payload.piSessionId);
    if (existing?.paneId) return focusExistingSession(state, existing.paneId, existing.session.id);
    if (existing) {
      return (
        splitPaneWithSession(state, {
          sourcePaneId: payload.paneId,
          session: existing.session,
          newPaneId: payload.newPaneId,
          direction: payload.direction,
          side: payload.side,
        }) ?? state
      );
    }
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
  payload: { paneId: PaneId; sessionId: SessionId; replaceWorkspace?: boolean },
): WorkspaceState {
  return payload.replaceWorkspace
    ? focusSessionAsOnlyPane(state, payload.paneId, payload.sessionId)
    : focusExistingSession(state, payload.paneId, payload.sessionId);
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

export function closePane(state: WorkspaceState, payload: { paneId: PaneId }): WorkspaceState {
  const leaves = collectLeaves(state.layout);
  if (!leaves.includes(payload.paneId)) return state;
  if (leaves.length <= 1) return state;
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
  if (supersededNavigationIntent(payload.intent, state.lastHandledNavIntent)) return state;
  if (!payload.project && !payload.sessionId && !payload.newSession) {
    return state;
  }
  const marked: WorkspaceState = {
    ...state,
    lastHandledNavKey: payload.key,
    lastHandledNavIntent: payload.intent ?? state.lastHandledNavIntent,
  };
  const { paneId, tab, sessionTitle } = payload;
  const project = payload.project ?? undefined;
  if (payload.newSession && !payload.sessionId) {
    return openNewSessionInFocusedPane(marked, {
      project,
      tab,
      newPaneId: payload.paneId,
      replaceWorkspace: payload.replaceWorkspace,
    });
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
      newPaneId: paneId,
      replaceWorkspace: payload.replaceWorkspace,
    });
  }
  return marked;
}

type SessionPayload = { tab?: Session };

type OpenNewSessionPayload = SessionPayload & {
  project?: Project;
  newPaneId?: PaneId;
  replaceWorkspace?: boolean;
};
type ReplaySessionPayload = SessionPayload & {
  piSessionId: string;
  sessionTitle?: string;
  newPaneId?: PaneId;
  replaceWorkspace?: boolean;
};
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
  intent?: string;
  project: Project | null;
  sessionId?: string | null;
  sessionTitle?: string;
  newSession?: boolean;
  split?: boolean;
  paneId?: PaneId;
  replaceWorkspace?: boolean;
};

function navigationIntentParts(intent: string): [number, number] | null {
  const [timestampRaw, sequenceRaw = "0"] = intent.split(".", 2);
  const timestamp = Number.parseInt(timestampRaw, 36);
  const sequence = Number.parseInt(sequenceRaw, 36);
  return Number.isFinite(timestamp) && Number.isFinite(sequence) ? [timestamp, sequence] : null;
}

export function supersededNavigationIntent(incoming: string | undefined, current: string): boolean {
  if (!incoming || !current) return false;
  const incomingParts = navigationIntentParts(incoming);
  const currentParts = navigationIntentParts(current);
  if (!incomingParts || !currentParts) return incoming === current;
  if (incomingParts[0] !== currentParts[0]) return incomingParts[0] < currentParts[0];
  return incomingParts[1] <= currentParts[1];
}
