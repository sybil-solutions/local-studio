import { clampLayoutToLimits, collectLeaves, removeLeaf } from "@/features/agent/workspace/layout";
import { cleanSessionTitle, makeFreshTab } from "@/features/agent/messages/helpers";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import type { ToolSelection } from "@/features/agent/tools/types";
import {
  persistedTabFieldsFromSelection,
  toolSelectionFromPersistedTab,
  type PersistedToolSelectionFields,
} from "@/features/agent/tools/selection-persistence";
import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type {
  PaneId,
  PaneState,
  WorkspaceLayout,
  WorkspaceState,
} from "@/features/agent/workspace/types";

export const PANE_LAYOUT_KEY = "local-studio.agent.paneLayout";
export const PANE_STATE_KEY = "local-studio.agent.paneState";
export const SESSION_PREFS_KEY = "local-studio.agent.sessionPrefs";

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type PersistedPaneRecord = {
  tabs?: unknown[];
  activeTabId?: unknown;
  runtimeSessionId?: unknown;
  kind?: unknown;
};

type PersistedPaneState = {
  version: 1;
  layout: WorkspaceLayout;
  focusedPaneId: PaneId;
  panes: Record<string, PersistedPaneRecord>;
};

export type PersistedPaneEntry = { activeTabId: string; tabs: PersistedSessionMeta[] };

