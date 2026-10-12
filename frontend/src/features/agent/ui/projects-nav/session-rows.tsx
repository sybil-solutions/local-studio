"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { safeJson } from "@/features/agent/safe-json";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import {
  markSessionActivitySeen,
  sessionRows,
  useSessionActivity,
  type SessionActivity,
} from "@/features/agent/session-index";
import {
  patchSessionPref,
  type SessionPref,
  type SessionPrefs,
} from "@/features/agent/messages/prefs";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useProjectSessionsReloadEffect } from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import { workspaceCommands } from "@/features/agent/workspace/commands";
import type { Project as ProjectEntry } from "@/features/agent/projects/types";
import { ChatIcon, Folder, FolderOpen, PlusIcon, TrashIcon } from "@/ui/icons";
import {
  mergeActiveSessionPref,
  patchActiveSessionPref,
  rememberAgentSessionNavTitle,
  setAgentSessionDragData,
  setSessionArchive,
  hrefWithOpenNonce,
} from "./helpers";
import { PinButton, SidebarRail } from "./nav-chrome";
import { SessionNavRow } from "./session-nav-row";
import type { ActiveAgentSession, SessionSummary } from "./types";

const SESSIONS_PAGE_SIZE = 5;

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
  pinned = false,
  onTogglePin,
  dragging = false,
  reorderDraggable = false,
  onReorderDragStart,
  onReorderDragEnd,
  onReorderDragOver,
  onReorderDrop,
}: {
  project: ProjectEntry;
  open: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  onNewChatStart?: () => void;
  activeSessions: readonly ActiveAgentSession[];
  prefs: SessionPrefs;
  excludedIds: ReadonlySet<string>;
  icon?: "folder" | "chat";
  pinned?: boolean;
  onTogglePin?: () => void;
  dragging?: boolean;
  reorderDraggable?: boolean;
  onReorderDragStart?: () => void;
  onReorderDragEnd?: () => void;
  onReorderDragOver?: (event: DragEvent) => void;
  onReorderDrop?: (event: DragEvent) => void;
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
      <div
        className={`group relative flex h-[var(--sidebar-row-height)] items-center rounded-[var(--sidebar-row-radius)] px-2 text-(--fg) transition-colors hover:bg-(--hover) ${dragging ? "opacity-45" : ""}`}
        draggable={reorderDraggable}
        onDragStart={onReorderDragStart}
        onDragEnd={onReorderDragEnd}
        onDragOver={onReorderDragOver}
        onDrop={onReorderDrop}
      >
        <button
          type="button"
          onClick={handleToggle}
          title={project.path}
          className={`flex min-w-0 flex-1 items-center gap-2 px-0 text-left ${
            pinned ? "pr-[62px]" : "pr-8 group-hover:pr-[62px]"
          }`}
        >
          {icon === "chat" ? (
            <ChatIcon className="h-4 w-4 shrink-0 opacity-80 transition-opacity group-hover:opacity-100" />
          ) : (
            <span className="relative h-4 w-4 shrink-0 opacity-80 transition-opacity group-hover:opacity-100">
              <Folder
                className={`absolute inset-0 h-4 w-4 transition-all duration-150 ${open ? "scale-90 opacity-0" : "scale-100 opacity-100"}`}
              />
              <FolderOpen
                className={`absolute inset-0 h-4 w-4 transition-all duration-150 ${open ? "scale-100 opacity-100" : "scale-90 opacity-0"}`}
              />
            </span>
          )}
          <span className="truncate text-[length:var(--fs-md)] font-normal">{project.name}</span>
          {!project.exists ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--warn)"
              title={project.path}
              aria-label={`Folder not found at ${project.path}`}
            />
          ) : null}
        </button>
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {onTogglePin ? (
            <PinButton pinned={pinned} onToggle={onTogglePin} target={project.name} />
          ) : null}
          {onRemove ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove();
              }}
              className="flex h-5 w-5 items-center justify-center text-(--dim)/55 opacity-0 transition-opacity hover:text-(--err) group-hover:opacity-100"
              title="Remove from list"
              aria-label="Remove project"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <NewChatPlusButton
            project={project}
            label={`New task in ${project.name}`}
            className="flex h-5 w-5 items-center justify-center text-(--dim)/55 opacity-0 transition-opacity hover:text-(--fg)/80 group-hover:opacity-100"
            onNavigateStart={onNewChatStart}
          />
        </div>
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
  activeSessions: readonly ActiveAgentSession[];
  prefs: SessionPrefs;
  excludedIds: ReadonlySet<string>;
}) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(SESSIONS_PAGE_SIZE);
  const activity = useSessionActivity();
  const projectActiveSessions = useMemo(
    () => activeSessions.filter((session) => session.projectId === project.id),
    [activeSessions, project.id],
  );
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/agent/sessions?cwd=${encodeURIComponent(project.path)}&since=7d&limit=${visibleLimit + 9}`,
        { cache: "no-store" },
      );
      const payload = await safeJson<{ sessions?: SessionSummary[] }>(response);
      setSessions(payload.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [project.path, visibleLimit]);

  useProjectSessionsReloadEffect(reload);

  const visibleActiveSessions = useMemo(
    () =>
      projectActiveSessions.filter((session) => {
        const pref = mergeActiveSessionPref(session, prefs);
        if (pref?.pinned) return false;
        if (session.threadId && excludedIds.has(session.threadId)) return false;
        return !pref?.hidden;
      }),
    [projectActiveSessions, prefs, excludedIds],
  );
  const recent = useMemo(() => {
    return (sessions ?? []).filter(
      (session) =>
        !session.parentSessionId &&
        !excludedIds.has(session.id) &&
        !prefs[session.id]?.pinned &&
        !prefs[session.id]?.hidden,
    );
  }, [sessions, excludedIds, prefs]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const session of sessions ?? []) {
      if (!session.parentSessionId || prefs[session.id]?.hidden) continue;
      const list = map.get(session.parentSessionId) ?? [];
      list.push(session);
      map.set(session.parentSessionId, list);
    }
    return map;
  }, [sessions, prefs]);
  const orderedRows = useMemo(
    () => sessionRows(visibleActiveSessions, recent, activity),
    [visibleActiveSessions, recent, activity],
  );
  const visibleRows = orderedRows.slice(0, visibleLimit);
  const hasMore = orderedRows.length > visibleLimit || (sessions?.length ?? 0) > visibleLimit;

  return (
    <SidebarRail>
      {loading && !sessions ? (
        <div className="pl-2 pr-2 py-0.5 text-[length:var(--fs-sm)] text-(--dim)">Loading...</div>
      ) : orderedRows.length === 0 ? (
        <div className="pl-2 pr-2 py-0.5 text-[length:var(--fs-sm)] text-(--dim)">No chats</div>
      ) : (
        visibleRows.map((row) => {
          const parentId = row.kind === "open" ? row.session.threadId : row.session.id;
          const subagents = parentId ? childrenByParent.get(parentId) : undefined;
          return (
            <div key={row.key} className="flex flex-col">
              {row.kind === "open" ? (
                <ActiveSessionRow
                  project={project}
                  session={row.session}
                  pref={mergeActiveSessionPref(row.session, prefs)}
                  activity={row.activity}
                />
              ) : (
                <SessionRow
                  project={project}
                  session={row.session}
                  pref={prefs[row.session.id] ?? {}}
                  activity={row.activity}
                />
              )}
              {subagents?.length ? (
                <SubagentSessionRows project={project} sessions={subagents} prefs={prefs} />
              ) : null}
            </div>
          );
        })
      )}
      {hasMore ? (
        <button
          type="button"
          onClick={() => setVisibleLimit((value) => value + SESSIONS_PAGE_SIZE)}
          className="flex h-[var(--sidebar-row-height)] items-center rounded-[var(--sidebar-row-radius)] pl-3 pr-2 text-left text-[length:var(--fs-sm)] text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
        >
          Show more
        </button>
      ) : null}
    </SidebarRail>
  );
}

function SubagentSessionRows({
  project,
  sessions,
  prefs,
}: {
  project: ProjectEntry;
  sessions: SessionSummary[];
  prefs: SessionPrefs;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-[14px] flex flex-col pl-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-[var(--sidebar-row-height)] items-center gap-1.5 rounded-[var(--sidebar-row-radius)] pl-2 pr-2 text-left text-[length:var(--fs-sm)] text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
        aria-expanded={open}
      >
        <span
          className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ›
        </span>
        {sessions.length} subagent{sessions.length === 1 ? "" : "s"}
      </button>
      {open
        ? sessions.map((session) => (
            <SessionRow
              key={session.id}
              project={project}
              session={session}
              pref={{
                ...(prefs[session.id] ?? {}),
                title: prefs[session.id]?.title ?? session.subagentName ?? undefined,
              }}
            />
          ))
        : null}
    </div>
  );
}

export function ActiveSessionRow({
  project,
  session,
  pref,
  activity,
  dragging = false,
  onReorderDragStart,
  onReorderDragEnd,
  onReorderDragOver,
  onReorderDrop,
}: {
  project: ProjectEntry;
  session: ActiveAgentSession;
  pref: SessionPref;
  activity: SessionActivity;
  dragging?: boolean;
  onReorderDragStart?: () => void;
  onReorderDragEnd?: () => void;
  onReorderDragOver?: (event: DragEvent) => void;
  onReorderDrop?: (event: DragEvent) => void;
}) {
  const label =
    cleanSessionTitle(pref.title) || cleanSessionTitle(session.title) || "Current session";
  const isFocused = session.focused === true;
  const rowClass = `group relative flex h-[var(--sidebar-row-height)] items-center rounded-[var(--sidebar-row-radius)] pl-2 pr-0 transition-[color,background-color,opacity] ${dragging ? "opacity-45" : ""} ${isFocused ? "bg-(--hover) text-(--fg)" : "hover:bg-(--hover)"}`;

  return (
    <SessionNavRow
      pref={pref}
      label={label}
      initialDraft={cleanSessionTitle(pref.title) || cleanSessionTitle(session.title)}
      rowClass={rowClass}
      href={`/agent?project=${encodeURIComponent(project.id)}${
        session.threadId ? `&session=${encodeURIComponent(session.threadId)}&replace=1` : ""
      }`}
      onOpen={() => {
        if (session.paneId && !session.threadId) {
          workspaceCommands().focusSession(session.paneId, session.id, {
            replaceWorkspace: true,
          });
        }
      }}
      onPatchPref={(patch) => patchActiveSessionPref(session, patch)}
      // Archive is keyed on the pi session id, which an open tab only has once
      // its thread exists; without it there is nothing on disk to archive.
      onArchive={
        session.threadId
          ? () => {
              const threadId = session.threadId as string;
              void setSessionArchive(threadId, project, label, true)
                .then(() => patchSessionPref(threadId, { hidden: undefined, pinned: undefined }))
                .catch((error) => {
                  console.warn("[agent] failed to archive session", error);
                });
            }
          : undefined
      }
      onRenameCommit={(trimmed) =>
        workspaceCommands().renameSession(
          session.paneId,
          session.id,
          cleanSessionTitle(trimmed) || cleanSessionTitle(session.title) || label,
        )
      }
      onRememberTitle={() => {
        rememberAgentSessionNavTitle(session.threadId, label);
        markSessionActivitySeen(session.id, session.threadId);
      }}
      onDragStart={(event) => {
        setAgentSessionDragData(event, {
          piSessionId: session.threadId,
          projectId: session.projectId,
          cwd: session.cwd,
          paneId: session.paneId,
          tabId: session.id,
          title: session.title,
        });
        onReorderDragStart?.();
      }}
      onDragEnd={onReorderDragEnd}
      onDragOver={onReorderDragOver}
      onDrop={onReorderDrop}
      // The focused row is the one being read, so its unseen/finished marks
      // have already served their purpose; only the live spinner survives focus.
      activity={isFocused && activity !== "running" ? "idle" : activity}
      timestamp={session.updatedAt || session.startedAt}
      canDoubleClickRename
      renameInputClass="text-[length:var(--fs-xs)]"
    />
  );
}

export function SessionRow({
  project,
  session,
  pref,
  activity = "idle",
  dragging = false,
  onReorderDragStart,
  onReorderDragEnd,
  onReorderDragOver,
  onReorderDrop,
}: {
  project: ProjectEntry;
  session: SessionSummary;
  pref: SessionPref;
  activity?: SessionActivity;
  dragging?: boolean;
  onReorderDragStart?: () => void;
  onReorderDragEnd?: () => void;
  onReorderDragOver?: (event: DragEvent) => void;
  onReorderDrop?: (event: DragEvent) => void;
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
      activity={activity}
      timestamp={session.updatedAt || session.startedAt}
      rowClass={`group relative flex h-[var(--sidebar-row-height)] items-center rounded-[var(--sidebar-row-radius)] pl-2 pr-0 transition-[color,background-color,opacity] hover:bg-(--hover) ${dragging ? "opacity-45" : ""}`}
      renameRowClass="flex h-[var(--sidebar-row-height)] items-center rounded-[var(--sidebar-row-radius)] bg-(--surface)/40 pl-2 pr-1"
      href={`/agent?project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(session.id)}&replace=1`}
      onPatchPref={(patch) => patchSessionPref(session.id, patch)}
      onArchive={() => {
        void setSessionArchive(session.id, project, label, true)
          .then(() => patchSessionPref(session.id, { hidden: undefined, pinned: undefined }))
          .catch((error) => {
            console.warn("[agent] failed to archive session", error);
          });
      }}
      onRememberTitle={() => {
        rememberAgentSessionNavTitle(session.id, label);
        markSessionActivitySeen(session.id);
      }}
      onDragStart={(event) => {
        setAgentSessionDragData(event, {
          piSessionId: session.id,
          projectId: project.id,
          cwd: project.path,
          title: label,
        });
        onReorderDragStart?.();
      }}
      onDragEnd={onReorderDragEnd}
      onDragOver={onReorderDragOver}
      onDrop={onReorderDrop}
      onContextMenu
      showClearAction
    />
  );
}

export function NewChatPlusButton({
  project,
  label,
  className,
  onNavigateStart,
}: {
  project: ProjectEntry;
  label: string;
  className: string;
  onNavigateStart?: () => void;
}) {
  const router = useRouter();
  const openNewChat = () => {
    onNavigateStart?.();
    const href = hrefWithOpenNonce(
      `/agent?project=${encodeURIComponent(project.id)}&new=1&replace=1`,
    );
    router.push(href);
  };

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openNewChat();
      }}
      className={className}
      aria-label={label}
      title={label}
    >
      <PlusIcon className="block h-3.5 w-3.5" />
    </button>
  );
}
