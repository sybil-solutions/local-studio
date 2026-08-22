"use client";

import { useMemo, useState, type DragEvent } from "react";
import type { AggregatedSession } from "@shared/agent/session-summary";
import { safeJson } from "@/features/agent/safe-json";
import {
  isLocalSessionPrefKey,
  patchSessionPref,
  type SessionPrefs,
} from "@/features/agent/messages/session-prefs";
import { uniqueOpenSessions, type OpenAgentSession } from "@/features/agent/session-index";
import { isChatsProject, type Project as ProjectEntry } from "@/features/agent/projects/types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { mergeActiveSessionPref } from "./helpers";
import {
  movePinnedEntryBefore,
  orderPinnedEntries,
  readPinnedSessionOrder,
  writePinnedSessionOrder,
} from "./pinned-order";
import type { PinnedSession } from "./types";

/** Joins id lists into one effect-dependency string; NUL cannot appear in ids. */
const KEY_SEPARATOR = String.fromCharCode(0);

// Projects and sessions share one pin store (the session prefs record) so the
// sidebar has a single source of truth for "what is pinned". Project keys are
// namespaced so session lookups and the sessions API never see them.
const PROJECT_PIN_PREFIX = "project:";

export function projectPinKey(projectId: string): string {
  return `${PROJECT_PIN_PREFIX}${projectId}`;
}

function isProjectPinKey(key: string): boolean {
  return key.startsWith(PROJECT_PIN_PREFIX);
}

export function isProjectPinned(prefs: SessionPrefs, projectId: string): boolean {
  return Boolean(prefs[projectPinKey(projectId)]?.pinned);
}

export function toggleProjectPin(projectId: string, pinned: boolean): void {
  patchSessionPref(projectPinKey(projectId), { pinned: pinned || undefined });
}

export type PinnedNavEntry = {
  id: string;
  identities: readonly string[];
  project: ProjectEntry;
} & (
  | { kind: "project" }
  | { kind: "active"; session: OpenAgentSession }
  | { kind: "history"; session: PinnedSession }
);

