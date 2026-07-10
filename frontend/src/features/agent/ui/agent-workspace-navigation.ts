import { consumeAgentSessionNavTitle } from "@/features/agent/ui/projects-nav/helpers";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import type { ProjectsContextValue } from "@/features/agent/projects/context";
import { makeFreshTab, newPaneId } from "@/features/agent/messages/helpers";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type SearchParamsReader = {
  get: (key: string) => string | null;
};

type WorkspaceNavigationDeps = {
  lastHandledNavKey: string;
  projects: ProjectsContextValue;
  searchParams: SearchParamsReader;
  dispatch: WorkspaceDispatch;
};

type NavigationParams = {
  projectId: string | null;
  sessionId: string | null;
  newParam: string | null;
  openParam: string | null;
  splitParam: string | null;
  replaceParam: string | null;
};

function navigationKey(params: NavigationParams): string {
  const { projectId, sessionId, newParam, openParam, splitParam, replaceParam } = params;
  if (!(projectId || sessionId || newParam || openParam)) return "";
  return `${projectId ?? ""}|${sessionId ?? ""}|${newParam ?? ""}|${openParam ?? ""}|${splitParam ?? ""}|${replaceParam ?? ""}`;
}

export function sessionIdForNavigation(
  sessionId: string | null,
  newParam: string | null,
): string | null {
  return newParam === null ? sessionId : null;
}

function projectForNavigation(projects: ProjectsContextValue, projectId: string | null) {
  if (projectId) return projects.findById(projectId);
  return null;
}

function requestWorkspaceUrlNavigation({
  lastHandledNavKey,
  projects,
  searchParams,
  dispatch,
}: WorkspaceNavigationDeps): void {
  const projectId = searchParams.get("project");
  const sessionId = searchParams.get("session");
  const newParam = searchParams.get("new");
  const requestedSessionId = sessionIdForNavigation(sessionId, newParam);
  const openParam = searchParams.get("open");
  const splitParam = searchParams.get("split");
  const replaceParam = searchParams.get("replace");
  const key = navigationKey({
    projectId,
    sessionId: requestedSessionId,
    newParam,
    openParam,
    splitParam,
    replaceParam,
  });
  if (!key || lastHandledNavKey === key) return;

  const project = projectForNavigation(projects, projectId);
  if (projectId && !project) return;

  if (project) projects.selectProject(project);
  const sessionTitle = requestedSessionId
    ? consumeAgentSessionNavTitle(requestedSessionId)
    : undefined;

  const tab = {
    ...makeFreshTab(),
    projectId: project?.id,
    cwd: project?.path,
  };
  dispatch({
    type: "urlNavRequested",
    key,
    project,
    sessionId: requestedSessionId,
    ...(sessionTitle ? { sessionTitle } : {}),
    newSession: newParam !== null,
    split: splitParam === "1",
    replaceWorkspace: replaceParam === "1",
    paneId: newPaneId(),
    tab,
  });
  consumeOneShotNavParams(projectId, requestedSessionId);
}

export function settledAgentNavigationHref(
  currentHref: string,
  projectId: string | null,
  sessionId: string | null,
): string {
  const url = new URL(currentHref);
  if (projectId) url.searchParams.set("project", projectId);
  else url.searchParams.delete("project");
  if (sessionId) url.searchParams.set("session", sessionId);
  else url.searchParams.delete("session");
  for (const param of ["new", "terminal", "split", "open", "replace"])
    url.searchParams.delete(param);
  return url.toString();
}

function consumeOneShotNavParams(projectId: string | null, sessionId: string | null): void {
  if (typeof window === "undefined") return;
  const href = settledAgentNavigationHref(window.location.href, projectId, sessionId);
  if (href !== window.location.href) window.history.replaceState(window.history.state, "", href);
}

export function useAgentWorkspaceNavigationEffects({
  lastHandledNavKey,
  projects,
  searchParams,
  dispatch,
}: WorkspaceNavigationDeps): void {
  useMountSubscription(() => {
    requestWorkspaceUrlNavigation({ lastHandledNavKey, projects, searchParams, dispatch });
  }, [lastHandledNavKey, projects, searchParams, dispatch]);
}
