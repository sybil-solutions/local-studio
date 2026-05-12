"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PROJECTS_CHANGED_EVENT,
  PROJECTS_LOADED_EVENT,
  SESSIONS_CHANGED_EVENT,
} from "@/lib/agent/workspace/events";
import * as api from "./api";
import { readSelectedProjectId, writeSelectedProjectId } from "./persistence";
import { projectPathById, resolveSelectedProjectId } from "./selection";
import type { GitSummary, Project, ProjectId } from "./types";

export type ProjectsContextValue = {
  projects: Project[];
  loaded: boolean;
  selectedProject: Project | null;
  selectedProjectId: ProjectId | null;
  /** Path of the selected project (or "" if none). Equivalent to old workspace `agentCwd`. */
  agentCwd: string;
  gitSummary: (cwd: string | null | undefined) => GitSummary | null;
  /** Find a project by id. */
  findById: (id: string | null | undefined) => Project | null;
  /** Find a project by absolute path. */
  findByPath: (path: string | null | undefined) => Project | null;
  /** Resolve a tab's project from its projectId, then cwd, then fall back to the selected one. */
  resolveProject: (tab: { projectId?: string; cwd?: string } | null | undefined) => Project | null;
  selectProject: (project: Project | null) => void;
  upsertProject: (project: Project) => void;
  removeProject: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  loadGitSummary: (cwd: string) => Promise<GitSummary | null>;
  initGitForActiveProject: () => Promise<void>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

function notifyProjectsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
}

function notifySessionsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT));
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedIdState] = useState<ProjectId | null>(() =>
    readSelectedProjectId(),
  );
  const selectedIdRef = useRef<ProjectId | null>(selectedId);
  const [gitSummaries, setGitSummaries] = useState<ReadonlyMap<string, GitSummary>>(new Map());
  const lastGitFetchRef = useRef<string | null>(null);

  const firstLoadRef = useRef(false);

  // Persist on every write, including the auto-select that runs when the
  // current selection vanishes (project deleted) or on first load.
  const setSelectedId = useCallback(
    (next: ProjectId | null | ((current: ProjectId | null) => ProjectId | null)) => {
      setSelectedIdState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        selectedIdRef.current = resolved;
        if (resolved !== current) writeSelectedProjectId(resolved);
        return resolved;
      });
    },
    [],
  );

  const loadGitSummary = useCallback(async (cwd: string) => {
    try {
      const summary = await api.loadGitSummary(cwd);
      setGitSummaries((current) => {
        const next = new Map(current);
        if (summary) next.set(cwd, summary);
        else next.delete(cwd);
        return next;
      });
      return summary;
    } catch {
      setGitSummaries((current) => {
        if (!current.has(cwd)) return current;
        const next = new Map(current);
        next.delete(cwd);
        return next;
      });
      return null;
    }
  }, []);

  const loadGitSummaryOnce = useCallback(
    (cwd: string) => {
      if (!cwd || lastGitFetchRef.current === cwd) return;
      lastGitFetchRef.current = cwd;
      void loadGitSummary(cwd);
    },
    [loadGitSummary],
  );

  const refresh = useCallback(async () => {
    let next: Project[] = [];
    try {
      next = await api.loadProjects();
      setProjects(next);
    } catch {
      // Swallow — we still mark loaded so consumers don't wait forever.
    }
    setLoaded(true);
    const nextSelectedId = resolveSelectedProjectId(selectedIdRef.current, next);
    setSelectedId(nextSelectedId);
    loadGitSummaryOnce(projectPathById(next, nextSelectedId));
    if (!firstLoadRef.current) {
      firstLoadRef.current = true;
      // Notify the workspace (and any other subscribers) that the project
      // list is now authoritative — they can hydrate session snapshots etc.
      window.dispatchEvent(
        new CustomEvent<{ projects: Project[] }>(PROJECTS_LOADED_EVENT, {
          detail: { projects: next },
        }),
      );
    }
  }, [loadGitSummaryOnce, setSelectedId]);

  useEffect(() => {
    void refresh();
    const onProjectsChanged = () => void refresh();
    window.addEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, onProjectsChanged);
  }, [refresh]);

  const selectProject = useCallback(
    (project: Project | null) => {
      setSelectedId(project?.id ?? null);
      loadGitSummaryOnce(project?.path ?? "");
    },
    [loadGitSummaryOnce, setSelectedId],
  );

  const upsertProject = useCallback((project: Project) => {
    setProjects((current) => [project, ...current.filter((entry) => entry.id !== project.id)]);
    notifyProjectsChanged();
  }, []);

  const removeProject = useCallback(async (id: string) => {
    await api.removeProject(id);
    setProjects((current) => current.filter((entry) => entry.id !== id));
    setSelectedId((current) => (current === id ? null : current));
    notifyProjectsChanged();
  }, []);

  const findById = useCallback(
    (id: string | null | undefined): Project | null =>
      (id && projects.find((p) => p.id === id)) || null,
    [projects],
  );

  const findByPath = useCallback(
    (path: string | null | undefined): Project | null =>
      (path && projects.find((p) => p.path === path)) || null,
    [projects],
  );

  const resolveProject = useCallback(
    (tab: { projectId?: string; cwd?: string } | null | undefined): Project | null => {
      if (!tab) return findById(selectedId);
      return findById(tab.projectId) ?? findByPath(tab.cwd) ?? findById(selectedId);
    },
    [findById, findByPath, selectedId],
  );

  const gitSummary = useCallback(
    (cwd: string | null | undefined): GitSummary | null =>
      cwd ? (gitSummaries.get(cwd) ?? null) : null,
    [gitSummaries],
  );

  const selectedProject = useMemo(() => findById(selectedId), [findById, selectedId]);
  const agentCwd = selectedProject?.path ?? "";

  const initGitForActiveProject = useCallback(async () => {
    if (!agentCwd) return;
    await api.initGit(agentCwd);
    await loadGitSummary(agentCwd);
    notifyProjectsChanged();
    notifySessionsChanged();
  }, [agentCwd, loadGitSummary]);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      loaded,
      selectedProject,
      selectedProjectId: selectedId,
      agentCwd,
      gitSummary,
      findById,
      findByPath,
      resolveProject,
      selectProject,
      upsertProject,
      removeProject,
      refresh,
      loadGitSummary,
      initGitForActiveProject,
    }),
    [
      projects,
      loaded,
      selectedProject,
      selectedId,
      agentCwd,
      gitSummary,
      findById,
      findByPath,
      resolveProject,
      selectProject,
      upsertProject,
      removeProject,
      refresh,
      loadGitSummary,
      initGitForActiveProject,
    ],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsContextValue {
  const value = useContext(ProjectsContext);
  if (!value) throw new Error("useProjects must be used within a ProjectsProvider");
  return value;
}
