import type { ActiveAgentSessionSnapshot } from "@/lib/agent/active-sessions";
import { makeFreshTab, newRuntimeId } from "@/lib/agent/session/helpers";
import type { Project } from "@/lib/agent/projects/types";
import type { Session, SessionId } from "@/lib/agent/sessions/types";
import type {
  AgentModel,
  PaneId,
  PaneState,
  WorkspaceAction,
  WorkspaceLayout,
  WorkspaceState,
} from "./types";
import {
  applyUrlNavigation,
  closePane,
  focusPane,
  openNewSessionInFocusedPane,
  openSessionPayloadInPane,
  patchActiveTab,
  replaySessionInFocusedPane,
  replaySessionInSplitPane,
  restorePaneState as restorePaneWorkspaceState,
  setPaneSession,
  setWorkspaceLayout,
  setWorkspaceSplitRatio,
  splitPaneWithPayload,
  splitTabIntoNewPane,
  renameTab,
} from "./pane-controller";

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

  const restorable = snapshots.filter((session) =>
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
    const activeSessionId = group.find((session) => session.active)?.tabId || restored[0]?.id;
    const session =
      restored.find((tab) => tab.id === activeSessionId) ?? restored[0] ?? makeFreshTab();
    sessions.set(session.id, session);
    panesById.set(paneId, {
      sessionId: session.id,
      runtimeSessionId: newRuntimeId(),
    });
  }

  const activeSnapshot = restorable.find((session) => session.active) ?? restorable[0];

  return {
    ...state,
    sessions,
    panesById,
    layout: layoutFromPaneIds(paneIds),
    focusedPaneId: activeSnapshot.paneId,
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
    case "workspaceUnmounted":
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
    case "setLayout":
      return setWorkspaceLayout(state, { layout: action.layout });
    case "setSplitRatio":
      return setWorkspaceSplitRatio(state, { path: action.path, ratio: action.ratio });
    case "restorePaneState":
      return restorePaneWorkspaceState(state, action);
    case "focusPane":
      return focusPane(state, { paneId: action.paneId });
    case "closePane":
      return closePane(state, { paneId: action.paneId });
    default:
      return null;
  }
}

function reduceSessionOpenAction(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState | null {
  switch (action.type) {
    case "openNewSession":
      return openNewSessionInFocusedPane(state, {
        project: action.project,
        tab: action.tab,
        paneId: action.paneId,
        runtimeSessionId: action.runtimeSessionId,
        mode: action.mode,
      });
    case "replaySession":
      return replaySessionInFocusedPane(state, {
        piSessionId: action.piSessionId,
        sessionTitle: action.sessionTitle,
        tab: action.tab,
      });
    case "replaySessionInSplit":
      return replaySessionInSplitPane(state, {
        piSessionId: action.piSessionId,
        paneId: action.paneId,
        runtimeSessionId: action.runtimeSessionId,
        sessionTitle: action.sessionTitle,
        tab: action.tab,
      });
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
        runtimeSessionId: action.runtimeSessionId,
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
        runtimeSessionId: action.runtimeSessionId,
        tab: action.tab,
      });
    case "setPaneSession":
      return setPaneSession(state, { paneId: action.paneId, session: action.session });
    case "patchActiveTab":
      return patchActiveTab(state, { paneId: action.paneId, patch: action.patch });
    case "urlNavRequested":
      return applyUrlNavigation(state, {
        key: action.key,
        project: action.project,
        sessionId: action.sessionId,
        sessionTitle: action.sessionTitle,
        newSession: action.newSession,
        split: action.split,
        paneId: action.paneId,
        runtimeSessionId: action.runtimeSessionId,
        tab: action.tab,
      });
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
