import type { ActiveAgentSessionSnapshot } from "@/lib/agent/active-sessions";
import type {
  AgentModel,
  GitSummary,
  PaneId,
  ProjectEntry,
  WorkspaceAction,
  WorkspaceState,
} from "./types";
import {
  SELECTED_PROJECT_KEY,
  findPaneTabByPiSessionId,
  loadPersistedActiveAgentSessions,
  setupWarningFromPiCheck,
  type WorkspaceStorage,
} from "./store";
import {
  writeActiveSessions,
  writeBrowserTool,
  writeComputerTab,
  writeComputerWidth,
  writePaneState,
  writeSelectedProject,
} from "./persistence";

const SESSIONS_CHANGED_EVENT = "vllm-studio.agent.sessionsChanged";
const PROJECTS_CHANGED_EVENT = "vllm-studio.agent.projectsChanged";
const ACTIVE_AGENT_SESSIONS_EVENT = "vllm-studio.agent.activeSessions";
const NEW_AGENT_SESSION_EVENT = "vllm-studio.agent.newSession";
const ACTIVE_AGENT_SESSION_RENAME_EVENT = "vllm-studio.agent.activeSessionRename";
const ACTIVE_AGENT_SESSION_OPEN_EVENT = "vllm-studio.agent.activeSessionOpen";
const OPEN_SESSION_SPLIT_EVENT = "vllm-studio.agent.openSessionSplit";

type SetupCheck = { id: string; ok: boolean; guidance?: string };

export type WorkspaceApi = {
  loadSetupChecks?: () => Promise<{ checks?: SetupCheck[] }>;
  loadModels?: () => Promise<{ models?: AgentModel[]; error?: string } | AgentModel[]>;
  loadProjects?: () => Promise<ProjectEntry[]>;
  loadGitSummary?: (cwd: string) => Promise<GitSummary | null>;
};

export type WorkspaceWindow = {
  Event: typeof Event;
  CustomEvent: typeof CustomEvent;
  dispatchEvent: (event: Event) => boolean;
  addEventListener: Window["addEventListener"];
  removeEventListener: Window["removeEventListener"];
  setTimeout?: (handler: () => void, timeout: number) => unknown;
};

export type BrowserEventsSubscription = {
  setEnabled: (enabled: boolean) => void;
  close: () => void;
};

export type WorkspaceDispatch = (action: WorkspaceAction) => void;

export type WorkspaceEffectDeps = {
  storage: WorkspaceStorage;
  window: WorkspaceWindow;
  api: WorkspaceApi;
  dispatch?: WorkspaceDispatch;
  hasExplicitSessionNav?: () => boolean;
  queueReplay: (paneId: PaneId, piSessionId: string) => void;
  browserEvents?: BrowserEventsSubscription;
};

type WorkspaceActionKind =
  | "hydrate"
  | "workspaceUnmounted"
  | "projectsChanged"
  | "setProjects"
  | "selectProject"
  | "setSplitRatio"
  | "restorePaneState"
  | "openNewSession"
  | "replaySession"
  | "replaySessionInSplit"
  | "openSessionPayloadInPane"
  | "splitPaneWithPayload"
  | "focusPane"
  | "focusTab"
  | "renameTab"
  | "splitTab"
  | "closePane"
  | "setPaneTabs"
  | "patchActiveTab"
  | "setComputerOpen"
  | "toggleComputerOpen"
  | "setComputerTab"
  | "setComputerWidth"
  | "setBrowserToolEnabled"
  | "toggleBrowserTool"
  | "setBrowserUrl"
  | "setBrowserInput"
  | "setGitSummary"
  | "notifySessionsChanged"
  | "urlNavRequested"
  | WorkspaceAction["type"];

