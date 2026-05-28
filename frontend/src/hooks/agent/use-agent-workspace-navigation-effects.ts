import { useCallback, useSyncExternalStore } from "react";
import { consumeAgentSessionNavTitle } from "@/components/projects-nav-section";
import { makeFreshTab, newPaneId, newRuntimeId } from "@/lib/agent/session/helpers";
import type { ProjectsContextValue } from "@/lib/agent/projects/context";
import type { WorkspaceDispatch } from "@/lib/agent/workspace/effects";

type SearchParamsReader = {
  get: (key: string) => string | null;
};

type WorkspaceNavigationDeps = {
  lastHandledNavKey: string;
  projects: ProjectsContextValue;
  searchParams: SearchParamsReader;
  dispatch: WorkspaceDispatch;
};

export function requestWorkspaceUrlNavigation({
  lastHandledNavKey,
  projects,
  searchParams,
  dispatch,
}: WorkspaceNavigationDeps): void {
  const projectId = searchParams.get("project");
  const sessionId = searchParams.get("session");
  const newParam = searchParams.get("new");
  const splitParam = searchParams.get("split");
  const key =
    projectId || sessionId || newParam
      ? `${projectId ?? ""}|${sessionId ?? ""}|${newParam ?? ""}|${splitParam ?? ""}`
      : "";
  if (!key || lastHandledNavKey === key) return;

  const project = projectId ? projects.findById(projectId) : null;
  if (projectId && !project) return;

  if (project) projects.selectProject(project);
  const sessionTitle = sessionId ? consumeAgentSessionNavTitle(sessionId) : undefined;

  dispatch({
    type: "urlNavRequested",
    key,
    project,
    sessionId,
    ...(sessionTitle ? { sessionTitle } : {}),
    newSession: newParam === "1",
    split: splitParam === "1",
    paneId: newPaneId(),
    runtimeSessionId: newRuntimeId(),
    tab: makeFreshTab(),
  });
}

export function useAgentWorkspaceNavigationEffects({
  lastHandledNavKey,
  projects,
  searchParams,
  dispatch,
}: WorkspaceNavigationDeps): void {
  const subscribe = useCallback(
    (_notify: () => void) => {
      requestWorkspaceUrlNavigation({ lastHandledNavKey, projects, searchParams, dispatch });
      return () => {};
    },
    [lastHandledNavKey, projects, searchParams, dispatch],
  );

  useSyncExternalStore(subscribe, getWorkspaceNavigationSnapshot, getWorkspaceNavigationSnapshot);
}

const getWorkspaceNavigationSnapshot = (): number => 0;
