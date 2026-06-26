import { PROJECTS_LOADED_EVENT, SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";
import * as defaultApi from "@/features/agent/projects/api";
import type { GitSummary, Project, ProjectId } from "@/features/agent/projects/types";

export type ProjectsSnapshot = {
  projects: Project[];
  loaded: boolean;
  selectedId: ProjectId | null;
  gitSummaries: ReadonlyMap<string, GitSummary>;
};

type ProjectsApi = Pick<
  typeof defaultApi,
  "initGit" | "loadGitSummary" | "loadProjects" | "removeProject"
>;

type BrowserWindowLike = Pick<Window, "addEventListener" | "dispatchEvent" | "removeEventListener">;

export type ProjectsStoreDependencies = {
  api?: ProjectsApi;
  readSelectedProjectId?: () => ProjectId | null;
  writeSelectedProjectId?: (id: ProjectId | null) => void;
  getWindow?: () => BrowserWindowLike | null;
};

export type ProjectsStore = {
  getSnapshot: () => ProjectsSnapshot;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  selectProject: (project: Project | null) => void;
  upsertProject: (project: Project) => void;
  removeProject: (id: string) => Promise<void>;
  loadGitSummary: (cwd: string) => Promise<GitSummary | null>;
  initGitForActiveProject: () => Promise<void>;
};

const getBrowserWindow = (): BrowserWindowLike | null =>
  typeof window === "undefined" ? null : window;

const notify = (target: BrowserWindowLike | null, eventName: string): void => {
  target?.dispatchEvent(new Event(eventName));
};

const loadedEvent = (projects: Project[]): Event =>
  new CustomEvent<{ projects: Project[] }>(PROJECTS_LOADED_EVENT, { detail: { projects } });

export function createProjectsStore(dependencies: ProjectsStoreDependencies = {}): ProjectsStore {
  const api = dependencies.api ?? defaultApi;
  const readSelection = dependencies.readSelectedProjectId ?? readSelectedProjectId;
  const writeSelection = dependencies.writeSelectedProjectId ?? writeSelectedProjectId;
  const getWindow = dependencies.getWindow ?? getBrowserWindow;
  const listeners = new Set<() => void>();
  let started = false;
  let firstLoad = false;
  let lastGitFetch: string | null = null;
  let snapshot: ProjectsSnapshot = {
    projects: [],
    loaded: false,
    selectedId: readSelection(),
    gitSummaries: new Map(),
  };

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const update = (next: ProjectsSnapshot): void => {
    snapshot = next;
    emit();
  };

  const setSelectedId = (selectedId: ProjectId | null): void => {
    if (selectedId !== snapshot.selectedId) writeSelection(selectedId);
    update({ ...snapshot, selectedId });
  };

  const replaceProjects = (projects: Project[]): void => {
    update({ ...snapshot, projects });
  };

  const loadGitSummary = async (cwd: string): Promise<GitSummary | null> => {
    if (!cwd) return null;
    try {
      const summary = await api.loadGitSummary(cwd);
      const next = new Map(snapshot.gitSummaries);
      if (summary) next.set(cwd, summary);
      else next.delete(cwd);
      update({ ...snapshot, gitSummaries: next });
      return summary;
    } catch {
      if (!snapshot.gitSummaries.has(cwd)) return null;
      const next = new Map(snapshot.gitSummaries);
      next.delete(cwd);
      update({ ...snapshot, gitSummaries: next });
      return null;
    }
  };

  const loadGitSummaryOnce = (cwd: string): void => {
    if (!cwd || lastGitFetch === cwd) return;
    lastGitFetch = cwd;
    void loadGitSummary(cwd);
  };

  const refresh = async (): Promise<void> => {
    let projects: Project[] = [];
    try {
      projects = await api.loadProjects();
    } catch {
      // Swallow — we still mark loaded so consumers don't wait forever.
    }
    const previousSelectedId = snapshot.selectedId;
    const selectedId = resolveSelectedProjectId(previousSelectedId, projects);
    update({ ...snapshot, projects, loaded: true, selectedId });
    if (selectedId !== previousSelectedId) writeSelection(selectedId);
    void loadGitSummary(projectPathById(projects, selectedId));
    if (!firstLoad) {
      firstLoad = true;
      getWindow()?.dispatchEvent(loadedEvent(projects));
    }
  };

  const start = (): void => {
    if (started) return;
    started = true;
    void refresh();
  };

  const stop = (): void => {
    if (!started || listeners.size > 0) return;
    started = false;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
    refresh,
    selectProject: (project) => {
      setSelectedId(project?.id ?? null);
      loadGitSummaryOnce(project?.path ?? "");
    },
    upsertProject: (project) => {
      replaceProjects([project, ...snapshot.projects.filter((entry) => entry.id !== project.id)]);
      void refresh();
    },
    removeProject: async (id) => {
      await api.removeProject(id);
      const previousSelectedId = snapshot.selectedId;
      const projects = snapshot.projects.filter((entry) => entry.id !== id);
      const selectedId = previousSelectedId === id ? null : previousSelectedId;
      update({ ...snapshot, projects, selectedId });
      if (selectedId !== previousSelectedId) writeSelection(selectedId);
      void refresh();
    },
    loadGitSummary,
    initGitForActiveProject: async () => {
      const cwd = projectPathById(snapshot.projects, snapshot.selectedId);
      if (!cwd) return;
      await api.initGit(cwd);
      await loadGitSummary(cwd);
      void refresh();
      notify(getWindow(), SESSIONS_CHANGED_EVENT);
    },
  };
}

function resolveSelectedProjectId(
  current: ProjectId | null,
  projects: readonly Project[],
): ProjectId | null {
  if (current && projects.some((project) => project.id === current)) return current;
  return projects[0]?.id ?? null;
}

function projectPathById(projects: readonly Project[], projectId: ProjectId | null): string {
  return projects.find((project) => project.id === projectId)?.path ?? "";
}

const SELECTED_PROJECT_KEY = "local-studio.agent.selectedProjectId";

function readSelectedProjectId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SELECTED_PROJECT_KEY);
  } catch {
    return null;
  }
}

function writeSelectedProjectId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(SELECTED_PROJECT_KEY, id);
    else window.localStorage.removeItem(SELECTED_PROJECT_KEY);
  } catch {
    // Ignore storage failures; selection persists in memory.
  }
}