function workspaceActionKind(action: WorkspaceAction): WorkspaceActionKind {
  switch (action.type) {
    case "HYDRATE":
      return "hydrate";
    case "WORKSPACE_UNMOUNTED":
      return "workspaceUnmounted";
    case "PROJECTS_CHANGED":
      return "projectsChanged";
    case "SELECT_PROJECT":
      return "selectProject";
    case "SET_SPLIT_RATIO":
      return "setSplitRatio";
    case "OPEN_NEW_SESSION":
      return "openNewSession";
    case "REPLAY_SESSION":
      return "replaySession";
    case "REPLAY_SESSION_IN_SPLIT":
      return "replaySessionInSplit";
    case "OPEN_SESSION_PAYLOAD_IN_PANE":
      return "openSessionPayloadInPane";
    case "SPLIT_PANE_WITH_PAYLOAD":
      return "splitPaneWithPayload";
    case "FOCUS_PANE":
      return "focusPane";
    case "FOCUS_TAB":
      return "focusTab";
    case "RENAME_TAB":
      return "renameTab";
    case "SPLIT_TAB":
      return "splitTab";
    case "CLOSE_PANE":
      return "closePane";
    case "SET_PANE_TABS":
      return "setPaneTabs";
    case "PATCH_ACTIVE_TAB":
      return "patchActiveTab";
    case "SET_COMPUTER_OPEN":
      return "setComputerOpen";
    case "TOGGLE_COMPUTER_OPEN":
      return "toggleComputerOpen";
    case "SET_COMPUTER_TAB":
      return "setComputerTab";
    case "SET_COMPUTER_WIDTH":
      return "setComputerWidth";
    case "SET_BROWSER_TOOL_ENABLED":
      return "setBrowserToolEnabled";
    case "TOGGLE_BROWSER_TOOL":
      return "toggleBrowserTool";
    case "SET_BROWSER_URL":
      return "setBrowserUrl";
    case "SET_BROWSER_INPUT":
      return "setBrowserInput";
    case "NOTIFY_SESSIONS_CHANGED":
      return "notifySessionsChanged";
    case "URL_NAV_REQUESTED":
      return "urlNavRequested";
    default:
      return action.type;
  }
}

const PANE_STATE_ACTIONS = new Set<WorkspaceActionKind>([
  "setLayout",
  "setSplitRatio",
  "restorePaneState",
  "openNewSession",
  "replaySession",
  "replaySessionInSplit",
  "openSessionPayloadInPane",
  "splitPaneWithPayload",
  "focusPane",
  "focusTab",
  "renameTab",
  "splitTab",
  "closePane",
  "setPaneTabs",
  "patchActiveTab",
  "hydrateActiveSessions",
  "urlNavRequested",
]);

const SESSIONS_CHANGED_ACTIONS = new Set<WorkspaceActionKind>([
  "openNewSession",
  "replaySession",
  "replaySessionInSplit",
  "openSessionPayloadInPane",
  "splitPaneWithPayload",
  "renameTab",
  "splitTab",
  "closePane",
  "setPaneTabs",
  "patchActiveTab",
  "hydrateActiveSessions",
  "notifySessionsChanged",
  "urlNavRequested",
]);

function dispatchEvent(deps: WorkspaceEffectDeps, type: string): void {
  deps.window.dispatchEvent(new deps.window.Event(type));
}

