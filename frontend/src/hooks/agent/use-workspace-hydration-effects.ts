import { useCallback, useSyncExternalStore, type RefObject } from "react";

import type { ProjectsContextValue } from "@/lib/agent/projects/context";
import type { ToolsContextValue } from "@/lib/agent/tools/context";
import {
  subscribeWorkspaceWindowEvents,
  type WorkspaceDispatch,
} from "@/lib/agent/workspace/effects";
import { loadInitialFromStorage } from "@/lib/agent/workspace/persistence";
import { loadPersistedActiveAgentSessions } from "@/lib/agent/workspace/store";

export function useWorkspaceHydrationEffects({
  dispatch,
  projectsRef,
  toolsRef,
}: {
  dispatch: WorkspaceDispatch;
  projectsRef: RefObject<ProjectsContextValue>;
  toolsRef: RefObject<ToolsContextValue>;
}): void {
  const subscribe = useCallback(
    (_notify: () => void) => {
      const { workspace, selections } = loadInitialFromStorage(window.localStorage);
      dispatch({ type: "hydrate", state: workspace });
      if (selections.size > 0) toolsRef.current.hydrateSelections(selections);

      if (projectsRef.current.loaded) {
        const snapshots = loadPersistedActiveAgentSessions();
        dispatch({
          type: "hydrateActiveSessions",
          snapshots,
          projects: projectsRef.current.projects,
        });
      }

      return subscribeWorkspaceWindowEvents(window, dispatch, (id) =>
        projectsRef.current.findById(id),
      );
    },
    [dispatch, projectsRef, toolsRef],
  );

  useSyncExternalStore(subscribe, getWorkspaceHydrationSnapshot, getWorkspaceHydrationSnapshot);
}

const getWorkspaceHydrationSnapshot = (): number => 0;
