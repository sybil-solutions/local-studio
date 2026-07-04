import { consumeAgentSessionNavTitle } from "@/features/agent/ui/projects-nav/helpers";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import type { ProjectsContextValue } from "@/features/agent/projects/context";
import { makeFreshTab, newPaneId } from "@/features/agent/messages/helpers";
import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";
import { loadPersistedActiveAgentSessions } from "@/features/agent/workspace/store";
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

type PersistedSession = ReturnType<typeof loadPersistedActiveAgentSessions>[number];

type NavigationParams = {
  projectId: string | null;
  sessionId: string | null;
  newParam: string | null;
  openParam: string | null;
  splitParam: string | null;
  terminalParam: string | null;
};

function navigationKey(params: NavigationParams): string {
  const { projectId, sessionId, newParam, openParam, splitParam, terminalParam } = params;
  if (!(projectId || sessionId || newParam || openParam || terminalParam)) return "";
  return `${projectId ?? ""}|${sessionId ?? ""}|${newParam ?? ""}|${openParam ?? ""}|${splitParam ?? ""}|${terminalParam ?? ""}`;
}

function persistedSessionFor(sessionId: string | null): PersistedSession | null {
  if (!sessionId) return null;
  return (
    loadPersistedActiveAgentSessions().find((session) => session.piSessionId === sessionId) ?? null
  );
}

function projectForNavigation(
  projects: ProjectsContextValue,
  projectId: string | null,
  persistedSession: PersistedSession | null,
) {
  if (projectId) return projects.findById(projectId);
  if (persistedSession?.projectId) return projects.findById(persistedSession.projectId);
  return null;
}

function replayTabFor(persistedSession: PersistedSession | null) {
  const tab = makeFreshTab();
  if (!persistedSession) return tab;
  return {
    ...tab,
    id: persistedSession.tabId || tab.id,
    piSessionId: persistedSession.piSessionId,
    projectId: persistedSession.projectId,
    cwd: persistedSession.cwd,
    modelId: persistedSession.modelId,
    title: persistedSession.title || tab.title,
    startedAt: persistedSession.startedAt ?? persistedSession.updatedAt,
  };
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
  const openParam = searchParams.get("open");
  const splitParam = searchParams.get("split");
  const terminalParam = searchParams.get("terminal");
  const key = navigationKey({
    projectId,
    sessionId,
    newParam,
    openParam,
    splitParam,
    terminalParam,
  });
  if (!key || lastHandledNavKey === key) return;

  const persistedSession = persistedSessionFor(sessionId);
  const project = projectForNavigation(projects, projectId, persistedSession);
  if (projectId && !project) return;

  if (project) projects.selectProject(project);
  const sessionTitle = sessionId ? consumeAgentSessionNavTitle(sessionId) : undefined;

  const tab = replayTabFor(persistedSession);
  // Legacy upgrade seed: an entry persisted while running under a pre-alias
  // rt-* runtime key must reattach to that key (see active-sessions.ts).
  if (persistedSession?.runtimeSessionId) {
    sessionRuntimeController().seedConnectionKey(tab.id, persistedSession.runtimeSessionId);
  }
  dispatch({
    type: "urlNavRequested",
    key,
    project,
    sessionId,
    ...(sessionTitle ? { sessionTitle } : {}),
    newSession: newParam !== null,
    split: splitParam === "1",
    paneId: newPaneId(),
    tab,
  });
  // Unbound "New terminal" fallback: `terminal=1` (paired with `new`) scopes the
  // focused pane above, then converts it to a terminal inheriting the project cwd.
  if (terminalParam) {
    dispatch({ type: "openTerminalPane" });
  }
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
