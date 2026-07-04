import { isRecord } from "@/lib/guards";
import { collectLeaves } from "@/features/agent/workspace/layout";
import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
  type ActiveSessionPrefs,
} from "@/features/agent/active-sessions";
import { cleanSessionTitle, makeFreshTab, newId } from "@/features/agent/messages/helpers";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import type { ToolSelection } from "@/features/agent/tools/types";
import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type {
  PaneId,
  PaneState,
  TerminalPaneState,
  WorkspaceLayout,
  WorkspaceState,
} from "@/features/agent/workspace/types";

export const PANE_LAYOUT_KEY = "local-studio.agent.paneLayout";
export const PANE_STATE_KEY = "local-studio.agent.paneState";
export const ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY = "local-studio.agent.activeSessions.snapshot";
export const SESSION_PREFS_KEY = "local-studio.agent.sessionPrefs";

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type PersistedPaneRecord = {
  tabs?: unknown[];
  activeTabId?: unknown;
  /** Legacy pane-level runtime id written by older builds; ignored. */
  runtimeSessionId?: unknown;
  kind?: unknown;
  mountKey?: unknown;
  cwd?: unknown;
  title?: unknown;
  ownerSessionId?: unknown;
  ownerPiSessionId?: unknown;
};

type PersistedPaneState = {
  version: 1;
  layout: WorkspaceLayout;
  focusedPaneId: PaneId;
  panes: Record<string, PersistedPaneRecord>;
};

export type PersistedPaneEntry =
  | TerminalPaneState
  | { activeTabId: string; tabs: PersistedSessionMeta[] };

function terminalPaneFromPersisted(pane: PersistedPaneRecord): TerminalPaneState | null {
  if (pane.kind !== "terminal" || typeof pane.mountKey !== "string") return null;
  return {
    kind: "terminal",
    mountKey: pane.mountKey,
    cwd: typeof pane.cwd === "string" ? pane.cwd : null,
    title: typeof pane.title === "string" ? pane.title : "Terminal",
    ownerSessionId: typeof pane.ownerSessionId === "string" ? pane.ownerSessionId : null,
    ownerPiSessionId: typeof pane.ownerPiSessionId === "string" ? pane.ownerPiSessionId : null,
  };
}

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
    paneStateRestored: false,
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
  /** Legacy: pre-alias runtime key persisted by older builds. Read-only. */
  runtimeSessionId?: unknown;
};

export type PersistedSessionMeta = Omit<Session, "messages" | "error"> & {
  skills?: ComposerSkillRef[];
};

