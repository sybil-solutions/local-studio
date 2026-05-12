import { collectLeaves } from "@/lib/agent/workspace/layout";
import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
  type ActiveSessionPrefs,
} from "@/lib/agent/active-sessions";
import { makeFreshTab, newRuntimeId } from "@/lib/agent/session/helpers";
import type { Project } from "@/lib/agent/projects/types";
import type { Session, SessionId } from "@/lib/agent/sessions/types";
import type { ToolSelection } from "@/lib/agent/tools/types";
import type { ComposerPluginRef, ComposerSkillRef } from "@/lib/agent/composer-context";
import type {
  AgentModel,
  PaneId,
  PaneState,
  WorkspaceAction,
  WorkspaceLayout,
  WorkspaceState,
} from "./types";
// Computer/browser tool state moved to lib/agent/tools/ — workspace no longer
// owns or mutates it.
import {
  applyUrlNavigation,
  closePane,
  focusPane,
  focusTab,
  openNewSessionInFocusedPane,
  openSessionPayloadInPane,
  patchActiveTab,
  replaySessionInFocusedPane,
  replaySessionInSplitPane,
  restorePaneState as restorePaneWorkspaceState,
  setPaneTabs,
  setWorkspaceLayout,
  setWorkspaceSplitRatio,
  splitPaneWithPayload,
  splitTabIntoNewPane,
  renameTab,
} from "./pane-controller";

export { isEmptyStarterTab } from "./pane-controller";

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

export function createInitialState(): WorkspaceState {
  const session = makeFreshTab();
  return {
    sessions: new Map([[session.id, session]]),
    models: [],
    selectedModel: "",
    modelsLoading: true,
    layout: { kind: "leaf", paneId: "p-init" },
    panesById: new Map([
      [
        "p-init",
        {
          sessionIds: [session.id],
          activeSessionId: session.id,
          runtimeSessionId: newRuntimeId(),
        },
      ],
    ]),
    focusedPaneId: "p-init",
    setupWarning: "",
    error: "",
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

type PersistedTabShape = Partial<Session> & {
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
};

export function normalizePersistedTab(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as PersistedTabShape;
  if (typeof tab.id !== "string" || typeof tab.runtimeSessionId !== "string") return null;
  const fallback = makeFreshTab();
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
  };
}

/**
 * Pull the per-session tool selection out of a persisted tab record. Returns
 * null when the persisted shape didn't carry plugins/skills (legacy or fresh).
 * `restorePersistedPaneState` aggregates these so the workspace can rehydrate
 * the tools subsystem after mount.
 */
export function selectionFromPersistedTab(value: unknown): ToolSelection | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as PersistedTabShape;
  const plugins = Array.isArray(tab.plugins) ? tab.plugins : [];
  const skills = Array.isArray(tab.skills) ? tab.skills : [];
  if (plugins.length === 0 && skills.length === 0) return null;
  return { plugins, skills };
}

export type RestoredPaneState = {
  layout: WorkspaceLayout;
  panesById: Map<PaneId, PaneState>;
  sessions: Map<SessionId, Session>;
  /** Plugin/skill selections rebuilt from the persisted tab records. */
  selections: Map<SessionId, ToolSelection>;
  focusedPaneId: PaneId;
};

export function restorePersistedPaneState(raw: string): RestoredPaneState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPaneState>;
    if (!parsed.layout || typeof parsed.layout !== "object") return null;
    const leaves = collectLeaves(parsed.layout as WorkspaceLayout);
    if (leaves.length === 0) return null;
    const panes = parsed.panes && typeof parsed.panes === "object" ? parsed.panes : {};
    const panesById = new Map<PaneId, PaneState>();
    const sessions = new Map<SessionId, Session>();
    const selections = new Map<SessionId, ToolSelection>();
    for (const paneId of leaves) {
      const pane = panes[paneId] ?? {};
      const rawTabs = Array.isArray(pane.tabs) ? pane.tabs : [];
      const restoredTabs: Session[] = [];
      for (const raw of rawTabs) {
        const session = normalizePersistedTab(raw);
        if (!session) continue;
        restoredTabs.push(session);
        const selection = selectionFromPersistedTab(raw);
        if (selection) selections.set(session.id, selection);
      }
      const tabs = restoredTabs.length > 0 ? restoredTabs : [makeFreshTab()];
      for (const session of tabs) sessions.set(session.id, session);
      const activeSessionId =
        typeof pane.activeTabId === "string" && tabs.some((tab) => tab.id === pane.activeTabId)
          ? pane.activeTabId
          : tabs[0].id;
      panesById.set(paneId, {
        sessionIds: tabs.map((tab) => tab.id),
        activeSessionId,
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
    return {
      layout: parsed.layout as WorkspaceLayout,
      panesById,
      sessions,
      selections,
      focusedPaneId,
    };
  } catch {
    return null;
  }
}

/**
 * Serialize a session for persistence. Tool selection (plugins/skills) is
 * embedded back into the persisted tab so older clients keep loading; the
 * runtime model keeps them in the tools subsystem.
 */
export function tabForPersistence(
  tab: Session,
  selection?: ToolSelection,
): Session & {
  plugins?: ComposerPluginRef[];
  skills?: ComposerSkillRef[];
} {
  const base: Session = {
    ...tab,
    messages: tab.messages.slice(-80),
    status: tab.status,
    error: "",
  };
  if (selection) {
    return {
      ...base,
      ...(selection.plugins.length > 0 ? { plugins: selection.plugins } : {}),
      ...(selection.skills.length > 0 ? { skills: selection.skills } : {}),
    };
  }
  return base;
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
            ? (entry.plugins as ComposerPluginRef[])
            : undefined,
          skills: Array.isArray(entry.skills) ? (entry.skills as ComposerSkillRef[]) : undefined,
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

export function tabFromSnapshot(session: ActiveAgentSessionSnapshot): Session {
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
    const tabs = restored.length > 0 ? restored : [makeFreshTab()];
    for (const session of tabs) sessions.set(session.id, session);
    const activeSessionId = group.find((session) => session.active)?.tabId || tabs[0]?.id;
    panesById.set(paneId, {
      sessionIds: tabs.map((tab) => tab.id),
      activeSessionId,
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

export function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
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
    case "setLayout":
      return setWorkspaceLayout(state, { layout: action.layout });
    case "setSplitRatio":
      return setWorkspaceSplitRatio(state, { path: action.path, ratio: action.ratio });
    case "restorePaneState":
      return restorePaneWorkspaceState(state, action);
    case "openNewSession":
      return openNewSessionInFocusedPane(state, {
        project: action.project,
        tab: action.tab,
        paneId: action.paneId,
        runtimeSessionId: action.runtimeSessionId,
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
    case "focusPane":
      return focusPane(state, { paneId: action.paneId });
    case "focusTab":
      return focusTab(state, { paneId: action.paneId, tabId: action.tabId });
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
    case "closePane":
      return closePane(state, { paneId: action.paneId });
    case "setPaneTabs":
      return setPaneTabs(state, { paneId: action.paneId, tabs: action.tabs });
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
    case "hydrateActiveSessions":
      return action.hasExplicitSessionNav
        ? { ...state, hydrated: true }
        : hydrateSessionSnapshots(state, action.snapshots, action.projects);
    default:
      return state;
  }
}
