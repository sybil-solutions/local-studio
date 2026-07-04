import type { ActiveAgentSessionSnapshot } from "@/features/agent/active-sessions";
import { makeFreshTab } from "@/features/agent/messages/helpers";
import { patchSession as patchSessionInMap } from "@/features/agent/runtime/store";
import type { Project } from "@/features/agent/projects/types";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import type {
  AgentModel,
  PaneId,
  PaneState,
  WorkspaceAction,
  WorkspaceLayout,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import {
  applyUrlNavigation,
  closePane,
  focusPane,
  focusPaneSession,
  openSessionPayloadInPane,
  openTerminalPane,
  patchActiveTab,
  setPaneSession,
  setWorkspaceSplitRatio,
  splitPaneWithPayload,
  splitTabIntoNewPane,
  renameTab,
} from "@/features/agent/workspace/pane-controller";

function layoutFromPaneIds(paneIds: PaneId[]): WorkspaceLayout {
  if (paneIds.length <= 1) return { kind: "leaf", paneId: paneIds[0] ?? "p-init" };
  const [first, ...rest] = paneIds;
  return {
    kind: "split",
    direction: "vertical",
    ratio: 0.5,
    a: { kind: "leaf", paneId: first },
    b: layoutFromPaneIds(rest),
  };
}

function tabFromSnapshot(session: ActiveAgentSessionSnapshot): Session {
  const fresh = makeFreshTab();
  return {
    ...fresh,
    id: session.tabId || fresh.id,
    piSessionId: session.piSessionId,
    projectId: session.projectId,
    cwd: session.cwd,
    modelId: session.modelId,
    title: session.title || "Loading session",
    status: "loading",
    startedAt: session.startedAt ?? session.updatedAt,
    usedSkills: session.usedSkills,
  };
}

function chooseModelId(
  models: AgentModel[],
  currentModelId: string,
  preferredModelId?: string,
): string {
  if (preferredModelId && models.some((model) => model.id === preferredModelId)) {
    return preferredModelId;
  }
  if (currentModelId && models.some((model) => model.id === currentModelId)) {
    return currentModelId;
  }
  return models.find((model) => model.active)?.id || models[0]?.id || "";
}

function hydrateSessionSnapshots(
  state: WorkspaceState,
  snapshots: ActiveAgentSessionSnapshot[],
  projects: Project[],
): WorkspaceState {
  const paneStateAlreadyRestored = [...state.sessions.values()].some(
    (session) => Boolean(session.piSessionId) || session.messages.length > 0,
  );
  if (paneStateAlreadyRestored) return { ...state, hydrated: true };

  const restorable = snapshots.filter(
    (session) =>
      (!session.projectId && Boolean(session.cwd)) ||
      projects.some((project) => project.id === session.projectId || project.path === session.cwd),
  );
  if (restorable.length === 0) return { ...state, hydrated: true };

  const grouped = new Map<PaneId, ActiveAgentSessionSnapshot[]>();
  for (const session of restorable) {
    const current = grouped.get(session.paneId) ?? [];
    current.push(session);
    grouped.set(session.paneId, current);
  }

  const paneIds = [...grouped.keys()];
  const panesById = new Map<PaneId, PaneState>();
  const sessions = new Map<SessionId, Session>();
  for (const paneId of paneIds) {
    const group = grouped.get(paneId) ?? [];
    const restored = group.map(tabFromSnapshot);
    const focusedSessionId = group.find((session) => session.focused)?.tabId || restored[0]?.id;
    const session =
      restored.find((tab) => tab.id === focusedSessionId) ?? restored[0] ?? makeFreshTab();
    sessions.set(session.id, session);
    panesById.set(paneId, { sessionId: session.id });
  }

  const focusedSnapshot = restorable.find((session) => session.focused) ?? restorable[0];

  return {
    ...state,
    sessions,
    panesById,
    layout: layoutFromPaneIds(paneIds),
    focusedPaneId: focusedSnapshot.paneId,
    hydrated: true,
  };
}

function reduceWorkspaceStatus(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState | null {
  switch (action.type) {
    case "hydrate": {
      const next = { ...state, ...action.state };
      return { ...next, hydrated: action.hydrated ?? next.hydrated };
    }
    case "notifySessionsChanged":
      return state;
    case "setModelsLoading":
      return { ...state, modelsLoading: action.loading };
    case "setModels":
      return {
        ...state,
        models: action.models,
        selectedModel: chooseModelId(action.models, state.selectedModel, action.preferredModelId),
        modelsLoading: false,
      };
    case "setSelectedModel":
      return { ...state, selectedModel: action.modelId };
    case "setSetupWarning":
      return { ...state, setupWarning: action.warning };
    case "setError":
      return { ...state, error: action.error };
    case "hydrateActiveSessions":
      if (state.hydrated) return state;
      return action.hasExplicitSessionNav
        ? { ...state, hydrated: true }
        : hydrateSessionSnapshots(state, action.snapshots, action.projects);
    default:
      return null;
  }
}

function reducePaneLayoutAction(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState | null {
  switch (action.type) {
    case "setSplitRatio":
      return setWorkspaceSplitRatio(state, { path: action.path, ratio: action.ratio });
    case "focusPane":
      return focusPane(state, { paneId: action.paneId });
    case "focusPaneSession":
      return focusPaneSession(state, { paneId: action.paneId, sessionId: action.sessionId });
    case "closePane":
      return closePane(state, { paneId: action.paneId });
    case "openTerminalPane":
      return openTerminalPane(state, {
        sourcePaneId: action.sourcePaneId ?? state.focusedPaneId,
      });
    default:
      return null;
  }
}

function reduceSessionOpenAction(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState | null {
  switch (action.type) {
    case "openSessionPayloadInPane":
      return openSessionPayloadInPane(state, {
        paneId: action.paneId,
        payload: action.payload,
        tab: action.tab,
      });
    case "splitPaneWithPayload":
      return splitPaneWithPayload(state, {
        paneId: action.paneId,
        direction: action.direction,
        side: action.side,
        payload: action.payload,
        newPaneId: action.newPaneId,
        tab: action.tab,
      });
    default:
      return null;
  }
}

function reduceSessionEditAction(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState | null {
  switch (action.type) {
    case "renameTab":
      return renameTab(state, {
        paneId: action.paneId,
        tabId: action.tabId,
        title: action.title,
      });
    case "splitTab":
      return splitTabIntoNewPane(state, {
        sourcePaneId: action.sourcePaneId,
        sourceTabId: action.sourceTabId,
        newPaneId: action.newPaneId,
        tab: action.tab,
      });
    case "setPaneSession":
      return setPaneSession(state, { paneId: action.paneId, session: action.session });
    case "patchSession":
      return {
        ...state,
        sessions: patchSessionInMap(state.sessions, action.sessionId, action.patch),
      };
    case "patchActiveTab":
      return patchActiveTab(state, { paneId: action.paneId, patch: action.patch });
    case "urlNavRequested": {
      const next = applyUrlNavigation(state, {
        key: action.key,
        project: action.project,
        sessionId: action.sessionId,
        sessionTitle: action.sessionTitle,
        newSession: action.newSession,
        split: action.split,
        paneId: action.paneId,
        tab: action.tab,
      });
      return next === state
        ? state
        : { ...next, hydrated: action.newSession || Boolean(action.sessionId) || next.hydrated };
    }
    default:
      return null;
  }
}

export function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  return (
    reduceWorkspaceStatus(state, action) ??
    reducePaneLayoutAction(state, action) ??
    reduceSessionOpenAction(state, action) ??
    reduceSessionEditAction(state, action) ??
    state
  );
}
