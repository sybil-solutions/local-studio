import assert from "node:assert/strict";
import test from "node:test";
import {
  addProjectFromPath,
  loadProjects,
  openProjectDirectory,
  removeProject,
} from "@/features/agent/projects/api";
import { createProjectsStore } from "@/features/agent/projects/store";
import type { Project } from "@/features/agent/projects/types";

const project: Project = {
  id: "proj-http",
  name: "workspace",
  path: "/workspace",
  addedAt: "2026-07-17T00:00:00.000Z",
  exists: true,
  hasGit: false,
  branch: null,
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function waitForProject(
  store: ReturnType<typeof createProjectsStore>,
  id: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (store.getSnapshot().projects.some((entry) => entry.id === id)) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for project ${id}`);
}

test("desktop selection returns a path while project persistence stays on HTTP", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; method: string; body: string | null }> = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStudioDesktop: { openDirectory: async () => project.path } },
  });
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    requests.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : null,
    });
    if (method === "POST") return Response.json({ project });
    if (method === "DELETE") return Response.json({ ok: true });
    return Response.json({ projects: [project] });
  };

  try {
    assert.equal(await openProjectDirectory(), project.path);
    assert.deepEqual(await loadProjects(), [project]);
    assert.deepEqual(await addProjectFromPath(project.path), project);
    await removeProject(project.id);
    assert.deepEqual(requests, [
      { url: "/api/agent/projects", method: "GET", body: null },
      {
        url: "/api/agent/projects",
        method: "POST",
        body: JSON.stringify({ path: project.path }),
      },
      {
        url: `/api/agent/projects?id=${project.id}`,
        method: "DELETE",
        body: null,
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("a stale project refresh cannot replace a newer HTTP mutation", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const cache = new Map<string, string>();
  const first = deferred<Project[]>();
  const second = deferred<Project[]>();
  let calls = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => cache.get(key) ?? null,
        setItem: (key: string, value: string) => void cache.set(key, value),
      },
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });

  try {
    const store = createProjectsStore({
      api: {
        loadProjects: () => (calls++ === 0 ? first.promise : second.promise),
        initGit: async () => {},
        loadGitSummary: async () => null,
        removeProject: async () => {},
      },
    });
    const staleRefresh = store.refresh();
    store.upsertProject(project);
    assert.equal(cache.get("local-studio.agent.projects.cache.v1"), JSON.stringify([project]));

    second.resolve([project]);
    await waitForProject(store, project.id);
    first.resolve([{ ...project, id: "stale" }]);
    await staleRefresh;

    assert.deepEqual(store.getSnapshot().projects, [project]);
    assert.equal(cache.get("local-studio.agent.projects.cache.v1"), JSON.stringify([project]));
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
