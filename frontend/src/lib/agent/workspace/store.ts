import { collectLeaves } from "@/lib/agent/workspace/layout";
import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
  type ActiveSessionPrefs,
} from "@/lib/agent/active-sessions";
import { cleanSessionTitle, makeFreshTab, newRuntimeId } from "@/lib/agent/session/helpers";
import type { Session, SessionId } from "@/lib/agent/sessions/types";
import type { ToolSelection } from "@/lib/agent/tools/types";
import type { ComposerPluginRef, ComposerSkillRef } from "@/lib/agent/composer-context";
import type { PaneId, PaneState, WorkspaceLayout, WorkspaceState } from "./types";
// Computer/browser tool state moved to lib/agent/tools/ — workspace no longer
// owns or mutates it.

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
          sessionId: session.id,
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

export type PersistedSessionMeta = Omit<Session, "messages" | "error"> & {
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
    title: cleanSessionTitle(tab.title) || fallback.title,
    // The canonical session log is the transcript source of truth. Legacy
    // pane-state entries may still contain messages, but restoring them here
    // would put large reasoning/tool payloads back onto the renderer hot path.
    messages: [],
    status: typeof tab.status === "string" ? tab.status : "idle",
    error: "",
    startedAt: typeof tab.startedAt === "string" ? tab.startedAt : undefined,
    input: typeof tab.input === "string" ? tab.input : "",
    queue: Array.isArray(tab.queue) ? tab.queue : undefined,
    activeAssistantId:
      typeof tab.activeAssistantId === "string" ? tab.activeAssistantId : undefined,
    lastEventSeq: typeof tab.lastEventSeq === "number" ? tab.lastEventSeq : undefined,
    usedSkills: Array.isArray(tab.usedSkills) ? (tab.usedSkills as ComposerSkillRef[]) : undefined,
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
  const tab = value as PersistedTabShape & {
    promptTemplates?: ToolSelection["promptTemplates"];
    extensionOverrides?: ToolSelection["extensionOverrides"];
  };
  const plugins = Array.isArray(tab.plugins) ? tab.plugins : [];
  const skills = Array.isArray(tab.skills) ? tab.skills : [];
  const promptTemplates = Array.isArray(tab.promptTemplates) ? tab.promptTemplates : [];
  const extensionOverrides = Array.isArray(tab.extensionOverrides) ? tab.extensionOverrides : [];
  if (
    plugins.length === 0 &&
    skills.length === 0 &&
    promptTemplates.length === 0 &&
    extensionOverrides.length === 0
  ) {
    return null;
  }
  return { plugins, skills, promptTemplates, extensionOverrides };
}

export type RestoredPaneState = {
  layout: WorkspaceLayout;
  panesById: Map<PaneId, PaneState>;
  sessions: Map<SessionId, Session>;
  /** Plugin/skill selections rebuilt from the persisted tab records. */
  selections: Map<SessionId, ToolSelection>;
  focusedPaneId: PaneId;
};

function parsePersistedPaneState(raw: string): Partial<PersistedPaneState> | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPaneState>;
    return parsed.layout && typeof parsed.layout === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function restoreTabsWithSelections(rawTabs: unknown[]): {
  tabs: Session[];
  selections: Map<SessionId, ToolSelection>;
} {
  const tabs: Session[] = [];
  const selections = new Map<SessionId, ToolSelection>();
  for (const raw of rawTabs) {
    const session = normalizePersistedTab(raw);
    if (!session) continue;
    tabs.push(session);
    const selection = selectionFromPersistedTab(raw);
    if (selection) selections.set(session.id, selection);
  }
  return { tabs: tabs.length > 0 ? tabs : [makeFreshTab()], selections };
}

function activePersistedTabId(
  pane: PersistedPaneState["panes"][string],
  tabs: Session[],
): SessionId {
  const activeTabId = pane.activeTabId;
  if (typeof activeTabId === "string" && tabs.some((tab) => tab.id === activeTabId)) {
    return activeTabId;
  }
  return tabs[0].id;
}

