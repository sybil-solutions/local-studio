import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import type { AggregatedSession } from "@shared/agent/session-summary";

import { safeJson } from "@/features/agent/safe-json";
import type { Project as ProjectEntry } from "@/features/agent/projects/types";
import type { SessionSummary } from "@/features/agent/session-summary";
import {
  ADD_PROJECT_EVENT,
  SESSION_PREFS_CHANGED_EVENT,
  SESSIONS_CHANGED_EVENT,
} from "@/lib/workspace-events";
import {
  hydrateSessionPrefsFromDesktop,
  loadSessionPrefs,
  type SessionPrefs,
} from "@/features/agent/messages/prefs";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type PinnedSession = SessionSummary & { project: ProjectEntry };

function uniquePinnedSessions(sessions: readonly PinnedSession[]): PinnedSession[] {
  return [...new Map(sessions.map((session) => [session.id, session])).values()];
}

let cachedSessionPrefs: SessionPrefs = {};
let cachedSessionPrefsKey = "";

function syncSessionPrefsSnapshot(): boolean {
  const next = loadSessionPrefs();
  let nextKey = "";
  try {
    nextKey = JSON.stringify(next);
  } catch {
    nextKey = "";
  }
  if (nextKey === cachedSessionPrefsKey) return false;
  cachedSessionPrefs = next;
  cachedSessionPrefsKey = nextKey;
  return true;
}

function getSessionPrefsSnapshot(): SessionPrefs {
  syncSessionPrefsSnapshot();
  return cachedSessionPrefs;
}

const SESSION_PREFS_SERVER_SNAPSHOT: SessionPrefs = {};
function getSessionPrefsSnapshotServer(): SessionPrefs {
  return SESSION_PREFS_SERVER_SNAPSHOT;
}

export function useProjectsNavSessionPrefs(): SessionPrefs {
  const subscribeSessionPrefs = useCallback((notify: () => void) => {
    void hydrateSessionPrefsFromDesktop();
    const refresh = () => {
      if (syncSessionPrefsSnapshot()) notify();
    };
    window.addEventListener(SESSION_PREFS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_PREFS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return useSyncExternalStore(
    subscribeSessionPrefs,
    getSessionPrefsSnapshot,
    getSessionPrefsSnapshotServer,
  );
}

export function useProjectDirectoryPickerModalEffects({
  loadDirectory,
  open,
}: {
  loadDirectory: (directoryPath?: string) => Promise<void>;
  open: boolean;
}): void {
  useMountSubscription(() => {
    if (!open) return;
    void loadDirectory();
  }, [open, loadDirectory]);
}

export function useProjectsNavAddProjectEffect(handleAddProject: () => void): void {
  useMountSubscription(() => {
    window.addEventListener(ADD_PROJECT_EVENT, handleAddProject);
    return () => window.removeEventListener(ADD_PROJECT_EVENT, handleAddProject);
  }, [handleAddProject]);
}

export function usePinnedSessionsEffect({
  expanded,
  hiddenPrefIdsKey,
  pinnedPrefIdsKey,
  projects,
  setPinnedSessions,
}: {
  expanded: boolean;
  hiddenPrefIdsKey: string;
  pinnedPrefIdsKey: string;
  projects: ProjectEntry[];
  setPinnedSessions: Dispatch<SetStateAction<PinnedSession[]>>;
}): void {
  useMountSubscription(() => {
    if (!expanded || projects.length === 0) {
      queueMicrotask(() => setPinnedSessions([]));
      return;
    }
    if (!pinnedPrefIdsKey) {
      queueMicrotask(() => setPinnedSessions([]));
      return;
    }
    let cancelled = false;
    const pinnedIdsList = pinnedPrefIdsKey.split("\u0000").filter(Boolean);
    const pinnedIds = new Set(pinnedIdsList);
    const hiddenIds = new Set(hiddenPrefIdsKey.split("\u0000").filter(Boolean));
    const idsParam = encodeURIComponent(pinnedIdsList.join(","));
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    (async () => {
      try {
        const response = await fetch(`/api/agent/sessions/all?since=30d&ids=${idsParam}`, {
          cache: "no-store",
        });
        const payload = await safeJson<{ sessions?: AggregatedSession[] }>(response);
        const rows = (payload.sessions ?? []).flatMap((session) => {
          const project = projectsById.get(session.projectId);
          return project && pinnedIds.has(session.id) && !hiddenIds.has(session.id)
            ? [{ ...session, project }]
            : [];
        });
        if (!cancelled) {
          setPinnedSessions(
            uniquePinnedSessions(rows).sort(
              (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
            ),
          );
        }
      } catch {
        if (!cancelled) setPinnedSessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, hiddenPrefIdsKey, pinnedPrefIdsKey, projects, setPinnedSessions]);
}

const SESSIONS_RELOAD_DEBOUNCE_MS = 300;

export function useProjectSessionsReloadEffect(reload: () => Promise<void>): void {
  useMountSubscription(() => {
    void reload();
    // Session lifecycle changes fire SESSIONS_CHANGED_EVENT in bursts (every
    // mounted project row listens, and workspace effects re-dispatch 1.5s
    // later). A trailing debounce collapses each burst into one disk scan per
    // project instead of one per event per row.
    let timer: number | null = null;
    const scheduleReload = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void reload();
      }, SESSIONS_RELOAD_DEBOUNCE_MS);
    };
    window.addEventListener(SESSIONS_CHANGED_EVENT, scheduleReload);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener(SESSIONS_CHANGED_EVENT, scheduleReload);
    };
  }, [reload]);
}
