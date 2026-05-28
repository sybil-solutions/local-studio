"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createProjectsStore } from "./store";
import type { GitSummary, Project, ProjectId } from "./types";

export type ProjectsContextValue = {
  projects: Project[];
  loaded: boolean;
  selectedProject: Project | null;
  selectedProjectId: ProjectId | null;
  agentCwd: string;
  gitSummary: (cwd: string | null | undefined) => GitSummary | null;
  findById: (id: string | null | undefined) => Project | null;
  findByPath: (path: string | null | undefined) => Project | null;
  resolveProject: (tab: { projectId?: string; cwd?: string } | null | undefined) => Project | null;
  selectProject: (project: Project | null) => void;
  upsertProject: (project: Project) => void;
  removeProject: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  loadGitSummary: (cwd: string) => Promise<GitSummary | null>;
  initGitForActiveProject: () => Promise<void>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => createProjectsStore(), []);
  const { projects, loaded, selectedId, gitSummaries } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

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
      selectProject: store.selectProject,
      upsertProject: store.upsertProject,
      removeProject: store.removeProject,
      refresh: store.refresh,
      loadGitSummary: store.loadGitSummary,
      initGitForActiveProject: store.initGitForActiveProject,
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
      store,
    ],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsContextValue {
  const value = useContext(ProjectsContext);
  if (!value) throw new Error("useProjects must be used within a ProjectsProvider");
  return value;
}