function persistedRuntimeSessionId(pane: PersistedPaneState["panes"][string]): string {
  const runtimeSessionId = pane.runtimeSessionId;
  return typeof runtimeSessionId === "string" && runtimeSessionId.trim()
    ? runtimeSessionId
    : newRuntimeId();
}

function focusedPersistedPaneId(focusedPaneId: unknown, leaves: PaneId[]): PaneId {
  return typeof focusedPaneId === "string" && leaves.includes(focusedPaneId)
    ? focusedPaneId
    : leaves[0];
}

export function restorePersistedPaneState(raw: string): RestoredPaneState | null {
  const parsed = parsePersistedPaneState(raw);
  if (!parsed) return null;

  const layout = parsed.layout as WorkspaceLayout;
  const leaves = collectLeaves(layout);
  if (leaves.length === 0) return null;

  const persistedPanes = parsed.panes && typeof parsed.panes === "object" ? parsed.panes : {};
  const panesById = new Map<PaneId, PaneState>();
  const sessions = new Map<SessionId, Session>();
  const selections = new Map<SessionId, ToolSelection>();

  for (const paneId of leaves) {
    const pane = persistedPanes[paneId] ?? {};
    const rawTabs = Array.isArray(pane.tabs) ? pane.tabs : [];
    const restored = restoreTabsWithSelections(rawTabs);
    const activeSessionId = activePersistedTabId(pane, restored.tabs);
    const session = restored.tabs.find((tab) => tab.id === activeSessionId) ?? restored.tabs[0];
    sessions.set(session.id, session);
    const selection = restored.selections.get(session.id);
    if (selection) selections.set(session.id, selection);
    panesById.set(paneId, {
      sessionId: session.id,
      runtimeSessionId: persistedRuntimeSessionId(pane),
    });
  }

  return {
    layout,
    panesById,
    sessions,
    selections,
    focusedPaneId: focusedPersistedPaneId(parsed.focusedPaneId, leaves),
  };
}

/**
 * Serialize only durable session metadata. Transcripts, reasoning, tool
 * payloads, attachment bodies, and preview data belong to canonical session
 * storage or runtime memory, never pane-state localStorage.
 */
export function sessionMetaForPersistence(
  tab: Session,
  selection?: ToolSelection,
): PersistedSessionMeta {
  const base: PersistedSessionMeta = {
    id: tab.id,
    runtimeSessionId: tab.runtimeSessionId,
    piSessionId: tab.piSessionId,
    projectId: tab.projectId,
    cwd: tab.cwd,
    modelId: tab.modelId,
    title: cleanSessionTitle(tab.title) || "New session",
    status: tab.status,
    startedAt: tab.startedAt,
    input: tab.input,
    tokenStats: tab.tokenStats,
    usedSkills: tab.usedSkills,
    activeAssistantId: tab.activeAssistantId,
    lastEventSeq: tab.lastEventSeq,
    queue: tab.queue,
  };
  if (selection) {
    return {
      ...base,
      ...(selection.plugins.length > 0 ? { plugins: selection.plugins } : {}),
      ...(selection.skills.length > 0 ? { skills: selection.skills } : {}),
      ...(selection.promptTemplates.length > 0
        ? { promptTemplates: selection.promptTemplates }
        : {}),
      ...(selection.extensionOverrides.length > 0
        ? { extensionOverrides: selection.extensionOverrides }
        : {}),
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
          title:
            cleanSessionTitle(typeof entry.title === "string" ? entry.title : null) ||
            "Loading session",
          status: typeof entry.status === "string" ? entry.status : "idle",
          active: entry.active === true,
          startedAt: typeof entry.startedAt === "string" ? entry.startedAt : undefined,
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
          plugins: Array.isArray(entry.plugins)
            ? (entry.plugins as ComposerPluginRef[])
            : undefined,
          skills: Array.isArray(entry.skills) ? (entry.skills as ComposerSkillRef[]) : undefined,
          usedSkills: Array.isArray(entry.usedSkills)
            ? (entry.usedSkills as ComposerSkillRef[])
            : undefined,
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

export { reducer } from "./reducer";
