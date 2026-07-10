import type { PaneId, SessionId, WorkspaceAction } from "@/features/agent/workspace/types";

export type WorkspaceCommands = {
  bind(dispatch: (action: WorkspaceAction) => void): void;
  unbind(): void;
  focusSession(paneId: PaneId, sessionId: SessionId): void;
  renameSession(paneId: PaneId, tabId: SessionId, title: string): void;
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
    focusSession: (paneId, sessionId) => {
      dispatch?.({ type: "focusPaneSession", paneId, sessionId });
    },
    renameSession: (paneId, tabId, title) => {
      if (!title.trim()) return;
      dispatch?.({ type: "renameTab", paneId, tabId, title });
    },
  };
}

let singleton: WorkspaceCommands | null = null;

export function workspaceCommands(): WorkspaceCommands {
  singleton ??= createWorkspaceCommands();
  return singleton;
}