export type PinnedNav = {
  entries: PinnedNavEntry[];
  /** Session ids already rendered under Pinned, so other sections skip them. */
  renderedSessionIds: ReadonlySet<string>;
  pinnedProjectIds: ReadonlySet<string>;
  dragging: boolean;
  entryDragProps: (entryId: string) => {
    dragging: boolean;
    onReorderDragStart: () => void;
    onReorderDragEnd: () => void;
    onReorderDragOver: (event: DragEvent) => void;
    onReorderDrop: (event: DragEvent) => void;
  };
  /** Drop target for the list itself — moves the dragged entry to the end. */
  listDropProps: {
    onDragOver: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
};

/** Immutable start time of a pinned session entry; projects sort to the top. */
function pinnedEntryStartTime(entry: PinnedNavEntry): number {
  if (entry.kind === "project") return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(entry.session.startedAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function usePinnedNav({
  expanded,
  projects,
  activeSessions,
  prefs,
}: {
  expanded: boolean;
  projects: ProjectEntry[];
  activeSessions: readonly OpenAgentSession[];
  prefs: SessionPrefs;
}): PinnedNav {
  const [historySessions, setHistorySessions] = useState<PinnedSession[]>([]);
  const [order, setOrder] = useState(readPinnedSessionOrder);
  const [dragId, setDragId] = useState<string | null>(null);

  const pinnedKeys = useMemo(
    () =>
      Object.entries(prefs)
        .filter(([key, pref]) => pref.pinned && !pref.hidden && !isLocalSessionPrefKey(key))
        .map(([key]) => key)
        .sort(),
    [prefs],
  );
  const hiddenKeysKey = useMemo(
    () =>
      Object.entries(prefs)
        .filter(([, pref]) => pref.hidden)
        .map(([key]) => key)
        .sort()
        .join(KEY_SEPARATOR),
    [prefs],
  );
  const pinnedSessionIdsKey = useMemo(
    () => pinnedKeys.filter((key) => !isProjectPinKey(key)).join(KEY_SEPARATOR),
    [pinnedKeys],
  );
  const pinnedProjectIdsKey = useMemo(
    () =>
      pinnedKeys
        .filter(isProjectPinKey)
        .map((key) => key.slice(PROJECT_PIN_PREFIX.length))
        .join(KEY_SEPARATOR),
    [pinnedKeys],
  );
  const pinnedProjectIds = useMemo(
    () => new Set(pinnedProjectIdsKey.split(KEY_SEPARATOR).filter(Boolean)),
    [pinnedProjectIdsKey],
  );

  usePinnedHistorySessions({
    enabled: expanded,
    hiddenKeysKey,
    pinnedSessionIdsKey,
    projects,
    setHistorySessions,
  });

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );
  const pinnedActive = useMemo(
    () =>
      uniqueOpenSessions(activeSessions)
        .filter((session) => {
          const pref = mergeActiveSessionPref(session, prefs);
          return pref.pinned && !pref.hidden;
        })
        .flatMap((session) => {
          const project = projectsById.get(session.projectId);
          return project ? [{ session, project }] : [];
        }),
    [activeSessions, prefs, projectsById],
  );
  const activeSessionIds = useMemo(
    () => new Set(pinnedActive.map(({ session }) => session.threadId ?? session.id)),
    [pinnedActive],
  );
  const renderedSessionIds = useMemo(() => {
    const ids = new Set(activeSessionIds);
    for (const session of historySessions) ids.add(session.id);
    return ids;
  }, [activeSessionIds, historySessions]);

  const entries = useMemo(() => {
    const projectEntries = projects
      .filter((project) => pinnedProjectIds.has(project.id) && !isChatsProject(project))
      .map(
        (project): PinnedNavEntry => ({
          id: projectPinKey(project.id),
          identities: [project.id],
          kind: "project",
          project,
        }),
      );
    const activeEntries = pinnedActive.map(
      ({ session, project }): PinnedNavEntry => ({
        id: session.threadId ?? session.id,
        identities: [session.id, session.threadId].filter((id): id is string => Boolean(id)),
        kind: "active",
        project,
        session,
      }),
    );
    const historyEntries = historySessions
      .filter((session) => !activeSessionIds.has(session.id))
      .map(
        (session): PinnedNavEntry => ({
          id: session.id,
          identities: [session.id],
          kind: "history",
          project: session.project,
          session,
        }),
      );
    // Order active and history session entries together by their (immutable)
    // start time. Opening a pinned session flips it from a "history" entry to an
    // "active" one - sorting on start time keeps its slot fixed across that flip,
    // instead of promoting it above the still-closed entries (issue #275).
    const sessionEntries = [...activeEntries, ...historyEntries].sort(
      (left, right) => pinnedEntryStartTime(right) - pinnedEntryStartTime(left),
    );
    return orderPinnedEntries([...projectEntries, ...sessionEntries], order);
  }, [activeSessionIds, historySessions, order, pinnedActive, pinnedProjectIds, projects]);

  const moveBefore = (draggedId: string, targetId: string | null) => {
    setOrder((current) => {
      const next = movePinnedEntryBefore(entries, current, draggedId, targetId);
      writePinnedSessionOrder(next);
      return next;
    });
  };

  return {
    entries,
    renderedSessionIds,
    pinnedProjectIds,
    dragging: dragId !== null,
    entryDragProps: (entryId: string) => ({
      dragging: dragId === entryId,
      onReorderDragStart: () => setDragId(entryId),
      onReorderDragEnd: () => setDragId(null),
      onReorderDragOver: (event: DragEvent) => {
        if (dragId && dragId !== entryId) event.preventDefault();
      },
      onReorderDrop: (event: DragEvent) => {
        if (!dragId) return;
        event.preventDefault();
        event.stopPropagation();
        if (dragId !== entryId) moveBefore(dragId, entryId);
        setDragId(null);
      },
    }),
    listDropProps: {
      onDragOver: (event: DragEvent) => {
        if (dragId) event.preventDefault();
      },
      onDrop: (event: DragEvent) => {
        if (!dragId) return;
        event.preventDefault();
        moveBefore(dragId, null);
        setDragId(null);
      },
    },
  };
}

/** Pinned sessions can live outside the 7d window a project row loads, so they
 *  are fetched by id from the cross-project index. */
function usePinnedHistorySessions({
  enabled,
  hiddenKeysKey,
  pinnedSessionIdsKey,
  projects,
  setHistorySessions,
}: {
  enabled: boolean;
  hiddenKeysKey: string;
  pinnedSessionIdsKey: string;
  projects: ProjectEntry[];
  setHistorySessions: (sessions: PinnedSession[]) => void;
}): void {
  useMountSubscription(() => {
    if (!enabled || projects.length === 0 || !pinnedSessionIdsKey) {
      queueMicrotask(() => setHistorySessions([]));
      return;
    }
    let cancelled = false;
    const pinnedIdsList = pinnedSessionIdsKey.split(KEY_SEPARATOR).filter(Boolean);
    const pinnedIds = new Set(pinnedIdsList);
    const hiddenIds = new Set(hiddenKeysKey.split(KEY_SEPARATOR).filter(Boolean));
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    (async () => {
      try {
        const response = await fetch(
          `/api/agent/sessions/all?since=30d&ids=${encodeURIComponent(pinnedIdsList.join(","))}`,
          { cache: "no-store" },
        );
        const payload = await safeJson<{ sessions?: AggregatedSession[] }>(response);
        const rows = (payload.sessions ?? []).flatMap((session) => {
          const project = projectsById.get(session.projectId);
          return project && pinnedIds.has(session.id) && !hiddenIds.has(session.id)
            ? [{ ...session, project }]
            : [];
        });
        if (cancelled) return;
        const unique = [...new Map(rows.map((session) => [session.id, session])).values()];
        setHistorySessions(
          unique.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
        );
      } catch {
        if (!cancelled) setHistorySessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, hiddenKeysKey, pinnedSessionIdsKey, projects, setHistorySessions]);
}
