import { consumeAgentSessionNavTitle } from "@/features/agent/ui/projects-nav/helpers";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import type { ProjectsContextValue } from "@/features/agent/projects/context";
import type { Project } from "@/features/agent/projects/types";
import { makeFreshTab, newPaneId } from "@/features/agent/messages/helpers";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { WorkspaceAction } from "@/features/agent/workspace/types";

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

function navigationParams(searchParams: SearchParamsReader): NavigationParams {
  const sessionId = searchParams.get("session");
  const newParam = searchParams.get("new");
  return {
    projectId: searchParams.get("project"),
    sessionId: sessionIdForNavigation(sessionId, newParam),
    newParam,
    openParam: searchParams.get("open"),
    splitParam: searchParams.get("split"),
    replaceParam: searchParams.get("replace"),
  };
}

export function workspaceNavigationAction(
  searchParams: SearchParamsReader,
  project: Project | null,
  sessionTitle?: string,
): Extract<WorkspaceAction, { type: "urlNavRequested" }> | null {
  const params = navigationParams(searchParams);
  const key = navigationKey(params);
  if (!key) return null;
  const tab = {
    ...makeFreshTab(),
    projectId: project?.id,
    cwd: project?.path,
  };
  return {
    type: "urlNavRequested",
    key,
    ...(params.openParam ? { intent: params.openParam } : {}),
    project,
    sessionId: params.sessionId,
    ...(sessionTitle ? { sessionTitle } : {}),
    newSession: params.newParam !== null,
    split: params.splitParam === "1",
    replaceWorkspace: params.replaceParam === "1",
    paneId: newPaneId(),
    tab,
  };
}

export function workspaceNavigationActionForHref(
  href: string,
  project: Project,
  sessionTitle?: string,
): Extract<WorkspaceAction, { type: "urlNavRequested" }> | null {
  return workspaceNavigationAction(
    new URL(href, "http://local.studio").searchParams,
    project,
    sessionTitle,
  );
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
  const params = navigationParams(searchParams);
  const key = navigationKey(params);
  if (!key) return;
  if (lastHandledNavKey === key) {
    consumeOneShotNavParams(params.projectId, params.sessionId);
    return;
  }

  const project = projectForNavigation(projects, params.projectId);
  if (params.projectId && !project) return;

  if (project) projects.selectProject(project);
  const sessionTitle = params.sessionId ? consumeAgentSessionNavTitle(params.sessionId) : undefined;
  const action = workspaceNavigationAction(searchParams, project, sessionTitle);
  if (action) dispatch(action);
  consumeOneShotNavParams(params.projectId, params.sessionId);
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