export function createInitialState(): WorkspaceState {
  const session = makeFreshTab();
  return {
    sessions: new Map([[session.id, session]]),
    sessionDrafts: new Map(),
    models: [],
    selectedModel: "",
    modelsLoading: true,
    layout: { kind: "leaf", paneId: "p-init" },
    panesById: new Map([["p-init", { sessionId: session.id }]]),
    focusedPaneId: "p-init",
    setupWarning: "",
    error: "",
    hydrated: false,
    lastHandledNavKey: "",
    lastHandledNavIntent: "",
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
  skills?: ComposerSkillRef[];
  runtimeSessionId?: unknown;
};

export type PersistedSessionMeta = Omit<
  Session,
  "messages" | "error" | "status" | "activeAssistantId" | "input"
> &
  PersistedToolSelectionFields;

export function normalizePersistedTab(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as PersistedTabShape;
  if (typeof tab.id !== "string") return null;
  const fallback = makeFreshTab();
  const { runtimeSessionId: _legacyRuntimeKey, ...persisted } = tab;
  return {
    ...fallback,
    ...persisted,
    id: tab.id,
    piSessionId: typeof tab.piSessionId === "string" ? tab.piSessionId : null,
    title: cleanSessionTitle(tab.title) || fallback.title,
    messages: [],
    status: "idle",
    error: "",
    startedAt: typeof tab.startedAt === "string" ? tab.startedAt : undefined,
    input: typeof tab.input === "string" ? tab.input : "",
    queue: Array.isArray(tab.queue) ? tab.queue : undefined,
    activeAssistantId: undefined,
    lastEventSeq: typeof tab.lastEventSeq === "number" ? tab.lastEventSeq : undefined,
    usedSkills: Array.isArray(tab.usedSkills) ? (tab.usedSkills as ComposerSkillRef[]) : undefined,
  };
}

export function legacyRuntimeKeyFromPersistedTab(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as PersistedTabShape;
  return typeof tab.runtimeSessionId === "string" && tab.runtimeSessionId.trim()
    ? tab.runtimeSessionId.trim()
    : null;
}

export type RestoredPaneState = {
  layout: WorkspaceLayout;
  panesById: Map<PaneId, PaneState>;
  sessions: Map<SessionId, Session>;
  selections: Map<SessionId, ToolSelection>;
  legacyRuntimeKeys: Map<SessionId, string>;
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
  legacyRuntimeKeys: Map<SessionId, string>;
} {
  const tabs: Session[] = [];
  const selections = new Map<SessionId, ToolSelection>();
  const legacyRuntimeKeys = new Map<SessionId, string>();
  for (const raw of rawTabs) {
    const session = normalizePersistedTab(raw);
    if (!session) continue;
    tabs.push(session);
    const selection = toolSelectionFromPersistedTab(raw);
    if (selection) selections.set(session.id, selection);
    const legacyRuntimeKey = legacyRuntimeKeyFromPersistedTab(raw);
    if (legacyRuntimeKey && legacyRuntimeKey !== session.id) {
      legacyRuntimeKeys.set(session.id, legacyRuntimeKey);
    }
  }
  return { tabs: tabs.length > 0 ? tabs : [makeFreshTab()], selections, legacyRuntimeKeys };
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

function focusedPersistedPaneId(focusedPaneId: unknown, leaves: PaneId[]): PaneId {
  return typeof focusedPaneId === "string" && leaves.includes(focusedPaneId)
    ? focusedPaneId
    : leaves[0];
}

function removeLegacyTerminalPanes(
  layout: WorkspaceLayout,
  panes: Record<string, PersistedPaneRecord>,
): WorkspaceLayout | null {
  let next: WorkspaceLayout | null = layout;
  for (const paneId of collectLeaves(layout)) {
    if (panes[paneId]?.kind !== "terminal" || !next) continue;
    next = removeLeaf(next, paneId);
  }
  return next;
}

export function restorePersistedPaneState(raw: string): RestoredPaneState | null {
  const parsed = parsePersistedPaneState(raw);
  if (!parsed) return null;

  const persistedPanes = parsed.panes && typeof parsed.panes === "object" ? parsed.panes : {};
  const chatLayout = removeLegacyTerminalPanes(parsed.layout as WorkspaceLayout, persistedPanes);
  if (!chatLayout) return null;
  const layout = clampLayoutToLimits(chatLayout, () => false);
  const leaves = collectLeaves(layout);
  if (leaves.length === 0) return null;

  const panesById = new Map<PaneId, PaneState>();
  const sessions = new Map<SessionId, Session>();
  const selections = new Map<SessionId, ToolSelection>();
  const legacyRuntimeKeys = new Map<SessionId, string>();

  for (const paneId of leaves) {
    const pane = persistedPanes[paneId] ?? {};
    const rawTabs = Array.isArray(pane.tabs) ? pane.tabs : [];
    const restored = restoreTabsWithSelections(rawTabs);
    const activeSessionId = activePersistedTabId(pane, restored.tabs);
    const session = restored.tabs.find((tab) => tab.id === activeSessionId) ?? restored.tabs[0];
    sessions.set(session.id, session);
    const selection = restored.selections.get(session.id);
    if (selection) selections.set(session.id, selection);
    const legacyRuntimeKey = restored.legacyRuntimeKeys.get(session.id);
    if (legacyRuntimeKey) legacyRuntimeKeys.set(session.id, legacyRuntimeKey);
    panesById.set(paneId, { sessionId: session.id });
  }

  return {
    layout,
    panesById,
    sessions,
    selections,
    legacyRuntimeKeys,
    focusedPaneId: focusedPersistedPaneId(parsed.focusedPaneId, leaves),
  };
}

export function sessionMetaForPersistence(
  tab: Session,
  selection?: ToolSelection,
): PersistedSessionMeta {
  const base: PersistedSessionMeta = {
    id: tab.id,
    piSessionId: tab.piSessionId,
    projectId: tab.projectId,
    cwd: tab.cwd,
    modelId: tab.modelId,
    title: cleanSessionTitle(tab.title) || "New session",
    startedAt: tab.startedAt,
    tokenStats: tab.tokenStats,
    usedSkills: tab.usedSkills,
    lastEventSeq: tab.lastEventSeq,
    queue: tab.queue,
  };
  if (selection) {
    return { ...base, ...persistedTabFieldsFromSelection(selection) };
  }
  return base;
}

export { reducer } from "@/features/agent/workspace/reducer";
