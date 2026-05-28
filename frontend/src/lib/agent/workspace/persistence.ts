import { collectLeaves } from "@/lib/agent/workspace/layout";
import type { ActiveAgentSessionSnapshot } from "@/lib/agent/active-sessions";
import type { Session, SessionId, SessionsMap } from "@/lib/agent/sessions/types";
import type { ToolSelection } from "@/lib/agent/tools/types";
import type { PaneId, PaneState, WorkspaceLayout, WorkspaceState } from "./types";

import {
  PANE_LAYOUT_KEY,
  PANE_STATE_KEY,
  persistActiveAgentSessions,
  restorePersistedPaneState,
  sessionMetaForPersistence,
  type WorkspaceStorage,
} from "./store";
import { makeFreshTab, newRuntimeId } from "@/lib/agent/session/helpers";

const SESSIONS_COLLAPSED_KEY = "vllm-studio.agent.sessionsCollapsed";
const SESSIONS_COLLAPSED_CLEANED_KEY = "vllm-studio.agent.sessionsCollapsedCleaned";

function readStorage(storage: WorkspaceStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function setStorage(storage: WorkspaceStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore quota/private-mode failures; workspace state remains in memory.
  }
}

function removeStorage(storage: WorkspaceStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage failures; migrations are best-effort.
  }
}

function restoreLegacyLayout(rawLayout: string): {
  layout: WorkspaceLayout;
  panesById: Map<PaneId, PaneState>;
  sessions: SessionsMap;
  focusedPaneId: PaneId;
} | null {
  try {
    const layout = JSON.parse(rawLayout) as WorkspaceLayout;
    if (!layout || typeof layout !== "object") return null;
    const leaves = collectLeaves(layout);
    if (leaves.length === 0) return null;
    const panesById = new Map<PaneId, PaneState>();
    const sessions = new Map<SessionId, Session>();
    for (const paneId of leaves) {
      const session = makeFreshTab();
      sessions.set(session.id, session);
      panesById.set(paneId, {
        sessionId: session.id,
        runtimeSessionId: newRuntimeId(),
      });
    }
    return { layout, panesById, sessions, focusedPaneId: leaves[0] };
  } catch {
    return null;
  }
}

function migrateStorage(storage: WorkspaceStorage): void {
  if (!readStorage(storage, SESSIONS_COLLAPSED_CLEANED_KEY)) {
    removeStorage(storage, SESSIONS_COLLAPSED_KEY);
    setStorage(storage, SESSIONS_COLLAPSED_CLEANED_KEY, "1");
  }
  // Tool storage migrations are owned by lib/agent/tools/persistence.ts
  // (`migrateToolStorage`) — ToolsProvider runs them on mount.
}

export type LoadedFromStorage = {
  workspace: Partial<WorkspaceState>;
  /** Per-session tool selections recovered from the persisted shape. */
  selections: Map<SessionId, ToolSelection>;
};

export function loadInitialFromStorage(storage: WorkspaceStorage): LoadedFromStorage {
  migrateStorage(storage);

  const rawState = readStorage(storage, PANE_STATE_KEY);
  const restoredState = rawState ? restorePersistedPaneState(rawState) : null;
  if (restoredState) {
    const { selections, ...workspace } = restoredState;
    return { workspace, selections };
  }

  const rawLayout = readStorage(storage, PANE_LAYOUT_KEY);
  const restoredLayout = rawLayout ? restoreLegacyLayout(rawLayout) : null;
  return { workspace: restoredLayout ?? {}, selections: new Map() };
}

export function writePaneState(
  storage: WorkspaceStorage,
  state: WorkspaceState,
  selectionFor: (sessionId: SessionId) => ToolSelection | null = () => null,
): void {
  // Denormalize on write for back-compat with the old persisted pane tabs
  // format. The runtime model keeps one visible session per pane.
  const panes: Record<
    string,
    {
      activeTabId: string;
      runtimeSessionId: string;
      tabs: ReturnType<typeof sessionMetaForPersistence>[];
    }
  > = {};
  for (const [paneId, pane] of state.panesById.entries()) {
    const session = state.sessions.get(pane.sessionId);
    const tabs = session
      ? [sessionMetaForPersistence(session, selectionFor(session.id) ?? undefined)]
      : [];
    panes[paneId] = {
      activeTabId: pane.sessionId,
      runtimeSessionId: pane.runtimeSessionId,
      tabs,
    };
  }
  setStorage(
    storage,
    PANE_STATE_KEY,
    JSON.stringify({ version: 1, layout: state.layout, focusedPaneId: state.focusedPaneId, panes }),
  );
  setStorage(storage, PANE_LAYOUT_KEY, JSON.stringify(state.layout));
}

export function writeActiveSessions(
  storage: WorkspaceStorage,
  sessions: ActiveAgentSessionSnapshot[],
): void {
  try {
    persistActiveAgentSessions(sessions, storage);
  } catch {
    // Ignore quota/private-mode failures; the broadcast still updates listeners.
  }
}
