import { makeFreshTab, newPaneId } from "@/features/agent/messages/helpers";
import type { Project } from "@/features/agent/projects/types";
import type { PaneId, SessionId, WorkspaceAction } from "@/features/agent/workspace/types";

// Direct command surface for UI that lives outside the workspace component
// tree (the sidebar renders on every route; the workspace only mounts under
// /agent). The workspace binds its dispatcher on mount; while unbound,
// commands no-op silently — the same semantics the old window-event bus had
// when no listener was attached. Persisted-session opening stays URL
// navigation; these cover only same-page actions on live sessions.
export type WorkspaceCommands = {
  bind(dispatch: (action: WorkspaceAction) => void): void;
  unbind(): void;
  /** Whether a workspace (i.e. /agent) is currently mounted and listening. */
  isBound(): boolean;
  /** Focus an open pane/session (sidebar click on an active local session). */
  focusSession(paneId: PaneId, sessionId: SessionId): void;
  /** Rename an open session inline from the sidebar. */
  renameSession(paneId: PaneId, tabId: SessionId, title: string): void;
  /**
   * Open a fresh chat scoped to `project`. Reuses an empty focused pane or
   * opens a new split pane (see openNewSessionInFocusedPane) so a surface is
   * always visibly created. Only meaningful while bound (on /agent); callers
   * fall back to URL navigation when unbound.
   */
  newChat(project?: Project | null): void;
  /**
   * Open a terminal pane scoped to `project`. Scopes/creates a chat surface
   * first (same visibility guarantee as newChat), then converts the resulting
   * focused pane into a terminal so its cwd inherits the project path.
   */
  openTerminal(project?: Project | null): void;
};

function createWorkspaceCommands(): WorkspaceCommands {
  let dispatch: ((action: WorkspaceAction) => void) | null = null;
  return {
    bind: (next) => {
      dispatch = next;
    },
    unbind: () => {
      dispatch = null;
    },
    isBound: () => dispatch !== null,
    focusSession: (paneId, sessionId) => {
      dispatch?.({ type: "focusPaneSession", paneId, sessionId });
    },
    renameSession: (paneId, tabId, title) => {
      if (!title.trim()) return;
      dispatch?.({ type: "renameTab", paneId, tabId, title });
    },
    newChat: (project) => {
      if (!dispatch) return;
      dispatch({
        type: "urlNavRequested",
        key: `cmd-new-${Date.now().toString(36)}`,
        project: project ?? null,
        sessionId: null,
        newSession: true,
        split: false,
        paneId: newPaneId(),
        tab: makeFreshTab(),
      });
    },
    openTerminal: (project) => {
      if (!dispatch) return;
      // Scope/create a chat surface first so the terminal we convert next
      // inherits the project cwd and lands on a guaranteed-visible pane.
      dispatch({
        type: "urlNavRequested",
        key: `cmd-term-${Date.now().toString(36)}`,
        project: project ?? null,
        sessionId: null,
        newSession: true,
        split: false,
        paneId: newPaneId(),
        tab: makeFreshTab(),
      });
      dispatch({ type: "openTerminalPane" });
    },
  };
}

let singleton: WorkspaceCommands | null = null;

export function workspaceCommands(): WorkspaceCommands {
  singleton ??= createWorkspaceCommands();
  return singleton;
}