function dispatchCustomEvent<T>(deps: WorkspaceEffectDeps, type: string, detail: T): void {
  deps.window.dispatchEvent(new deps.window.CustomEvent<T>(type, { detail }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function eventDetail(event: Event): unknown {
  return "detail" in event ? event.detail : undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}

export function subscribeWorkspaceWindowEvents(
  workspaceWindow: WorkspaceWindow,
  dispatch: WorkspaceDispatch,
): () => void {
  const onNewSession = (event: Event) => {
    const detail = eventDetail(event);
    const projectId = isRecord(detail) ? stringField(detail, "projectId") : undefined;
    dispatch({ type: "OPEN_NEW_SESSION", projectId });
  };
  const onRename = (event: Event) => {
    const detail = eventDetail(event);
    if (!isRecord(detail)) return;
    const paneId = stringField(detail, "paneId");
    const tabId = stringField(detail, "tabId");
    const title = stringField(detail, "title");
    if (!paneId || !tabId || !title) return;
    dispatch({ type: "RENAME_TAB", paneId, tabId, title });
  };
  const onOpen = (event: Event) => {
    const detail = eventDetail(event);
    if (!isRecord(detail)) return;
    const paneId = stringField(detail, "paneId");
    const tabId = stringField(detail, "tabId");
    const mode = stringField(detail, "mode");
    if (!paneId || !tabId) return;
    if (mode === "split") {
      dispatch({ type: "SPLIT_TAB", sourcePaneId: paneId, sourceTabId: tabId });
      return;
    }
    dispatch({ type: "FOCUS_TAB", paneId, tabId });
  };
  const onSplitSession = (event: Event) => {
    const detail = eventDetail(event);
    const piSessionId = isRecord(detail) ? stringField(detail, "piSessionId") : undefined;
    if (piSessionId) dispatch({ type: "REPLAY_SESSION_IN_SPLIT", piSessionId });
  };
  const onProjectsChanged = () => {
    dispatch({ type: "PROJECTS_CHANGED" });
  };

  workspaceWindow.addEventListener(NEW_AGENT_SESSION_EVENT, onNewSession);
  workspaceWindow.addEventListener(ACTIVE_AGENT_SESSION_RENAME_EVENT, onRename);
  workspaceWindow.addEventListener(ACTIVE_AGENT_SESSION_OPEN_EVENT, onOpen);
  workspaceWindow.addEventListener(OPEN_SESSION_SPLIT_EVENT, onSplitSession);
  workspaceWindow.addEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged);

  return () => {
    workspaceWindow.removeEventListener(NEW_AGENT_SESSION_EVENT, onNewSession);
    workspaceWindow.removeEventListener(ACTIVE_AGENT_SESSION_RENAME_EVENT, onRename);
    workspaceWindow.removeEventListener(ACTIVE_AGENT_SESSION_OPEN_EVENT, onOpen);
    workspaceWindow.removeEventListener(OPEN_SESSION_SPLIT_EVENT, onSplitSession);
    workspaceWindow.removeEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged);
    dispatch({ type: "WORKSPACE_UNMOUNTED" });
  };
}

function scheduleSessionsRefresh(deps: WorkspaceEffectDeps): void {
  dispatchEvent(deps, SESSIONS_CHANGED_EVENT);
  deps.window.setTimeout?.(() => dispatchEvent(deps, SESSIONS_CHANGED_EVENT), 1_500);
}

function readSelectedProjectId(storage: WorkspaceStorage): string | null {
  try {
    return storage.getItem(SELECTED_PROJECT_KEY);
  } catch {
    return null;
  }
}

function normalizeModelsPayload(
  payload: { models?: AgentModel[]; error?: string } | AgentModel[],
): { models: AgentModel[]; error?: string } {
  return Array.isArray(payload)
    ? { models: payload }
    : { models: payload.models ?? [], error: payload.error };
}

function runInitialApiEffects(state: WorkspaceState, deps: WorkspaceEffectDeps): void {
  const setupChecks = deps.api.loadSetupChecks?.().catch(() => null);

  if (deps.api.loadModels) {
    deps.dispatch?.({ type: "setModelsLoading", loading: true });
    deps.dispatch?.({ type: "setError", error: "" });
    void deps.api
      .loadModels()
      .then((payload) => {
        const normalized = normalizeModelsPayload(payload);
        if (normalized.error) throw new Error(normalized.error);
        deps.dispatch?.({ type: "setModels", models: normalized.models });
        if (normalized.models.length > 0) {
          deps.dispatch?.({ type: "setSetupWarning", warning: "" });
        } else {
          void setupChecks?.then((setupPayload) => {
            const pi = setupPayload?.checks?.find((check) => check.id === "pi");
            deps.dispatch?.({
              type: "setSetupWarning",
              warning: setupWarningFromPiCheck(pi, false),
            });
          });
        }
      })
      .catch((error) => {
        deps.dispatch?.({
          type: "setError",
          error: error instanceof Error ? error.message : "Failed to load models",
        });
        deps.dispatch?.({ type: "setModelsLoading", loading: false });
      });
  } else if (setupChecks) {
    void setupChecks.then((payload) => {
      const pi = payload?.checks?.find((check) => check.id === "pi");
      deps.dispatch?.({
        type: "setSetupWarning",
        warning: setupWarningFromPiCheck(pi, state.models.length > 0),
      });
    });
  }

  if (deps.api.loadProjects) {
    void deps.api
      .loadProjects()
      .then((projects) => {
        deps.dispatch?.({
          type: "setProjects",
          projects,
          storedProjectId: readSelectedProjectId(deps.storage),
        });
      })
      .catch(() => {
        deps.dispatch?.({ type: "setProjectsLoaded", loaded: true });
      });
  }
}

function activeProjectForState(state: WorkspaceState): ProjectEntry | null {
  return state.projects.find((entry) => entry.id === state.selectedProjectId) ?? null;
}

function focusedProjectPath(state: WorkspaceState): string | null {
  const focusedPane = state.panesById.get(state.focusedPaneId);
  const focusedTab = focusedPane?.tabs.find((tab) => tab.id === focusedPane.activeTabId) ?? null;
  const activeProject = activeProjectForState(state);
  const focusedProject =
    state.projects.find((entry) => entry.id === focusedTab?.projectId) ??
    state.projects.find((entry) => entry.path === focusedTab?.cwd) ??
    activeProject;
  return focusedProject?.path ?? null;
}

function runGitSummaryEffect(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  const nextPath = focusedProjectPath(nextState);
  if (!nextPath || focusedProjectPath(prevState) === nextPath || !deps.api.loadGitSummary) return;
  void deps.api
    .loadGitSummary(nextPath)
    .then((summary) => {
      deps.dispatch?.({ type: "setGitSummary", cwd: nextPath, summary });
    })
    .catch(() => {
      deps.dispatch?.({ type: "deleteGitSummary", cwd: nextPath });
    });
}

function computeActiveSessionBroadcast(state: WorkspaceState): ActiveAgentSessionSnapshot[] | null {
  const activeProject = activeProjectForState(state);
  if (!activeProject || !state.hydrated) return null;
  return [...state.panesById.entries()].flatMap(([paneId, pane]) =>
    pane.tabs
      .filter(
        (tab) => (Boolean(tab.piSessionId) || tab.messages.length > 0) && tab.status !== "loading",
      )
      .map((tab) => {
        const project =
          state.projects.find((entry) => entry.id === tab.projectId) ??
          state.projects.find((entry) => entry.path === tab.cwd) ??
          activeProject;
        return {
          projectId: project.id,
          cwd: tab.cwd ?? project.path,
          paneId,
          tabId: tab.id,
          piSessionId: tab.piSessionId,
          modelId: tab.modelId ?? state.selectedModel,
          title: tab.title,
          status: tab.status,
          active: paneId === state.focusedPaneId && tab.id === pane.activeTabId,
          startedAt: tab.startedAt,
          updatedAt: tab.startedAt || new Date().toISOString(),
          plugins: tab.plugins,
          skills: tab.skills,
        };
      }),
  );
}

function activeSessionBroadcastKey(sessions: ActiveAgentSessionSnapshot[] | null): string {
  return JSON.stringify(sessions ?? null);
}

function broadcastActiveSessions(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  const previous = computeActiveSessionBroadcast(prevState);
  const next = computeActiveSessionBroadcast(nextState);
  if (!next || activeSessionBroadcastKey(previous) === activeSessionBroadcastKey(next)) return;
  writeActiveSessions(deps.storage, next);
  dispatchCustomEvent(deps, ACTIVE_AGENT_SESSIONS_EVENT, { sessions: next });
}

function queueLocatedReplay(
  piSessionId: string | null | undefined,
  state: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  if (!piSessionId) return;
  const located = findPaneTabByPiSessionId(state.panesById, piSessionId);
  if (located) deps.queueReplay(located.paneId, piSessionId);
}

function queueRecoverableActiveTabReplays(state: WorkspaceState, deps: WorkspaceEffectDeps): void {
  const queued = new Set<string>();
  for (const [paneId, pane] of state.panesById.entries()) {
    const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0];
    if (
      activeTab?.piSessionId &&
      (activeTab.messages.length === 0 ||
        activeTab.status === "loading" ||
        activeTab.status === "running" ||
        activeTab.status === "starting") &&
      !queued.has(activeTab.piSessionId)
    ) {
      queued.add(activeTab.piSessionId);
      deps.queueReplay(paneId, activeTab.piSessionId);
    }
  }
}

