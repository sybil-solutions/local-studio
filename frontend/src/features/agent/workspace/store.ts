import { clampLayoutToLimits, collectLeaves } from "@/features/agent/workspace/layout";
import { cleanSessionTitle, makeFreshTab } from "@/features/agent/messages/helpers";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import type { ToolSelection } from "@/features/agent/tools/types";
import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type {
  PaneId,
  PaneState,
  WorkspaceLayout,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import type { TerminalOwner, TerminalOwnerKind } from "@/features/agent/terminal-owners";

export const PANE_LAYOUT_KEY = "local-studio.agent.paneLayout";
export const PANE_STATE_KEY = "local-studio.agent.paneState";
export const SESSION_PREFS_KEY = "local-studio.agent.sessionPrefs";

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type PersistedPaneRecord = {
  tabs?: unknown[];
  activeTabId?: unknown;
  runtimeSessionId?: unknown;
  kind?: unknown;
  owner?: unknown;
  mountKey?: unknown;
  matchKeys?: unknown;
  cwd?: unknown;
  title?: unknown;
  terminalKind?: unknown;
};

type PersistedPaneState = {
  version: 1;
  layout: WorkspaceLayout;
  focusedPaneId: PaneId;
  panes: Record<string, PersistedPaneRecord>;
};

export type PersistedPaneEntry =
  | { kind?: "chat"; activeTabId: string; tabs: PersistedSessionMeta[] }
  | { kind: "terminal"; owner: TerminalOwner };

export function createInitialState(): WorkspaceState {
  const session = makeFreshTab();
  return {
    sessions: new Map([[session.id, session]]),
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
  "messages" | "error" | "status" | "activeAssistantId"
> & {
  skills?: ComposerSkillRef[];
};

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

export function selectionFromPersistedTab(value: unknown): ToolSelection | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as PersistedTabShape & {
    promptTemplates?: ToolSelection["promptTemplates"];
    plugins?: ToolSelection["plugins"];
  };
  const skills = Array.isArray(tab.skills) ? tab.skills : [];
  const promptTemplates = Array.isArray(tab.promptTemplates) ? tab.promptTemplates : [];
  const plugins = Array.isArray(tab.plugins) ? tab.plugins : [];
  if (skills.length === 0 && promptTemplates.length === 0 && plugins.length === 0) {
    return null;
  }
  return { skills, promptTemplates, plugins };
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
    const selection = selectionFromPersistedTab(raw);
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

function terminalOwnerKind(value: unknown): TerminalOwnerKind {
  return value === "project" ? "project" : "session";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function restoreTerminalOwner(pane: PersistedPaneRecord): TerminalOwner | null {
  const source =
    pane.owner && typeof pane.owner === "object" ? (pane.owner as PersistedPaneRecord) : pane;
  const mountKey = typeof source.mountKey === "string" ? source.mountKey.trim() : "";
  if (!mountKey) return null;
  const matchKeys = stringArray(source.matchKeys);
  return {
    mountKey,
    matchKeys: [...new Set([mountKey, ...matchKeys])],
    cwd: typeof source.cwd === "string" ? source.cwd : null,
    title: typeof source.title === "string" && source.title.trim() ? source.title : "Terminal",
    kind: terminalOwnerKind(source.terminalKind ?? source.kind),
  };
}

export function restorePersistedPaneState(raw: string): RestoredPaneState | null {
  const parsed = parsePersistedPaneState(raw);
  if (!parsed) return null;

  const persistedPanes = parsed.panes && typeof parsed.panes === "object" ? parsed.panes : {};
  const layout = clampLayoutToLimits(parsed.layout as WorkspaceLayout, () => false);
  const leaves = collectLeaves(layout);
  if (leaves.length === 0) return null;

  const panesById = new Map<PaneId, PaneState>();
  const sessions = new Map<SessionId, Session>();
  const selections = new Map<SessionId, ToolSelection>();
  const legacyRuntimeKeys = new Map<SessionId, string>();

  for (const paneId of leaves) {
    const pane = persistedPanes[paneId] ?? {};
    if (pane.kind === "terminal") {
      const owner = restoreTerminalOwner(pane);
      if (!owner) return null;
      panesById.set(paneId, { kind: "terminal", owner });
      continue;
    }
    const rawTabs = Array.isArray(pane.tabs) ? pane.tabs : [];
    const restored = restoreTabsWithSelections(rawTabs);
    const activeSessionId = activePersistedTabId(pane, restored.tabs);
    const session = restored.tabs.find((tab) => tab.id === activeSessionId) ?? restored.tabs[0];
    sessions.set(session.id, session);
    const selection = restored.selections.get(session.id);
    if (selection) selections.set(session.id, selection);
    const legacyRuntimeKey = restored.legacyRuntimeKeys.get(session.id);
    if (legacyRuntimeKey) legacyRuntimeKeys.set(session.id, legacyRuntimeKey);
    panesById.set(paneId, { kind: "chat", sessionId: session.id });
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
    input: tab.input,
    tokenStats: tab.tokenStats,
    usedSkills: tab.usedSkills,
    lastEventSeq: tab.lastEventSeq,
    queue: tab.queue,
  };
  if (selection) {
    return {
      ...base,
      ...(selection.skills.length > 0 ? { skills: selection.skills } : {}),
      ...(selection.promptTemplates.length > 0
        ? { promptTemplates: selection.promptTemplates }
        : {}),
      ...(selection.plugins.length > 0 ? { plugins: selection.plugins } : {}),
    };
  }
  return base;
}

export { reducer } from "@/features/agent/workspace/reducer";