export function normalizePersistedTab(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as PersistedTabShape;
  if (typeof tab.id !== "string") return null;
  const fallback = makeFreshTab();
  // Strip the legacy runtime key from the spread; its value is surfaced via
  // legacyRuntimeKeyFromPersistedTab for the controller's connection-key seed.
  const { runtimeSessionId: _legacyRuntimeKey, ...persisted } = tab;
  return {
    ...fallback,
    ...persisted,
    id: tab.id,
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
 * Legacy read: the pre-alias runtime key a persisted tab was running under, if
 * any. Used once on hydration to seed the runtime controller's connection-key
 * override so a session RUNNING across the upgrade reattaches to its rt-* key.
 */
export function legacyRuntimeKeyFromPersistedTab(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as PersistedTabShape;
  return typeof tab.runtimeSessionId === "string" && tab.runtimeSessionId.trim()
    ? tab.runtimeSessionId.trim()
    : null;
}

/**
 * Pull the per-session tool selection out of a persisted tab record. Returns
 * null when the persisted shape didn't carry skills/templates.
 * `restorePersistedPaneState` aggregates these so the workspace can rehydrate
 * the tools subsystem after mount.
 */
export function selectionFromPersistedTab(value: unknown): ToolSelection | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as PersistedTabShape & {
    promptTemplates?: ToolSelection["promptTemplates"];
  };
  const skills = Array.isArray(tab.skills) ? tab.skills : [];
  const promptTemplates = Array.isArray(tab.promptTemplates) ? tab.promptTemplates : [];
  if (skills.length === 0 && promptTemplates.length === 0) {
    return null;
  }
  return { skills, promptTemplates };
}

export type RestoredPaneState = {
  layout: WorkspaceLayout;
  panesById: Map<PaneId, PaneState>;
  sessions: Map<SessionId, Session>;
  selections: Map<SessionId, ToolSelection>;
  /** Legacy pre-alias runtime keys, by session id (connection-key seeds). */
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
  const legacyRuntimeKeys = new Map<SessionId, string>();

  for (const paneId of leaves) {
    const pane = persistedPanes[paneId] ?? {};
    const terminalPane = terminalPaneFromPersisted(pane);
    if (terminalPane) {
      panesById.set(paneId, terminalPane);
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
    // The persisted pane-level runtimeSessionId is ignored: the session's own
    // id is the durable runtime identity, so a crash/reload reattaches to the
    // still-running runtime instead of minting a fresh orphan.
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
      ...(selection.skills.length > 0 ? { skills: selection.skills } : {}),
      ...(selection.promptTemplates.length > 0
        ? { promptTemplates: selection.promptTemplates }
        : {}),
    };
  }
  return base;
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
          // Legacy read: pre-alias entries carried the runtime key their
          // session was running under; kept so the upgrade seed can reattach.
          ...(typeof entry.runtimeSessionId === "string" && entry.runtimeSessionId.trim()
            ? { runtimeSessionId: entry.runtimeSessionId.trim() }
            : {}),
          piSessionId: piSessionId || null,
          modelId: typeof entry.modelId === "string" ? entry.modelId : undefined,
          title:
            cleanSessionTitle(typeof entry.title === "string" ? entry.title : null) ||
            "Loading session",
          status: typeof entry.status === "string" ? entry.status : "idle",
          focused: entry.focused === true,
          startedAt: typeof entry.startedAt === "string" ? entry.startedAt : undefined,
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
          skills: Array.isArray(entry.skills) ? (entry.skills as ComposerSkillRef[]) : undefined,
          usedSkills: Array.isArray(entry.usedSkills)
            ? (entry.usedSkills as ComposerSkillRef[])
            : undefined,
        };
      })
      .filter(
        (entry) =>
          !prefs[entry.piSessionId ?? ""]?.hidden &&
          Boolean(entry.cwd) &&
          Boolean(entry.paneId) &&
          Boolean(entry.tabId),
      );
  } catch {
    return [];
  }
}

// One id per app instance (window), minted lazily on the first client-side
// write. Stamped onto every entry this instance persists so the merge can
// authoritatively replace its own entries (dropping closed sessions) while
// preserving entries written by other windows.
let activeSessionsWriterId: string | null = null;
function ownActiveSessionsWriterId(): string {
  return (activeSessionsWriterId ??= newId("writer"));
}

// Hard ceiling on the persisted snapshot so the blob can never grow unbounded
// over a long-lived app session (legacy/other-window entries included). Entries
// are sorted most-recent-first by the merge, so the cap keeps the freshest ones.
const MAX_PERSISTED_ACTIVE_SESSIONS = 50;

export function persistActiveAgentSessions(
  sessions: ActiveAgentSessionSnapshot[],
  storage: WorkspaceStorage | null = defaultWorkspaceStorage(),
): void {
  if (!storage) return;
  const prefs = loadSessionPrefs(storage);
  const writerId = ownActiveSessionsWriterId();
  const stamped = sessions.map((session) => ({ ...session, writerId }));
  const merged = mergeActiveAgentSessions(
    loadPersistedActiveAgentSessions(storage),
    stamped,
    prefs,
    writerId,
  ).slice(0, MAX_PERSISTED_ACTIVE_SESSIONS);
  if (merged.length > 0) {
    storage.setItem(ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY, JSON.stringify(merged));
  } else {
    storage.removeItem(ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY);
  }
}

export { reducer } from "@/features/agent/workspace/reducer";
