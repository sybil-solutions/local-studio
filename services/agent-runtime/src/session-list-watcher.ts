import { existsSync, watch, type FSWatcher } from "node:fs";
import { listProjectsFromStore, projectsStoreFilePath } from "./projects-store";
import { notifySessionListChanged } from "./session-list-changed";
import { sessionDirRootsForCwd } from "./sessions-store";

const DEBOUNCE_MS = 200;
const REFRESH_INTERVAL_MS = 15_000;

export interface SessionListWatcher {
  start(): void;
  dispose(): void;
}

function closeWatcher(watcher: FSWatcher | null): void {
  if (!watcher) return;
  try {
    watcher.close();
  } catch {
    return;
  }
}

export function createSessionListWatcher(): SessionListWatcher {
  const watchers = new Map<string, FSWatcher>();
  let projectsWatcher: FSWatcher | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let notifyTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const scheduleNotify = (): void => {
    if (disposed || notifyTimer) return;
    notifyTimer = setTimeout(() => {
      notifyTimer = null;
      notifySessionListChanged();
    }, DEBOUNCE_MS);
  };

  const watchRoot = (root: string): void => {
    if (watchers.has(root) || !existsSync(root)) return;
    let watcher: FSWatcher;
    try {
      watcher = watch(root, { recursive: true }, (_eventType, filename) => {
        if (typeof filename !== "string" || filename.endsWith(".jsonl")) scheduleNotify();
      });
    } catch {
      return;
    }
    watcher.on("error", () => {
      if (watchers.get(root) === watcher) watchers.delete(root);
      closeWatcher(watcher);
    });
    watchers.set(root, watcher);
  };

  const refresh = (): void => {
    if (disposed) return;
    const roots = new Set<string>();
    for (const project of listProjectsFromStore()) {
      try {
        for (const root of sessionDirRootsForCwd(project.path)) roots.add(root);
      } catch {
        continue;
      }
    }
    for (const root of roots) watchRoot(root);
    for (const [root, watcher] of watchers) {
      if (!roots.has(root)) {
        watchers.delete(root);
        closeWatcher(watcher);
      }
    }
  };

  return {
    start(): void {
      if (disposed) return;
      refresh();
      const storePath = projectsStoreFilePath();
      if (existsSync(storePath)) {
        try {
          const watcher = watch(storePath, () => refresh());
          watcher.on("error", () => {
            if (projectsWatcher === watcher) projectsWatcher = null;
            closeWatcher(watcher);
          });
          projectsWatcher = watcher;
        } catch {
          projectsWatcher = null;
        }
      }
      refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
      refreshTimer.unref?.();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (notifyTimer) {
        clearTimeout(notifyTimer);
        notifyTimer = null;
      }
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      closeWatcher(projectsWatcher);
      projectsWatcher = null;
      for (const watcher of watchers.values()) closeWatcher(watcher);
      watchers.clear();
    },
  };
}
