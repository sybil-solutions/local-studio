"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { safeJson } from "@/features/agent/safe-json";
import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import {
  patchSessionPref,
  type SessionPref,
  type SessionPrefs,
} from "@/features/agent/messages/prefs";
import { useProjectSessionsReloadEffect } from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import { workspaceCommands } from "@/features/agent/workspace/commands";
import type { Project as ProjectEntry } from "@/features/agent/projects/types";
import { ChatIcon, Folder, FolderOpen, PlusIcon, TrashIcon } from "@/ui/icons";
import {
  mergeActiveSessionPref,
  patchActiveSessionPref,
  relativeAge,
  rememberAgentSessionNavTitle,
  sessionDedupeKey,
  setAgentSessionDragData,
  setSessionArchive,
} from "./helpers";
import { SessionNavRow } from "./session-nav-row";
import type { ActiveAgentSession, SessionSummary } from "./types";

/**
 * The set of session ids the runtime currently reports as actively working —
 * including sessions running in the BACKGROUND (not open in any pane). Lets the
 * sidebar show a working indicator on history rows so a turn started in another
 * chat isn't invisible after you switch away.
 */
function useActiveRuntimeIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    (notify) => sessionRuntimeController().subscribeActiveRuntimeIds(notify),
    () => sessionRuntimeController().getActiveRuntimeIds(),
    () => sessionRuntimeController().getActiveRuntimeIds(),
  );
}

/** Session ids that finished working while you weren't looking — the dot. */
function useUnseenFinishedIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    (notify) => sessionRuntimeController().subscribeActiveRuntimeIds(notify),
    () => sessionRuntimeController().getUnseenFinishedIds(),
    () => sessionRuntimeController().getUnseenFinishedIds(),
  );
}

