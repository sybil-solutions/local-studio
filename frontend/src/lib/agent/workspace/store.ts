import {
  collectLeaves,
  removeLeaf,
  setSplitRatio as setLayoutSplitRatio,
  splitLeaf,
} from "@/app/agent/_components/pane-layout";
import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
  type ActiveSessionPrefs,
} from "@/lib/agent/active-sessions";
import type { SessionTab } from "@/app/agent/_components/chat-pane";
import type {
  AgentModel,
  PaneId,
  PaneState,
  WorkspaceAction,
  WorkspaceLayout,
  WorkspaceState,
} from "./types";

export const DEFAULT_AGENT_CWD = "";
export const DEFAULT_BROWSER_URL = "https://www.google.com";
export const DEFAULT_COMPUTER_WIDTH = 440;
export const MIN_COMPUTER_WIDTH = 320;
export const MAX_COMPUTER_WIDTH = 960;

export const SELECTED_PROJECT_KEY = "vllm-studio.agent.selectedProjectId";
export const BROWSER_TOOL_KEY = "vllm-studio.agent.browserToolEnabled";
export const BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY =
  "***************************************************";
export const COMPUTER_BROWSER_OPEN_KEY = "vllm-studio.agent.computer.browserOpen";
export const COMPUTER_FILES_OPEN_KEY = "vllm-studio.agent.computer.filesOpen";
export const COMPUTER_DEFAULT_CLOSED_STORAGE_ID = "vllm-studio.agent.computer.defaultCollapsedV2";
export const COMPUTER_WIDTH_KEY = "vllm-studio.agent.computer.width";
export const PANE_LAYOUT_KEY = "vllm-studio.agent.paneLayout";
export const PANE_STATE_KEY = "vllm-studio.agent.paneState";
export const ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY = "vllm-studio.agent.activeSessions.snapshot";
export const SESSION_PREFS_KEY = "vllm-studio.agent.sessionPrefs";

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type PersistedPaneState = {
  version: 1;
  layout: WorkspaceLayout;
  focusedPaneId: PaneId;
  panes: Record<
    string,
    {
      tabs?: unknown[];
      activeTabId?: unknown;
      runtimeSessionId?: unknown;
    }
  >;
};

export function randomIdSegment(length: number): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID().replace(/-/g, "").slice(0, length);
  }
  const bytes = new Uint8Array(Math.ceil(length / 2));
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

export function newPaneId(): PaneId {
  return `p-${Date.now().toString(36)}-${randomIdSegment(6)}`;
}

