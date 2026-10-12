import { SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";
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
  moveProjectBefore: (dragId: string, targetId: string | null) => void;
  loadGitSummary: (cwd: string) => Promise<GitSummary | null>;
  initGitForActiveProject: () => Promise<void>;
};

const getBrowserWindow = (): BrowserWindowLike | null =>
  typeof window === "undefined" ? null : window;

const notify = (target: BrowserWindowLike | null, eventName: string): void => {
  target?.dispatchEvent(new Event(eventName));
};

export function createProjectsStore(dependencies: ProjectsStoreDependencies = {}): ProjectsStore {
  const api = dependencies.api ?? defaultApi;
  const readSelection = dependencies.readSelectedProjectId ?? readSelectedProjectId;
  const writeSelection = dependencies.writeSelectedProjectId ?? writeSelectedProjectId;
  const getWindow = dependencies.getWindow ?? getBrowserWindow;
  const listeners = new Set<() => void>();
  let started = false;
  let lastGitFetch: string | null = null;
  let snapshot: ProjectsSnapshot = {
    projects: applyProjectOrder(readCachedProjects()),
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
      projects = applyProjectOrder(await api.loadProjects());
      writeCachedProjects(projects);
    } catch {
      projects = snapshot.projects;
    }
    const previousSelectedId = snapshot.selectedId;
    const selectedId = resolveSelectedProjectId(previousSelectedId, projects);
    update({ ...snapshot, projects, loaded: true, selectedId });
    if (selectedId !== previousSelectedId) writeSelection(selectedId);
    void loadGitSummary(projectPathById(projects, selectedId));
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
    moveProjectBefore: (dragId, targetId) => {
      if (dragId === targetId) return;
      const projects = [...snapshot.projects];
      const fromIndex = projects.findIndex((entry) => entry.id === dragId);
      if (fromIndex === -1) return;
      const [moved] = projects.splice(fromIndex, 1);
      const toIndex = targetId ? projects.findIndex((entry) => entry.id === targetId) : -1;
      if (toIndex === -1) projects.push(moved);
      else projects.splice(toIndex, 0, moved);
      writeProjectOrder(projects.map((entry) => entry.id));
      writeCachedProjects(projects);
      replaceProjects(projects);
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
const PROJECTS_CACHE_KEY = "local-studio.agent.projects.cache.v1";
const PROJECTS_ORDER_KEY = "local-studio.agent.projects.order.v1";

function readProjectOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROJECTS_ORDER_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeProjectOrder(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROJECTS_ORDER_KEY, JSON.stringify(ids));
  } catch {}
}

/** Apply the user's saved manual order; projects without a saved position keep
 * their load order and sort after the ordered ones. */
function applyProjectOrder(projects: Project[]): Project[] {
  const order = readProjectOrder();
  if (order.length === 0) return projects;
  const position = new Map(order.map((id, index) => [id, index] as const));
  return [...projects].sort((a, b) => {
    const pa = position.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const pb = position.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return pa - pb;
  });
}

function readCachedProjects(): Project[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROJECTS_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Project =>
        Boolean(entry) &&
        typeof (entry as Project).id === "string" &&
        typeof (entry as Project).path === "string",
    );
  } catch {
    return [];
  }
}

function writeCachedProjects(projects: Project[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(projects));
  } catch {}
}

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
  } catch {}
}