function queueReplayEffects(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  switch (action.type) {
    case "replaySession":
    case "REPLAY_SESSION":
      queueLocatedReplay(action.piSessionId, nextState, deps);
      return;
    case "replaySessionInSplit":
    case "REPLAY_SESSION_IN_SPLIT":
      if (!findPaneTabByPiSessionId(prevState.panesById, action.piSessionId)) {
        queueLocatedReplay(action.piSessionId, nextState, deps);
      }
      return;
    case "openSessionPayloadInPane":
    case "OPEN_SESSION_PAYLOAD_IN_PANE":
    case "splitPaneWithPayload":
    case "SPLIT_PANE_WITH_PAYLOAD":
      if (
        action.payload.piSessionId &&
        !findPaneTabByPiSessionId(prevState.panesById, action.payload.piSessionId)
      ) {
        queueLocatedReplay(action.payload.piSessionId, nextState, deps);
      }
      return;
    case "URL_NAV_REQUESTED":
      if (action.sessionId) queueLocatedReplay(action.sessionId, nextState, deps);
      return;
    case "restorePaneState":
      queueRecoverableActiveTabReplays(nextState, deps);
      return;
    case "hydrateActiveSessions": {
      const queued = new Set<string>();
      for (const snapshot of action.snapshots) {
        if (!snapshot.piSessionId || queued.has(snapshot.piSessionId)) continue;
        queued.add(snapshot.piSessionId);
        queueLocatedReplay(snapshot.piSessionId, nextState, deps);
      }
      return;
    }
    default:
      return;
  }
}

