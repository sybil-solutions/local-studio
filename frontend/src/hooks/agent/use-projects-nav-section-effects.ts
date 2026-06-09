import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";

import { safeJson } from "@/lib/agent/safe-json";
import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
} from "@/lib/agent/active-sessions";
import type { Project as ProjectEntry } from "@/lib/agent/projects/types";
import type { SessionSummary } from "@/lib/agent/session-summary";
import {
  ACTIVE_AGENT_SESSIONS_EVENT,
  ADD_PROJECT_EVENT,
  SESSION_PREFS_CHANGED_EVENT,
  SESSIONS_CHANGED_EVENT,
} from "@/lib/agent/workspace/events";
import {
  hydrateSessionPrefsFromDesktop,
  loadSessionPrefs,
  type SessionPrefs,
} from "@/lib/agent/session/prefs";

type PinnedSession = SessionSummary & { project: ProjectEntry };
type ActiveAgentSession = ActiveAgentSessionSnapshot;
type PinnedActiveSession = ActiveAgentSession & {
  id: string;
  firstUserMessage: string | null;
  project: ProjectEntry;
};

const getProjectsNavSnapshot = (): number => 0;

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

  return useSyncExternalStore(subscribeSessionPrefs, getSessionPrefsSnapshot, () => ({}));
}

export function useProjectDirectoryPickerModalEffects({
  loadDirectory,
  open,
}: {
  loadDirectory: (directoryPath?: string) => Promise<void>;
  open: boolean;
}): void {
  const subscribeDirectoryLoad = useCallback(() => {
    if (!open) return () => undefined;
    void loadDirectory();
    return () => undefined;
  }, [open, loadDirectory]);

  useSyncExternalStore(subscribeDirectoryLoad, getProjectsNavSnapshot, getProjectsNavSnapshot);
}

export function useProjectsNavAddProjectEffect(handleAddProject: () => void): void {
  const subscribeAddProject = useCallback(() => {
    window.addEventListener(ADD_PROJECT_EVENT, handleAddProject);
    return () => window.removeEventListener(ADD_PROJECT_EVENT, handleAddProject);
  }, [handleAddProject]);

  useSyncExternalStore(subscribeAddProject, getProjectsNavSnapshot, getProjectsNavSnapshot);
}

export function useActiveAgentSessionsEffect({
  setActiveSessions,
}: {
  setActiveSessions: Dispatch<SetStateAction<ActiveAgentSession[]>>;
}): void {
  const subscribeActiveSessions = useCallback(() => {
    const onActiveSessions = (event: Event) => {
      const detail = (event as CustomEvent<{ sessions?: ActiveAgentSession[] }>).detail;
      const sessions = Array.isArray(detail?.sessions) ? detail.sessions : [];
      // The broadcaster (workspace effects) already persisted this snapshot
      // before dispatching — re-persisting here was a double merge+write.
      setActiveSessions(
        sessions.length > 0 ? mergeActiveAgentSessions([], sessions, loadSessionPrefs()) : [],
      );
    };
    window.addEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActiveSessions);
    return () => window.removeEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActiveSessions);
  }, [setActiveSessions]);

  useSyncExternalStore(subscribeActiveSessions, getProjectsNavSnapshot, getProjectsNavSnapshot);
}

export function usePinnedSessionsEffect({
  activePiSessionIdsKey,
  activeSessions,
  expanded,
  hiddenPrefIdsKey,
  pinnedPrefIdsKey,
  projects,
  setPinnedSessions,
}: {
  activePiSessionIdsKey: string;
  activeSessions: ActiveAgentSession[];
  expanded: boolean;
  hiddenPrefIdsKey: string;
  pinnedPrefIdsKey: string;
  projects: ProjectEntry[];
  setPinnedSessions: Dispatch<SetStateAction<Array<PinnedSession | PinnedActiveSession>>>;
}): void {
  const subscribePinnedSessions = useCallback(() => {
    if (!expanded || projects.length === 0) {
      queueMicrotask(() => setPinnedSessions([]));
      return () => undefined;
    }
    if (!pinnedPrefIdsKey) {
      queueMicrotask(() => setPinnedSessions([]));
      return () => undefined;
    }
    let cancelled = false;
    const pinnedIdsList = pinnedPrefIdsKey.split("\u0000").filter(Boolean);
    const pinnedIds = new Set(pinnedIdsList);
    const hiddenIds = new Set(hiddenPrefIdsKey.split("\u0000").filter(Boolean));
    const projectsById = new Map(projects.map((project) => [project.id, project] as const));
    const activePinnedRows: PinnedActiveSession[] = activeSessions
      .filter((session) => {
        const keys = [session.piSessionId, `tab:${session.paneId}:${session.tabId}`].filter(
          (id): id is string => Boolean(id),
        );
        return keys.some((id) => pinnedIds.has(id)) && !keys.some((id) => hiddenIds.has(id));
      })
      .flatMap((session) => {
        const project = projectsById.get(session.projectId);
        if (!project) return [];
        return [
          {
            ...session,
            id: session.piSessionId ?? `tab:${session.paneId}:${session.tabId}`,
            firstUserMessage: session.title,
            project,
          },
        ];
      });
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
        const activeIds = new Set(activePinnedRows.map((session) => session.piSessionId));
        setPinnedSessions(
          [
            ...activePinnedRows,
            ...rows.flat().filter((session) => !activeIds.has(session.id)),
          ].sort(
            (a, b) =>
              new Date(("startedAt" in b ? b.startedAt : undefined) || b.updatedAt).getTime() -
              new Date(("startedAt" in a ? a.startedAt : undefined) || a.updatedAt).getTime(),
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activePiSessionIdsKey,
    activeSessions,
    expanded,
    hiddenPrefIdsKey,
    pinnedPrefIdsKey,
    projects,
    setPinnedSessions,
  ]);

  useSyncExternalStore(subscribePinnedSessions, getProjectsNavSnapshot, getProjectsNavSnapshot);
}

export function useProjectSessionsReloadEffect(reload: () => Promise<void>): void {
  const subscribeProjectSessionsReload = useCallback(() => {
    void reload();
    window.addEventListener(SESSIONS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, reload);
  }, [reload]);

  useSyncExternalStore(
    subscribeProjectSessionsReload,
    getProjectsNavSnapshot,
    getProjectsNavSnapshot,
  );
}
