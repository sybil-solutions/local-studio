import { patchSession as patchSessionInMap } from "@/features/agent/runtime/store";
import type { AgentModel, WorkspaceAction, WorkspaceState } from "@/features/agent/workspace/types";
import {
  applyUrlNavigation,
  closePane,
  focusPane,
  focusPaneSession,
  openSessionPayloadInPane,
  patchActiveTab,
  setPaneSession,
  setWorkspaceSplitRatio,
  splitPaneWithPayload,
  splitTabIntoNewPane,
  renameTab,
} from "@/features/agent/workspace/pane-controller";

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
        replaceWorkspace: action.replaceWorkspace,
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
