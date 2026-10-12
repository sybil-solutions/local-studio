import type { PaneId, SessionId, WorkspaceAction } from "@/features/agent/workspace/types";

export type WorkspaceCommands = {
  bind(dispatch: (action: WorkspaceAction) => void): void;
  unbind(): void;
  focusSession(
    paneId: PaneId,
    sessionId: SessionId,
    options?: { replaceWorkspace?: boolean },
  ): void;
  renameSession(paneId: PaneId, tabId: SessionId, title: string): void;
  navigate(action: Extract<WorkspaceAction, { type: "urlNavRequested" }>): boolean;
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
    focusSession: (paneId, sessionId, options) => {
      dispatch?.({
        type: "focusPaneSession",
        paneId,
        sessionId,
        replaceWorkspace: options?.replaceWorkspace,
      });
    },
    renameSession: (paneId, tabId, title) => {
      if (!title.trim()) return;
      dispatch?.({ type: "renameTab", paneId, tabId, title });
    },
    navigate: (action) => {
      if (!dispatch) return false;
      dispatch(action);
      return true;
    },
  };
}

let singleton: WorkspaceCommands | null = null;

export function workspaceCommands(): WorkspaceCommands {
  singleton ??= createWorkspaceCommands();
  return singleton;
}