export function newRuntimeId(): string {
  return `rt-${Date.now().toString(36)}-${randomIdSegment(6)}`;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomIdSegment(8)}`;
}

function makeFreshWorkspaceTab(): SessionTab {
  return {
    id: newId("tab"),
    runtimeSessionId: newId("rt"),
    piSessionId: null,
    title: "New session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  };
}

function freshTab(tab?: SessionTab): SessionTab {
  return tab ? { ...tab } : makeFreshWorkspaceTab();
}

export function createInitialState(): WorkspaceState {
  const tab = makeFreshWorkspaceTab();
  return {
    projects: [],
    projectsLoaded: false,
    selectedProjectId: null,
    agentCwd: DEFAULT_AGENT_CWD,
    models: [],
    selectedModel: "",
    modelsLoading: true,
    layout: { kind: "leaf", paneId: "p-init" },
    panesById: new Map([
      [
        "p-init",
        {
          tabs: [tab],
          activeTabId: tab.id,
          runtimeSessionId: `rt-${randomIdSegment(9)}`,
        },
      ],
    ]),
    focusedPaneId: "p-init",
    setupWarning: "",
    error: "",
    gitSummaries: new Map(),
    computer: { open: false, tab: "browser", width: DEFAULT_COMPUTER_WIDTH },
    browserToolEnabled: false,
    browserUrl: DEFAULT_BROWSER_URL,
    browserInput: DEFAULT_BROWSER_URL,
    hydrated: false,
    lastHandledNavKey: "",
  };
}

export function setupWarningFromPiCheck(
  piCheck: { ok: boolean; guidance?: string } | undefined,
  hasUsableModels: boolean,
): string {
  if (hasUsableModels || !piCheck || piCheck.ok) return "";
  return piCheck.guidance ?? "Pi is not installed.";
}

export function clampComputerWidth(width: number): number {
  return Math.min(MAX_COMPUTER_WIDTH, Math.max(MIN_COMPUTER_WIDTH, Math.round(width)));
}

export function normalizePersistedTab(value: unknown): SessionTab | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as Partial<SessionTab>;
  if (typeof tab.id !== "string" || typeof tab.runtimeSessionId !== "string") return null;
  const fallback = makeFreshWorkspaceTab();
  return {
    ...fallback,
    ...tab,
    id: tab.id,
    runtimeSessionId: tab.runtimeSessionId,
    piSessionId: typeof tab.piSessionId === "string" ? tab.piSessionId : null,
    title: typeof tab.title === "string" && tab.title.trim() ? tab.title : fallback.title,
    messages: Array.isArray(tab.messages) ? tab.messages.slice(-80) : [],
    status: typeof tab.status === "string" ? tab.status : "idle",
    error: "",
    startedAt: typeof tab.startedAt === "string" ? tab.startedAt : undefined,
    input: typeof tab.input === "string" ? tab.input : "",
    queue: Array.isArray(tab.queue) ? tab.queue : undefined,
    activeAssistantId:
      typeof tab.activeAssistantId === "string" ? tab.activeAssistantId : undefined,
    lastEventSeq: typeof tab.lastEventSeq === "number" ? tab.lastEventSeq : undefined,
    plugins: Array.isArray(tab.plugins) ? tab.plugins : undefined,
    skills: Array.isArray(tab.skills) ? tab.skills : undefined,
  };
}

export function restorePersistedPaneState(raw: string): {
  layout: WorkspaceLayout;
  panesById: Map<PaneId, PaneState>;
  focusedPaneId: PaneId;
} | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPaneState>;
    if (!parsed.layout || typeof parsed.layout !== "object") return null;
    const leaves = collectLeaves(parsed.layout as WorkspaceLayout);
    if (leaves.length === 0) return null;
    const panes = parsed.panes && typeof parsed.panes === "object" ? parsed.panes : {};
    const panesById = new Map<PaneId, PaneState>();
    for (const paneId of leaves) {
      const pane = panes[paneId] ?? {};
      const restoredTabs = Array.isArray(pane.tabs)
        ? pane.tabs.map(normalizePersistedTab).filter((tab): tab is SessionTab => Boolean(tab))
        : [];
      const tabs = restoredTabs.length > 0 ? restoredTabs : [makeFreshWorkspaceTab()];
      const activeTabId =
        typeof pane.activeTabId === "string" && tabs.some((tab) => tab.id === pane.activeTabId)
          ? pane.activeTabId
          : tabs[0].id;
      panesById.set(paneId, {
        tabs,
        activeTabId,
        runtimeSessionId:
          typeof pane.runtimeSessionId === "string" && pane.runtimeSessionId.trim()
            ? pane.runtimeSessionId
            : newRuntimeId(),
      });
    }
    const focusedPaneId =
      typeof parsed.focusedPaneId === "string" && leaves.includes(parsed.focusedPaneId)
        ? parsed.focusedPaneId
        : leaves[0];
    return { layout: parsed.layout as WorkspaceLayout, panesById, focusedPaneId };
  } catch {
    return null;
  }
}

export function tabForPersistence(tab: SessionTab): SessionTab {
  return {
    ...tab,
    messages: tab.messages.slice(-80),
    status: tab.status,
    error: "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function defaultWorkspaceStorage(): WorkspaceStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function loadSessionPrefs(storage: WorkspaceStorage): ActiveSessionPrefs {
  try {
    const raw = storage.getItem(SESSION_PREFS_KEY);
    return raw ? (JSON.parse(raw) as ActiveSessionPrefs) : {};
  } catch {
    return {};
  }
}

export function loadPersistedActiveAgentSessions(
  storage: WorkspaceStorage | null = defaultWorkspaceStorage(),
): ActiveAgentSessionSnapshot[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY);
    if (!raw) return [];
    const prefs = loadSessionPrefs(storage);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecord)
      .map((entry): ActiveAgentSessionSnapshot => {
        const piSessionId = typeof entry.piSessionId === "string" ? entry.piSessionId.trim() : null;
        return {
          projectId: typeof entry.projectId === "string" ? entry.projectId : "",
          cwd: typeof entry.cwd === "string" ? entry.cwd : "",
          paneId: typeof entry.paneId === "string" ? entry.paneId : "",
          tabId: typeof entry.tabId === "string" ? entry.tabId : "",
          piSessionId: piSessionId || null,
          modelId: typeof entry.modelId === "string" ? entry.modelId : undefined,
          title: typeof entry.title === "string" ? entry.title : "Loading session",
          status: typeof entry.status === "string" ? entry.status : "idle",
          active: entry.active === true,
          startedAt: typeof entry.startedAt === "string" ? entry.startedAt : undefined,
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
          plugins: Array.isArray(entry.plugins)
            ? (entry.plugins as SessionTab["plugins"])
            : undefined,
          skills: Array.isArray(entry.skills) ? (entry.skills as SessionTab["skills"]) : undefined,
        };
      })
      .filter(
        (entry) =>
          !prefs[entry.piSessionId ?? ""]?.hidden &&
          Boolean(entry.projectId) &&
          Boolean(entry.cwd) &&
          Boolean(entry.paneId) &&
          Boolean(entry.tabId),
      );
  } catch {
    return [];
  }
}

export function persistActiveAgentSessions(
  sessions: ActiveAgentSessionSnapshot[],
  storage: WorkspaceStorage | null = defaultWorkspaceStorage(),
): void {
  if (!storage) return;
  const prefs = loadSessionPrefs(storage);
  const merged = mergeActiveAgentSessions(
    loadPersistedActiveAgentSessions(storage),
    sessions,
    prefs,
  );
  if (merged.length > 0) {
    storage.setItem(ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY, JSON.stringify(merged));
  } else {
    storage.removeItem(ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY);
  }
}

export function layoutFromPaneIds(paneIds: PaneId[]): WorkspaceLayout {
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

export function tabFromSnapshot(session: ActiveAgentSessionSnapshot): SessionTab {
  const fresh = makeFreshWorkspaceTab();
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
    plugins: session.plugins,
    skills: session.skills,
  };
}

export function isEmptyStarterTab(tab: SessionTab): boolean {
  return !tab.piSessionId && tab.messages.length === 0 && !tab.input.trim();
}

export function findPaneTabByPiSessionId(
  panes: ReadonlyMap<PaneId, PaneState>,
  piSessionId: string,
): { paneId: PaneId; tab: SessionTab } | null {
  for (const [paneId, pane] of panes.entries()) {
    const tab = pane.tabs.find((entry) => entry.piSessionId === piSessionId);
    if (tab) return { paneId, tab };
  }
  return null;
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

function focusExistingSession(
  state: WorkspaceState,
  paneId: PaneId,
  tabId: string,
): WorkspaceState {
  const pane = state.panesById.get(paneId);
  if (!pane) return state;
  const next = new Map(state.panesById);
  next.set(paneId, { ...pane, activeTabId: tabId });
  return { ...state, panesById: next, focusedPaneId: paneId };
}

function addTabToPane(state: WorkspaceState, paneId: PaneId, tab: SessionTab): WorkspaceState {
  const pane = state.panesById.get(paneId);
  if (!pane) return state;
  const next = new Map(state.panesById);
  next.set(paneId, { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id });
  return { ...state, panesById: next, focusedPaneId: paneId };
}

function copyTab(sourceTab: SessionTab | undefined, fallback?: SessionTab): SessionTab {
  const fresh = freshTab(fallback);
  return sourceTab
    ? { ...sourceTab, id: fresh.id, runtimeSessionId: fresh.runtimeSessionId }
    : fresh;
}

function hydrateSessionSnapshots(
  state: WorkspaceState,
  snapshots: ActiveAgentSessionSnapshot[],
): WorkspaceState {
  const paneStateAlreadyRestored = [...state.panesById.values()].some((pane) =>
    pane.tabs.some((tab) => Boolean(tab.piSessionId) || tab.messages.length > 0),
  );
  if (paneStateAlreadyRestored) return { ...state, hydrated: true };

  const restorable = snapshots.filter((session) =>
    state.projects.some(
      (project) => project.id === session.projectId || project.path === session.cwd,
    ),
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
  for (const paneId of paneIds) {
    const group = grouped.get(paneId) ?? [];
    const tabs = group.map(tabFromSnapshot);
    const activeTabId =
      group.find((session) => session.active)?.tabId || tabs[0]?.id || makeFreshWorkspaceTab().id;
    panesById.set(paneId, {
      tabs: tabs.length > 0 ? tabs : [makeFreshWorkspaceTab()],
      activeTabId,
      runtimeSessionId: newRuntimeId(),
    });
  }

  const activeSnapshot = restorable.find((session) => session.active) ?? restorable[0];
  const activeProject =
    state.projects.find((project) => project.id === activeSnapshot.projectId) ??
    state.projects.find((project) => project.path === activeSnapshot.cwd) ??
    null;

  return {
    ...state,
    panesById,
    layout: layoutFromPaneIds(paneIds),
    focusedPaneId: activeSnapshot.paneId,
    selectedProjectId: activeProject ? activeProject.id : state.selectedProjectId,
    agentCwd: activeProject ? activeProject.path : state.agentCwd,
    hydrated: true,
  };
}

export function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "hydrate":
    case "HYDRATE": {
      const hydration = action.type === "HYDRATE" ? action.payload : action.state;
      const next = { ...state, ...hydration };
      return { ...next, hydrated: action.hydrated ?? next.hydrated };
    }
    case "WORKSPACE_UNMOUNTED":
    case "PROJECTS_CHANGED":
    case "NOTIFY_SESSIONS_CHANGED":
      return state;
    case "setProjects": {
      const initial =
        (action.storedProjectId &&
          action.projects.find((entry) => entry.id === action.storedProjectId)) ||
        action.projects[0] ||
        null;
      return {
        ...state,
        projects: action.projects,
        projectsLoaded: true,
        selectedProjectId: initial?.id ?? null,
        agentCwd: initial?.path ?? DEFAULT_AGENT_CWD,
      };
    }
    case "setProjectsLoaded":
      return { ...state, projectsLoaded: action.loaded };
    case "selectProject":
    case "SELECT_PROJECT":
      return {
        ...state,
        selectedProjectId: action.project?.id ?? null,
        agentCwd: action.project?.path ?? DEFAULT_AGENT_CWD,
      };
    case "setAgentCwd":
      return { ...state, agentCwd: action.cwd };
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
    case "setLayout":
      return { ...state, layout: action.layout };
    case "setSplitRatio":
    case "SET_SPLIT_RATIO":
      return { ...state, layout: setLayoutSplitRatio(state.layout, action.path, action.ratio) };
    case "restorePaneState":
      return {
        ...state,
        layout: action.layout,
        panesById: new Map(action.panesById),
        focusedPaneId: action.focusedPaneId,
        hydrated: true,
      };
    case "openNewSession":
    case "OPEN_NEW_SESSION": {
      const project =
        action.project ??
        (action.type === "OPEN_NEW_SESSION" && action.projectId
          ? state.projects.find((entry) => entry.id === action.projectId)
          : undefined);
      const selectedProjectState = project
        ? {
            ...state,
            selectedProjectId: project.id,
            agentCwd: project.path,
          }
        : state;
      const pane = selectedProjectState.panesById.get(selectedProjectState.focusedPaneId);
      if (!pane) return selectedProjectState;
      const existing = pane.tabs.find((tab) => {
        if (!isEmptyStarterTab(tab)) return false;
        if (project?.id && tab.projectId && tab.projectId !== project.id) {
          return false;
        }
        if (project?.path && tab.cwd && tab.cwd !== project.path) return false;
        return true;
      });
      const nextPanes = new Map(selectedProjectState.panesById);
      if (existing) {
        nextPanes.set(selectedProjectState.focusedPaneId, {
          ...pane,
          tabs: pane.tabs.map((tab) =>
            tab.id === existing.id && project
              ? { ...tab, projectId: project.id, cwd: project.path }
              : tab,
          ),
          activeTabId: existing.id,
        });
        return { ...selectedProjectState, panesById: nextPanes };
      }
      const tab = {
        ...freshTab(action.tab),
        projectId: project?.id,
        cwd: project?.path,
      };
      nextPanes.set(selectedProjectState.focusedPaneId, {
        ...pane,
        tabs: [...pane.tabs, tab],
        activeTabId: tab.id,
      });
      return { ...selectedProjectState, panesById: nextPanes };
    }
    case "replaySession":
    case "REPLAY_SESSION": {
      const existing = findPaneTabByPiSessionId(state.panesById, action.piSessionId);
      if (existing) return focusExistingSession(state, existing.paneId, existing.tab.id);
      const pane = state.panesById.get(state.focusedPaneId);
      if (!pane) return state;
      const active = pane.tabs.find((tab) => tab.id === pane.activeTabId);
      const targetTab = active && isEmptyStarterTab(active) ? active : null;
      const replayTab = targetTab
        ? {
            ...targetTab,
            piSessionId: action.piSessionId,
            title: targetTab.title || "Loading session",
          }
        : { ...freshTab(action.tab), piSessionId: action.piSessionId, title: "Loading session" };
      const nextTabs = targetTab
        ? pane.tabs.map((tab) => (tab.id === targetTab.id ? replayTab : tab))
        : [...pane.tabs, replayTab];
      const nextPanes = new Map(state.panesById);
      nextPanes.set(state.focusedPaneId, {
        ...pane,
        tabs: nextTabs,
        activeTabId: replayTab.id,
      });
      return { ...state, panesById: nextPanes };
    }
    case "replaySessionInSplit":
    case "REPLAY_SESSION_IN_SPLIT": {
      const existing = findPaneTabByPiSessionId(state.panesById, action.piSessionId);
      if (existing) return focusExistingSession(state, existing.paneId, existing.tab.id);
      const leaves = collectLeaves(state.layout);
      if (leaves.length >= 2) {
        const targetPaneId = leaves.find((id) => id !== state.focusedPaneId) ?? state.focusedPaneId;
        const tab = {
          ...freshTab(action.tab),
          piSessionId: action.piSessionId,
          title: "Loading session",
        };
        return addTabToPane(state, targetPaneId, tab);
      }
      const paneId = action.paneId ?? newPaneId();
      const tab = {
        ...freshTab(action.tab),
        piSessionId: action.piSessionId,
        title: "Loading session",
      };
      const nextPanes = new Map(state.panesById);
      nextPanes.set(paneId, {
        tabs: [tab],
        activeTabId: tab.id,
        runtimeSessionId: action.runtimeSessionId ?? newRuntimeId(),
      });
      return {
        ...state,
        panesById: nextPanes,
        layout: splitLeaf(state.layout, state.focusedPaneId, paneId, "vertical", "b"),
        focusedPaneId: paneId,
      };
    }
    case "openSessionPayloadInPane":
    case "OPEN_SESSION_PAYLOAD_IN_PANE": {
      if (action.payload.piSessionId) {
        const existing = findPaneTabByPiSessionId(state.panesById, action.payload.piSessionId);
        if (existing) return focusExistingSession(state, existing.paneId, existing.tab.id);
        const tab = {
          ...freshTab(action.tab),
          projectId: action.payload.projectId,
          cwd: action.payload.cwd,
          piSessionId: action.payload.piSessionId,
          title: action.payload.title ?? "Loading session",
        };
        return addTabToPane(state, action.paneId, tab);
      }
      if (action.payload.paneId && action.payload.tabId) {
        const source = state.panesById.get(action.payload.paneId);
        const sourceTab = source?.tabs.find((tab) => tab.id === action.payload.tabId);
        if (!sourceTab) return state;
        return addTabToPane(state, action.paneId, copyTab(sourceTab, action.tab));
      }
      return { ...state, focusedPaneId: action.paneId };
    }
    case "splitPaneWithPayload":
    case "SPLIT_PANE_WITH_PAYLOAD": {
      if (action.payload.piSessionId) {
        const existing = findPaneTabByPiSessionId(state.panesById, action.payload.piSessionId);
        if (existing) return focusExistingSession(state, existing.paneId, existing.tab.id);
      }
      if (collectLeaves(state.layout).length >= 2) return state;
      const paneId = action.newPaneId ?? newPaneId();
      const baseTab = {
        ...freshTab(action.tab),
        projectId: action.payload.projectId,
        cwd: action.payload.cwd,
        piSessionId: action.payload.piSessionId ?? null,
        title: action.payload.title ?? "Loading session",
      };
      const source = action.payload.paneId ? state.panesById.get(action.payload.paneId) : null;
      const sourceTab = source?.tabs.find((tab) => tab.id === action.payload.tabId);
      const tab = !action.payload.piSessionId && sourceTab ? copyTab(sourceTab, baseTab) : baseTab;
      const nextPanes = new Map(state.panesById);
      nextPanes.set(paneId, {
        tabs: [tab],
        activeTabId: tab.id,
        runtimeSessionId: action.runtimeSessionId ?? newRuntimeId(),
      });
      return {
        ...state,
        panesById: nextPanes,
        layout: splitLeaf(state.layout, action.paneId, paneId, action.direction, action.side),
        focusedPaneId: paneId,
      };
    }
    case "focusPane":
    case "FOCUS_PANE":
      return state.panesById.has(action.paneId)
        ? { ...state, focusedPaneId: action.paneId }
        : state;
    case "focusTab":
    case "FOCUS_TAB":
      return focusExistingSession(state, action.paneId, action.tabId);
    case "renameTab":
    case "RENAME_TAB": {
      const pane = state.panesById.get(action.paneId);
      if (!pane) return state;
      const nextPanes = new Map(state.panesById);
      nextPanes.set(action.paneId, {
        ...pane,
        tabs: pane.tabs.map((tab) =>
          tab.id === action.tabId ? { ...tab, title: action.title } : tab,
        ),
      });
      return { ...state, panesById: nextPanes };
    }
    case "splitTab":
    case "SPLIT_TAB": {
      const leaves = collectLeaves(state.layout);
      const source = state.panesById.get(action.sourcePaneId);
      const sourceTab = source?.tabs.find((tab) => tab.id === action.sourceTabId);
      const tab = copyTab(sourceTab, action.tab);
      if (leaves.length >= 2) {
        const targetPaneId =
          leaves.find((leafId) => leafId !== state.focusedPaneId) ?? state.focusedPaneId;
        return addTabToPane(state, targetPaneId, tab);
      }
      const paneId = action.newPaneId ?? newPaneId();
      const nextPanes = new Map(state.panesById);
      nextPanes.set(paneId, {
        tabs: [tab],
        activeTabId: tab.id,
        runtimeSessionId: action.runtimeSessionId ?? newRuntimeId(),
      });
      return {
        ...state,
        panesById: nextPanes,
        layout: splitLeaf(state.layout, state.focusedPaneId, paneId, "vertical", "b"),
        focusedPaneId: paneId,
      };
    }
    case "closePane":
    case "CLOSE_PANE": {
      const leaves = collectLeaves(state.layout);
      if (leaves.length <= 1 || !leaves.includes(action.paneId)) return state;
      const nextLayout = removeLeaf(state.layout, action.paneId) ?? state.layout;
      const nextPanes = new Map(state.panesById);
      nextPanes.delete(action.paneId);
      const remaining = leaves.filter((id) => id !== action.paneId);
      return {
        ...state,
        layout: nextLayout,
        panesById: nextPanes,
        focusedPaneId:
          state.focusedPaneId === action.paneId
            ? (remaining[0] ?? state.focusedPaneId)
            : state.focusedPaneId,
      };
    }
    case "setPaneTabs":
    case "SET_PANE_TABS": {
      const pane = state.panesById.get(action.paneId);
      if (!pane) return state;
      const nextPanes = new Map(state.panesById);
      nextPanes.set(action.paneId, { ...pane, tabs: action.tabs });
      return { ...state, panesById: nextPanes };
    }
    case "patchActiveTab":
    case "PATCH_ACTIVE_TAB": {
      const pane = state.panesById.get(action.paneId);
      if (!pane) return state;
      const nextPanes = new Map(state.panesById);
      nextPanes.set(action.paneId, {
        ...pane,
        tabs: pane.tabs.map((tab) =>
          tab.id === pane.activeTabId ? { ...tab, ...action.patch } : tab,
        ),
      });
      return { ...state, panesById: nextPanes };
    }
    case "setComputerOpen":
    case "SET_COMPUTER_OPEN":
      return { ...state, computer: { ...state.computer, open: action.open } };
    case "toggleComputerOpen":
    case "TOGGLE_COMPUTER_OPEN":
      return { ...state, computer: { ...state.computer, open: !state.computer.open } };
    case "setComputerTab":
    case "SET_COMPUTER_TAB":
      return { ...state, computer: { ...state.computer, tab: action.tab } };
    case "setComputerWidth":
    case "SET_COMPUTER_WIDTH":
      return { ...state, computer: { ...state.computer, width: clampComputerWidth(action.width) } };
    case "setBrowserToolEnabled":
    case "SET_BROWSER_TOOL_ENABLED":
      return { ...state, browserToolEnabled: action.enabled };
    case "toggleBrowserTool":
    case "TOGGLE_BROWSER_TOOL":
      return { ...state, browserToolEnabled: !state.browserToolEnabled };
    case "setBrowserUrl":
    case "SET_BROWSER_URL":
      return {
        ...state,
        browserUrl: action.url,
        browserInput: action.input ?? state.browserInput,
      };
    case "setBrowserInput":
    case "SET_BROWSER_INPUT":
      return { ...state, browserInput: action.input };
    case "setGitSummary": {
      const next = new Map(state.gitSummaries);
      if (action.summary) next.set(action.cwd, action.summary);
      else next.delete(action.cwd);
      return { ...state, gitSummaries: next };
    }
    case "deleteGitSummary": {
      const next = new Map(state.gitSummaries);
      next.delete(action.cwd);
      return { ...state, gitSummaries: next };
    }
    case "URL_NAV_REQUESTED": {
      if (state.lastHandledNavKey === action.key) return state;
      if (!action.projectId && !action.sessionId && !action.newSession) return state;

      if (action.projectId) {
        const target = state.projects.find((entry) => entry.id === action.projectId);
        if (!target) return state;
        if (state.selectedProjectId !== target.id || state.agentCwd !== target.path) {
          return {
            ...state,
            selectedProjectId: target.id,
            agentCwd: target.path,
          };
        }
      }

      const marked = { ...state, lastHandledNavKey: action.key };
      if (action.newSession && !action.sessionId) {
        return reducer(marked, { type: "OPEN_NEW_SESSION" });
      }
      if (action.sessionId && action.split) {
        return reducer(marked, { type: "REPLAY_SESSION_IN_SPLIT", piSessionId: action.sessionId });
      }
      if (action.sessionId) {
        return reducer(marked, { type: "REPLAY_SESSION", piSessionId: action.sessionId });
      }
      return marked;
    }
    case "hydrateActiveSessions":
      return action.hasExplicitSessionNav
        ? { ...state, hydrated: true }
        : hydrateSessionSnapshots(state, action.snapshots);
    default:
      return state;
  }
}
