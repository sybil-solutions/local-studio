import { describe, expect, it, vi } from "vitest";
import { PROJECTS_CHANGED_EVENT, PROJECTS_LOADED_EVENT } from "@/lib/agent/workspace/events";
import { createProjectsStore } from "./store";
import type { GitSummary, Project } from "./types";

const project = (id: string, path = `/work/${id}`): Project => ({
  id,
  name: id,
  path,
  addedAt: "2026-05-12T00:00:00.000Z",
  exists: true,
  hasGit: true,
  branch: "main",
});

const gitSummary: GitSummary = {
  isRepo: true,
  branch: "main",
  additions: 1,
  deletions: 0,
  statusCount: 1,
};

describe("createProjectsStore", () => {
  it("loads projects on first subscription and publishes the loaded event", async () => {
    const events = new EventTarget();
    const loaded = vi.fn();
    events.addEventListener(PROJECTS_LOADED_EVENT, loaded);
    const store = createProjectsStore({
      api: {
        initGit: vi.fn(),
        loadGitSummary: vi.fn(async () => gitSummary),
        loadProjects: vi.fn(async () => [project("p1")]),
        removeProject: vi.fn(),
      },
      getWindow: () => events as Window,
      readSelectedProjectId: () => null,
      writeSelectedProjectId: vi.fn(),
    });

    const unsubscribe = store.subscribe(vi.fn());
    await vi.waitFor(() => expect(store.getSnapshot().loaded).toBe(true));

    expect(store.getSnapshot().projects).toHaveLength(1);
    expect(store.getSnapshot().selectedId).toBe("p1");
    expect(loaded).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("refreshes after project-change events and keeps a still-valid selection", async () => {
    const events = new EventTarget();
    const loadProjects = vi
      .fn()
      .mockResolvedValueOnce([project("p1"), project("p2")])
      .mockResolvedValueOnce([project("p2")]);
    const writeSelectedProjectId = vi.fn();
    const store = createProjectsStore({
      api: {
        initGit: vi.fn(),
        loadGitSummary: vi.fn(async () => gitSummary),
        loadProjects,
        removeProject: vi.fn(),
      },
      getWindow: () => events as Window,
      readSelectedProjectId: () => "p2",
      writeSelectedProjectId,
    });

    const unsubscribe = store.subscribe(vi.fn());
    await vi.waitFor(() => expect(loadProjects).toHaveBeenCalledTimes(1));
    events.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    await vi.waitFor(() => expect(loadProjects).toHaveBeenCalledTimes(2));

    expect(store.getSnapshot().selectedId).toBe("p2");
    expect(writeSelectedProjectId).not.toHaveBeenCalledWith("p1");
    unsubscribe();
  });

  it("selects a project and caches its git summary once", async () => {
    const loadGitSummary = vi.fn(async () => gitSummary);
    const store = createProjectsStore({
      api: {
        initGit: vi.fn(),
        loadGitSummary,
        loadProjects: vi.fn(async () => []),
        removeProject: vi.fn(),
      },
      getWindow: () => new EventTarget() as Window,
      readSelectedProjectId: () => null,
      writeSelectedProjectId: vi.fn(),
    });

    store.selectProject(project("p1"));
    store.selectProject(project("p1"));
    await vi.waitFor(() => expect(loadGitSummary).toHaveBeenCalledTimes(1));

    expect(store.getSnapshot().gitSummaries.get("/work/p1")).toEqual(gitSummary);
  });
});
