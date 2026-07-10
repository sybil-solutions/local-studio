import { collectLeaves } from "@/features/agent/workspace/layout";
import type { Session, SessionId, SessionsMap } from "@/features/agent/runtime/types";
import type { ToolSelection } from "@/features/agent/tools/types";
import type {
  PaneId,
  PaneState,
  WorkspaceLayout,
  WorkspaceState,
} from "@/features/agent/workspace/types";

import {
  PANE_LAYOUT_KEY,
  PANE_STATE_KEY,
  restorePersistedPaneState,
  type PersistedPaneEntry,
  sessionMetaForPersistence,
  type WorkspaceStorage,
} from "@/features/agent/workspace/store";
import { makeFreshTab } from "@/features/agent/messages/helpers";

const SESSIONS_COLLAPSED_KEY = "local-studio.agent.sessionsCollapsed";
const SESSIONS_COLLAPSED_CLEANED_KEY = "local-studio.agent.sessionsCollapsedCleaned";
const LEGACY_TRANSCRIPT_CACHE_KEY = "local-studio.agent.transcripts.v1";
const LEGACY_ACTIVE_SESSIONS_KEY = "local-studio.agent.activeSessions.snapshot";

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
  } catch {}
}

function removeStorage(storage: WorkspaceStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {}
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
      panesById.set(paneId, { sessionId: session.id });
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
  removeStorage(storage, LEGACY_TRANSCRIPT_CACHE_KEY);
  removeStorage(storage, LEGACY_ACTIVE_SESSIONS_KEY);
}

export type LoadedFromStorage = {
  workspace: Partial<WorkspaceState>;
  selections: Map<SessionId, ToolSelection>;
  legacyRuntimeKeys: Map<SessionId, string>;
};

export function loadInitialFromStorage(storage: WorkspaceStorage): LoadedFromStorage {
  migrateStorage(storage);

  const rawState = readStorage(storage, PANE_STATE_KEY);
  const restoredState = rawState ? restorePersistedPaneState(rawState) : null;
  if (restoredState) {
    const { selections, legacyRuntimeKeys, ...workspace } = restoredState;
    return { workspace, selections, legacyRuntimeKeys };
  }

  const rawLayout = readStorage(storage, PANE_LAYOUT_KEY);
  const restoredLayout = rawLayout ? restoreLegacyLayout(rawLayout) : null;
  return { workspace: restoredLayout ?? {}, selections: new Map(), legacyRuntimeKeys: new Map() };
}

export function writePaneState(
  storage: WorkspaceStorage,
  state: WorkspaceState,
  selectionFor: (sessionId: SessionId) => ToolSelection | null = () => null,
): void {
  const panes: Record<string, PersistedPaneEntry> = {};
  for (const [paneId, pane] of state.panesById.entries()) {
    const session = state.sessions.get(pane.sessionId);
    panes[paneId] = {
      activeTabId: pane.sessionId,
      tabs: session
        ? [sessionMetaForPersistence(session, selectionFor(session.id) ?? undefined)]
        : [],
    };
  }
  setStorage(
    storage,
    PANE_STATE_KEY,
    JSON.stringify({ version: 1, layout: state.layout, focusedPaneId: state.focusedPaneId, panes }),
  );
}