export function ProjectRow({
  project,
  open,
  onToggle,
  onRemove,
  onNewChatStart,
  activeSessions,
  prefs,
  excludedIds,
  icon = "folder",
}: {
  project: ProjectEntry;
  open: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  onNewChatStart?: () => void;
  activeSessions: ActiveAgentSession[];
  prefs: SessionPrefs;
  excludedIds: ReadonlySet<string>;
  icon?: "folder" | "chat";
}) {
  const [missingErrorVisible, setMissingErrorVisible] = useState(false);
  const handleToggle = () => {
    if (!project.exists) {
      setMissingErrorVisible(true);
      return;
    }
    setMissingErrorVisible(false);
    onToggle();
  };

  return (
    <div className="flex flex-col">
      <div className="group relative flex h-7 items-center rounded-md pl-2 pr-1.5 text-(--dim)/70 transition-colors hover:bg-(--color-surface-hover) hover:text-(--fg)/80">
        <button
          type="button"
          onClick={handleToggle}
          title={project.path}
          className="flex min-w-0 flex-1 items-center gap-2 px-0 pr-8 text-left"
        >
          {icon === "chat" ? (
            <ChatIcon className="h-3.5 w-3.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-75" />
          ) : (
            <span className="relative h-3.5 w-3.5 shrink-0 opacity-55 transition-opacity group-hover:opacity-75">
              <Folder
                className={`absolute inset-0 h-3.5 w-3.5 transition-all duration-150 ${open ? "scale-90 opacity-0" : "scale-100 opacity-100"}`}
              />
              <FolderOpen
                className={`absolute inset-0 h-3.5 w-3.5 transition-all duration-150 ${open ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}
              />
            </span>
          )}
          <span className="truncate text-[length:var(--fs-lg)] font-normal text-(--dim) transition-colors group-hover:text-(--fg)/85">
            {project.name}
          </span>
          {!project.exists ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--warn)"
              title={project.path}
              aria-label={`Folder not found at ${project.path}`}
            />
          ) : null}
        </button>
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
          <NewChatPlusButton
            projectId={project.id}
            label={`New chat in ${project.name}`}
            className="flex h-5 w-5 items-center justify-center text-(--dim)/55 hover:text-(--fg)/80"
            onNavigateStart={onNewChatStart}
          />
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove();
            }}
            className="absolute right-6 top-1/2 -translate-y-1/2 p-0.5 text-(--dim)/55 opacity-0 hover:text-(--err) group-hover:opacity-100"
            title="Remove from list"
            aria-label="Remove project"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {missingErrorVisible && !project.exists ? (
        <div className="pl-12 pr-2 pb-1 text-[length:var(--fs-md)] text-(--err)">
          <span>Folder not found at {project.path}</span>
          <button
            type="button"
            onClick={onRemove}
            disabled={!onRemove}
            className="ml-2 text-(--dim) underline underline-offset-2 hover:text-(--fg)"
          >
            Remove
          </button>
        </div>
      ) : null}
      {open && project.exists ? (
        <ProjectSessions
          project={project}
          activeSessions={activeSessions}
          prefs={prefs}
          excludedIds={excludedIds}
        />
      ) : null}
    </div>
  );
}

export function ProjectSessions({
  project,
  activeSessions,
  prefs,
  excludedIds,
}: {
  project: ProjectEntry;
  activeSessions: ActiveAgentSession[];
  prefs: SessionPrefs;
  excludedIds: ReadonlySet<string>;
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRuntimeIds = useActiveRuntimeIds();
  const unseenFinishedIds = useUnseenFinishedIds();
  const projectActiveSessions = useMemo(
    () => activeSessions.filter((session) => session.projectId === project.id),
    [activeSessions, project.id],
  );
  const activePiSessionIds = useMemo(
    () =>
      new Set(
        projectActiveSessions
          .map((session) => session.piSessionId)
          .filter((id): id is string => Boolean(id)),
      ),
    [projectActiveSessions],
  );
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/agent/sessions?cwd=${encodeURIComponent(project.path)}&since=7d`,
        { cache: "no-store" },
      );
      const payload = await safeJson<{ sessions?: SessionSummary[] }>(response);
      setSessions(payload.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [project.path]);

  useProjectSessionsReloadEffect(reload);

  const visibleActiveSessions = useMemo(
    () =>
      projectActiveSessions.filter((session) => {
        const pref = mergeActiveSessionPref(session, prefs);
        if (pref?.pinned) return false;
        if (session.piSessionId && excludedIds.has(session.piSessionId)) return false;
        return !pref?.hidden;
      }),
    [projectActiveSessions, prefs, excludedIds],
  );
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const recentSessions: SessionSummary[] = [];
    for (const session of sessions ?? []) {
      if (activePiSessionIds.has(session.id)) continue;
      if (excludedIds.has(session.id)) continue;
      if (prefs[session.id]?.pinned) continue;
      if (prefs[session.id]?.hidden) continue;
      const key = sessionDedupeKey(session);
      if (seen.has(session.id) || seen.has(key)) continue;
      seen.add(session.id);
      seen.add(key);
      recentSessions.push(session);
    }
    return recentSessions;
  }, [sessions, activePiSessionIds, excludedIds, prefs]);

  // Original start time per session id, from the server history list (stable —
  // it does not change when a session is opened). Used to anchor an open
  // session to its real position even if its live snapshot's startedAt was
  // reset on open.
  const historyStartByPiId = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of sessions ?? []) {
      const at = Date.parse(session.startedAt) || 0;
      if (at) map.set(session.id, at);
    }
    return map;
  }, [sessions]);

  // ONE list ordered by stable start time. Open sessions are NOT promoted to a
  // separate top block — that made opening a chat reshuffle the sidebar and lose
  // the user's place. Each session keeps its position whether or not it's open;
  // the open one just renders as a live ActiveSessionRow in situ.
  const orderedRows = useMemo<NavRow[]>(() => {
    const rows: NavRow[] = [];
    for (const session of visibleActiveSessions) {
      const historyStart = session.piSessionId
        ? historyStartByPiId.get(session.piSessionId)
        : undefined;
      rows.push({
        kind: "active",
        key: `${session.paneId}:${session.tabId}`,
        sortAt: historyStart ?? (Date.parse(session.startedAt ?? session.updatedAt) || 0),
        active: session,
      });
    }
    for (const session of recent) {
      rows.push({
        kind: "recent",
        key: session.id,
        sortAt: Date.parse(session.startedAt) || 0,
        recent: session,
      });
    }
    rows.sort((a, b) => b.sortAt - a.sortAt);
    return rows;
  }, [visibleActiveSessions, recent, historyStartByPiId]);

  return (
    <div className="flex flex-col">
      {loading && !sessions ? (
        <div className="pl-2 pr-2 py-0.5 text-[length:var(--fs-sm)] text-(--dim)">Loading...</div>
      ) : orderedRows.length === 0 ? (
        <div className="pl-2 pr-2 py-0.5 text-[length:var(--fs-sm)] text-(--dim)">No chats</div>
      ) : (
        orderedRows.map((row) =>
          row.kind === "active" ? (
            <ActiveSessionRow
              key={row.key}
              project={project}
              session={row.active}
              pref={mergeActiveSessionPref(row.active, prefs)}
            />
          ) : (
            <SessionRow
              key={row.key}
              project={project}
              session={row.recent}
              pref={prefs[row.recent.id] ?? {}}
              isRunning={activeRuntimeIds.has(row.recent.id)}
              unseen={unseenFinishedIds.has(row.recent.id)}
            />
          ),
        )
      )}
    </div>
  );
}

