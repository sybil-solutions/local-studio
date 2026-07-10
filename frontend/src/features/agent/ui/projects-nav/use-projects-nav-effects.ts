import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";

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
    (async () => {
      const rows = await Promise.all(
        projects.map(async (project) => {
          try {
            const response = await fetch(
              `/api/agent/sessions?cwd=${encodeURIComponent(project.path)}&since=30d&ids=${idsParam}`,
              { cache: "no-store" },
            );
            const payload = await safeJson<{ sessions?: SessionSummary[] }>(response);
            return (payload.sessions ?? [])
              .filter((session) => pinnedIds.has(session.id) && !hiddenIds.has(session.id))
              .map((session) => ({ ...session, project }));
          } catch {
            return [];
          }
        }),
      );
      if (!cancelled) {
        setPinnedSessions(
          rows
            .flat()
            .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, hiddenPrefIdsKey, pinnedPrefIdsKey, projects, setPinnedSessions]);
}

export function useProjectSessionsReloadEffect(reload: () => Promise<void>): void {
  useMountSubscription(() => {
    void reload();
    window.addEventListener(SESSIONS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, reload);
  }, [reload]);
}