function persistActionEffects(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  const actionKind = workspaceActionKind(action);

  if (PANE_STATE_ACTIONS.has(actionKind)) {
    writePaneState(deps.storage, nextState);
  }

  if (
    (actionKind === "selectProject" ||
      actionKind === "openNewSession" ||
      actionKind === "hydrateActiveSessions" ||
      actionKind === "urlNavRequested") &&
    prevState.selectedProjectId !== nextState.selectedProjectId
  ) {
    writeSelectedProject(deps.storage, nextState.selectedProjectId);
  }

  if (prevState.computer.tab !== nextState.computer.tab) {
    writeComputerTab(deps.storage, nextState.computer.tab);
  }

  if (prevState.computer.width !== nextState.computer.width) {
    writeComputerWidth(deps.storage, nextState.computer.width);
  }

  if (prevState.browserToolEnabled !== nextState.browserToolEnabled) {
    writeBrowserTool(deps.storage, nextState.browserToolEnabled);
  }
}

export function runWorkspaceEffect(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  const actionKind = workspaceActionKind(action);

  if (actionKind === "workspaceUnmounted") {
    deps.browserEvents?.close();
    return;
  }

  persistActionEffects(action, prevState, nextState, deps);
  queueReplayEffects(action, prevState, nextState, deps);

  if (SESSIONS_CHANGED_ACTIONS.has(actionKind)) {
    scheduleSessionsRefresh(deps);
  }

  if (actionKind === "hydrate") {
    runInitialApiEffects(nextState, deps);
  }

  if (actionKind === "projectsChanged" && deps.api.loadProjects) {
    void deps.api
      .loadProjects()
      .then((projects) => {
        deps.dispatch?.({
          type: "setProjects",
          projects,
          storedProjectId: readSelectedProjectId(deps.storage),
        });
      })
      .catch(() => {
        deps.dispatch?.({ type: "setProjectsLoaded", loaded: true });
      });
  }

  if (actionKind === "setProjects" && !nextState.hydrated) {
    deps.dispatch?.({
      type: "hydrateActiveSessions",
      snapshots: loadPersistedActiveAgentSessions(deps.storage),
      hasExplicitSessionNav: deps.hasExplicitSessionNav?.() ?? false,
    });
  }

  runGitSummaryEffect(prevState, nextState, deps);
  broadcastActiveSessions(prevState, nextState, deps);
  deps.browserEvents?.setEnabled(nextState.browserToolEnabled);
}