type NavRow =
  | { kind: "active"; key: string; sortAt: number; active: ActiveAgentSession }
  | { kind: "recent"; key: string; sortAt: number; recent: SessionSummary };

export function ActiveSessionRow({
  project,
  session,
  pref,
}: {
  project: ProjectEntry;
  session: ActiveAgentSession;
  pref: SessionPref;
}) {
  const label =
    cleanSessionTitle(pref.title) || cleanSessionTitle(session.title) || "Current session";
  const isFocused = session.focused === true;
  const rowClass = `group relative flex h-6 items-center rounded-md pl-3 pr-0 transition-colors ${isFocused ? "bg-(--color-surface-hover) text-(--fg)" : "text-(--fg)/72 hover:bg-(--color-surface-hover) hover:text-(--fg)/95"}`;

  return (
    <SessionNavRow
      pref={pref}
      label={label}
      initialDraft={cleanSessionTitle(pref.title) || cleanSessionTitle(session.title)}
      age={relativeAge(session.startedAt ?? session.updatedAt)}
      rowClass={rowClass}
      href={
        session.piSessionId
          ? `/agent?project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(session.piSessionId)}`
          : undefined
      }
      onOpen={() => workspaceCommands().focusSession(session.paneId, session.tabId)}
      onPatchPref={(patch) => patchActiveSessionPref(session, patch)}
      onRenameCommit={(trimmed) =>
        workspaceCommands().renameSession(
          session.paneId,
          session.tabId,
          cleanSessionTitle(trimmed) || cleanSessionTitle(session.title) || label,
        )
      }
      onRememberTitle={() => rememberAgentSessionNavTitle(session.piSessionId, label)}
      onDragStart={(event) => setAgentSessionDragData(event, session)}
      isRunning={session.status !== "idle" && session.status !== "done"}
      unseen={session.unseen === true && !isFocused}
      canDoubleClickRename
      renameInputClass="text-[length:var(--fs-xs)]"
    />
  );
}

export function SessionRow({
  project,
  session,
  pref,
  isRunning = false,
  unseen = false,
}: {
  project: ProjectEntry;
  session: SessionSummary;
  pref: SessionPref;
  isRunning?: boolean;
  unseen?: boolean;
}) {
  const label =
    cleanSessionTitle(pref.title) ||
    cleanSessionTitle(session.firstUserMessage) ||
    "Untitled session";

  return (
    <SessionNavRow
      pref={pref}
      label={label}
      initialDraft={cleanSessionTitle(pref.title) || cleanSessionTitle(session.firstUserMessage)}
      age={relativeAge(session.startedAt)}
      isRunning={isRunning}
      unseen={unseen}
      rowClass="group relative flex h-6 items-center rounded-md pl-3 pr-0 text-(--fg)/72 transition-colors hover:bg-(--color-surface-hover) hover:text-(--fg)/95"
      renameRowClass="flex h-6 items-center rounded-md bg-(--surface)/40 pl-3 pr-1"
      href={`/agent?project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(session.id)}`}
      onPatchPref={(patch) => patchSessionPref(session.id, patch)}
      onArchive={() => {
        void setSessionArchive(session.id, project, label, true)
          .then(() => patchSessionPref(session.id, { hidden: undefined }))
          .catch((error) => {
            console.warn("[agent] failed to archive session", error);
          });
      }}
      onRememberTitle={() => {
        rememberAgentSessionNavTitle(session.id, label);
        sessionRuntimeController().markRuntimeSeen(session.id);
      }}
      onDragStart={(event) => {
        setAgentSessionDragData(event, {
          piSessionId: session.id,
          projectId: project.id,
          cwd: project.path,
          title: label,
        });
      }}
      onContextMenu
      showClearAction
    />
  );
}

export function NewChatPlusButton({
  projectId,
  label,
  className,
  onNavigateStart,
}: {
  projectId: string;
  label: string;
  className: string;
  onNavigateStart?: () => void;
}) {
  const router = useRouter();
  const href = `/agent?project=${encodeURIComponent(projectId)}&new=1`;
  return (
    <div className="relative flex items-center justify-center leading-none">
      <Link
        href={href}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          event.stopPropagation();
          onNavigateStart?.();
          router.push(
            `/agent?project=${encodeURIComponent(projectId)}&new=${Date.now().toString(36)}`,
          );
        }}
        className={className}
        aria-label={label}
        title={label}
      >
        <PlusIcon className="block h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
