"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { safeJson } from "@/lib/agent/safe-json";
import { cleanSessionTitle } from "@/lib/agent/session/helpers";
import { patchSessionPref, type SessionPref, type SessionPrefs } from "@/lib/agent/session/prefs";
import { useProjectSessionsReloadEffect } from "@/hooks/agent/use-projects-nav-section-effects";
import {
  ACTIVE_AGENT_SESSION_OPEN_EVENT,
  ACTIVE_AGENT_SESSION_RENAME_EVENT,
} from "@/lib/agent/workspace/events";
import type { Project as ProjectEntry } from "@/lib/agent/projects/types";
import { ChatIcon, Folder, FolderOpen, PlusIcon, TrashIcon } from "@/ui/icons";
import {
  activeSessionPref,
  patchActiveSessionPref,
  relativeAge,
  rememberAgentSessionNavTitle,
  sessionDedupeKey,
  setAgentSessionDragData,
  setSessionArchive,
} from "./helpers";
import { SessionNavRow } from "./session-nav-row";
import type { ActiveAgentSession, SessionSummary } from "./types";

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
      <div className="group relative flex h-7 items-center rounded-md pl-2 pr-1.5 text-(--dim)/70 transition-colors hover:bg-(--hover) hover:text-(--fg)/80">
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
          <span className="truncate text-[length:var(--fs-base)] font-normal text-(--dim) transition-colors group-hover:text-(--fg)/85">
            {project.name}
          </span>
          {!project.exists ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
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
        <div className="pl-12 pr-2 pb-1 text-[length:var(--fs-md)] text-red-400">
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
        const pref = activeSessionPref(session, prefs);
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

  return (
    <div className="flex flex-col">
      {visibleActiveSessions.map((session) => (
        <ActiveSessionRow
          key={`${session.paneId}:${session.tabId}`}
          project={project}
          session={session}
          pref={activeSessionPref(session, prefs)}
        />
      ))}
      {loading && !sessions ? (
        <div className="pl-2 pr-2 py-0.5 text-[length:var(--fs-sm)] text-(--dim)">Loading...</div>
      ) : recent.length === 0 && visibleActiveSessions.length === 0 ? (
        <div className="pl-2 pr-2 py-0.5 text-[length:var(--fs-sm)] text-(--dim)">No chats</div>
      ) : (
        recent.map((session) => (
          <SessionRow
            key={session.id}
            project={project}
            session={session}
            pref={prefs[session.id] ?? {}}
          />
        ))
      )}
    </div>
  );
}

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
  const rowClass = `group relative flex h-6 items-center rounded-md pl-3 pr-0 transition-colors ${isFocused ? "bg-(--hover) text-(--fg)" : "text-(--fg)/72 hover:bg-(--hover) hover:text-(--fg)/95"}`;

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
      onOpen={() => {
        window.dispatchEvent(
          new CustomEvent(ACTIVE_AGENT_SESSION_OPEN_EVENT, {
            detail: {
              paneId: session.paneId,
              tabId: session.tabId,
              piSessionId: session.piSessionId,
              projectId: project.id,
              cwd: session.cwd || project.path,
              title: label,
              mode: "focus",
            },
          }),
        );
      }}
      onPatchPref={(patch) => patchActiveSessionPref(session, patch)}
      onRenameCommit={(trimmed) => {
        window.dispatchEvent(
          new CustomEvent(ACTIVE_AGENT_SESSION_RENAME_EVENT, {
            detail: {
              paneId: session.paneId,
              tabId: session.tabId,
              title: cleanSessionTitle(trimmed) || cleanSessionTitle(session.title) || label,
            },
          }),
        );
      }}
      onRememberTitle={() => rememberAgentSessionNavTitle(session.piSessionId, label)}
      onDragStart={(event) => setAgentSessionDragData(event, session)}
      isRunning={session.status !== "idle" && session.status !== "done"}
      canDoubleClickRename
      menuIconClass="h-3.5 w-3.5"
      renameInputClass="text-[length:var(--fs-xs)]"
    />
  );
}

export function SessionRow({
  project,
  session,
  pref,
}: {
  project: ProjectEntry;
  session: SessionSummary;
  pref: SessionPref;
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
      rowClass="group relative flex h-6 items-center rounded-md pl-3 pr-0 text-(--fg)/72 transition-colors hover:bg-(--hover) hover:text-(--fg)/95"
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
      onRememberTitle={() => rememberAgentSessionNavTitle(session.id, label)}
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
      menuItemsWithIcons
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
