// Workspace localStorage IO. writePaneState/writeActiveSessions are the ONLY
// workspace writers of browser storage, and runWorkspaceEffect is their only
// caller — persistence happens as a post-dispatch effect, never inline.

import { collectLeaves } from "@/features/agent/workspace/layout";
import type { ActiveAgentSessionSnapshot } from "@/features/agent/active-sessions";
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
  persistActiveAgentSessions,
  restorePersistedPaneState,
  type PersistedPaneEntry,
  sessionMetaForPersistence,
  type WorkspaceStorage,
} from "@/features/agent/workspace/store";
import { makeFreshTab } from "@/features/agent/messages/helpers";

const SESSIONS_COLLAPSED_KEY = "local-studio.agent.sessionsCollapsed";
const SESSIONS_COLLAPSED_CLEANED_KEY = "local-studio.agent.sessionsCollapsedCleaned";

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
  // Tool storage migrations are owned by features/agent/tools/persistence.ts
  // (`migrateToolStorage`) — ToolsProvider runs them on mount.
}

export type LoadedFromStorage = {
  workspace: Partial<WorkspaceState>;
  /** Per-session tool selections recovered from the persisted shape. */
  selections: Map<SessionId, ToolSelection>;
  /**
   * Legacy pre-alias runtime keys by session id, read once from old persisted
   * state to seed the runtime controller's connection-key override.
   */
  legacyRuntimeKeys: Map<SessionId, string>;
};

export function loadInitialFromStorage(storage: WorkspaceStorage): LoadedFromStorage {
  migrateStorage(storage);

  const rawState = readStorage(storage, PANE_STATE_KEY);
  const restoredState = rawState ? restorePersistedPaneState(rawState) : null;
  if (restoredState) {
    const { selections, legacyRuntimeKeys, ...workspace } = restoredState;
    // Flag the durable-restore path so hydrateActiveSessions trusts this layout
    // (incl. a terminal main pane) instead of rebuilding panes from chat snapshots.
    return { workspace: { ...workspace, paneStateRestored: true }, selections, legacyRuntimeKeys };
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
    if (pane.kind === "terminal") {
      panes[paneId] = {
        kind: "terminal",
        mountKey: pane.mountKey,
        cwd: pane.cwd,
        title: pane.title,
        ownerSessionId: pane.ownerSessionId,
        ownerPiSessionId: pane.ownerPiSessionId,
      };
      continue;
    }
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
  // PANE_LAYOUT_KEY is legacy: still read as a restore fallback for very old
  // profiles (see loadInitialFromStorage) but no longer written.
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
