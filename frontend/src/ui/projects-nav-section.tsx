"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ChevronDownIcon, PlusIcon } from "@/ui/icons";
import {
  useActiveAgentSessionsEffect,
  usePinnedSessionsEffect,
  useProjectsNavAddProjectEffect,
  useProjectsNavSessionPrefs,
} from "@/hooks/agent/use-projects-nav-section-effects";
import { loadPersistedActiveAgentSessions } from "@/lib/agent/workspace/store";
import { useProjects } from "@/lib/agent/projects/context";
import { addProjectFromPath, openProjectDirectory } from "@/lib/agent/projects/api";
import { isChatsProject, type Project as ProjectEntry } from "@/lib/agent/projects/types";
import { ProjectDirectoryPickerModal } from "./projects-nav/directory-picker-modal";
import {
  ActiveSessionRow,
  NewChatPlusButton,
  ProjectRow,
  ProjectSessions,
  SessionRow,
} from "./projects-nav/session-rows";
import { activeSessionPref } from "./projects-nav/helpers";
import type { ActiveAgentSession, PinnedSession } from "./projects-nav/types";

export {
  consumeAgentSessionNavTitle,
  mergeActiveSessionPref,
  rememberAgentSessionNavTitle,
  triggerAddProjectFlow,
} from "./projects-nav/helpers";

const useSessionPrefs = useProjectsNavSessionPrefs;

export function ProjectsNavSection({ expanded }: { expanded: boolean }) {
  const projectsContext = useProjects();
  const projects = projectsContext.projects;
  const chatProject = projects.find(isChatsProject) ?? null;
  const fileProjects = projects.filter((project) => !isChatsProject(project));
  const upsertProject = projectsContext.upsertProject;
  const removeProject = projectsContext.removeProject;
  const refreshProjects = projectsContext.refresh;
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [activeSessions, setActiveSessions] = useState<ActiveAgentSession[]>(() =>
    loadPersistedActiveAgentSessions(),
  );
  const [addError, setAddError] = useState("");
  const [directoryModalOpen, setDirectoryModalOpen] = useState(false);
  const [pinnedSessions, setPinnedSessions] = useState<PinnedSession[]>([]);
  const prefs = useSessionPrefs();
  const pinnedPrefIds = useMemo(
    () =>
      Object.entries(prefs)
        .filter(([, pref]) => pref.pinned && !pref.hidden)
        .map(([id]) => id)
        .sort(),
    [prefs],
  );
  const hiddenPrefIds = useMemo(
    () =>
      Object.entries(prefs)
        .filter(([, pref]) => pref.hidden)
        .map(([id]) => id)
        .sort(),
    [prefs],
  );
  const activePiSessionIds = useMemo(
    () =>
      activeSessions
        .map((session) => session.piSessionId)
        .filter((id): id is string => Boolean(id))
        .sort(),
    [activeSessions],
  );
  const pinnedPrefIdsKey = pinnedPrefIds.join("\u0000");
  const hiddenPrefIdsKey = hiddenPrefIds.join("\u0000");
  const activePiSessionIdsKey = activePiSessionIds.join("\u0000");
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );
  const pinnedActiveSessions = useMemo(
    () =>
      activeSessions
        .filter((session) => {
          const pref = activeSessionPref(session, prefs);
          return pref.pinned && !pref.hidden;
        })
        .map((session) => ({ session, project: projectsById.get(session.projectId) }))
        .filter((entry): entry is { session: ActiveAgentSession; project: ProjectEntry } =>
          Boolean(entry.project),
        ),
    [activeSessions, prefs, projectsById],
  );
  const pinnedActiveSessionIds = useMemo(
    () =>
      new Set(
        pinnedActiveSessions
          .map(({ session }) => session.piSessionId)
          .filter((id): id is string => Boolean(id)),
      ),
    [pinnedActiveSessions],
  );
  const pinnedRenderedIds = useMemo(() => {
    const ids = new Set(pinnedActiveSessionIds);
    for (const session of pinnedSessions) ids.add(session.id);
    return ids;
  }, [pinnedActiveSessionIds, pinnedSessions]);
  const removeProjectAndCloseRow = useCallback(
    async (id: string) => {
      await removeProject(id);
      setOpenIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    },
    [removeProject],
  );
  const handleAddProject = useCallback(async () => {
    setAddError("");
    try {
      const desktopProject = await openProjectDirectory();
      if (desktopProject) {
        upsertProject(desktopProject);
        return;
      }
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add project");
      return;
    }
    setDirectoryModalOpen(true);
  }, [upsertProject]);
  const handleDirectoryPicked = async (directoryPath: string) => {
    setAddError("");
    try {
      const project = await addProjectFromPath(directoryPath);
      upsertProject(project);
      setDirectoryModalOpen(false);
      void refreshProjects();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add project");
    }
  };
  const toggle = (id: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Chats collapses by default — its row count grows fast and most navigation
  // happens via the Pinned strip above it.
  const [chatsExpanded, setChatsExpanded] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  useProjectsNavAddProjectEffect(handleAddProject);
  useActiveAgentSessionsEffect({ setActiveSessions });
  usePinnedSessionsEffect({
    activePiSessionIdsKey,
    expanded,
    hiddenPrefIdsKey,
    pinnedPrefIdsKey,
    projects,
    setPinnedSessions,
  });
  if (!expanded) {
    return null;
  }
  return (
    <div className="flex shrink-0 flex-col">
      {" "}
      <ProjectDirectoryPickerModal
        open={directoryModalOpen}
        error={addError}
        onClose={() => setDirectoryModalOpen(false)}
        onSelect={(directoryPath) => void handleDirectoryPicked(directoryPath)}
      />
      {pinnedSessions.length > 0 || pinnedActiveSessions.length > 0 ? (
        <div className="flex flex-col">
          <div className="mt-3 flex h-5 items-center px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-(--dim)">
            Pinned
          </div>{" "}
          {pinnedActiveSessions.map(({ session, project }) => (
            <ActiveSessionRow
              key={`${session.paneId}:${session.tabId}`}
              project={project}
              session={session}
              pref={activeSessionPref(session, prefs)}
            />
          ))}
          {pinnedSessions
            .filter((session) => !pinnedActiveSessionIds.has(session.id))
            .map((session) => (
              <SessionRow
                key={`${session.project.id}:${session.id}`}
                project={session.project}
                session={session}
                pref={prefs[session.id] ?? {}}
              />
            ))}{" "}
        </div>
      ) : null}{" "}
      {chatProject ? (
        <>
          <SidebarSectionHeader
            label="Chats"
            open={chatsExpanded}
            onToggle={() => setChatsExpanded((value) => !value)}
            action={
              <NewChatPlusButton
                projectId={chatProject.id}
                label="New chat"
                className="flex h-5 w-5 items-center justify-center rounded text-(--dim) transition-colors hover:text-(--fg)"
              />
            }
          />
          {chatsExpanded ? (
            <ProjectSessions
              project={chatProject}
              activeSessions={activeSessions}
              prefs={prefs}
              excludedIds={pinnedRenderedIds}
            />
          ) : null}
        </>
      ) : null}
      <SidebarSectionHeader
        label="Projects"
        open={projectsExpanded}
        onToggle={() => setProjectsExpanded((value) => !value)}
        action={
          <button
            type="button"
            onClick={handleAddProject}
            className="flex h-5 w-5 items-center justify-center rounded text-(--dim) transition-colors hover:text-(--fg)"
            title="Add folder"
            aria-label="Add folder"
          >
            <PlusIcon className="block h-3.5 w-3.5" />
          </button>
        }
      />
      {projectsExpanded ? (
        fileProjects.length === 0 ? (
          <button
            type="button"
            onClick={handleAddProject}
            className="px-2 py-1 text-left text-[12px] text-(--dim) hover:text-(--fg)"
          >
            {" "}
            No projects yet — pick a folder to get started.
          </button>
        ) : (
          fileProjects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              open={openIds.has(project.id)}
              activeSessions={activeSessions.filter((session) => session.projectId === project.id)}
              prefs={prefs}
              excludedIds={pinnedRenderedIds}
              onToggle={() => toggle(project.id)}
              onRemove={() => {
                setAddError("");
                void removeProjectAndCloseRow(project.id).catch((error) => {
                  setAddError(error instanceof Error ? error.message : "Failed to remove project");
                });
              }}
            />
          ))
        )
      ) : null}
      {addError ? <div className="px-2 py-1 text-[11px] text-red-400">{addError}</div> : null}{" "}
    </div>
  );
}
function SidebarSectionHeader({
  label,
  open,
  onToggle,
  action,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="group mt-3 flex h-5 items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-(--dim)">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1.5 text-left hover:text-(--fg) focus-visible:text-(--fg) focus-visible:outline-none"
        aria-expanded={open}
      >
        <span>{label}</span>
        <ChevronDownIcon
          className={`h-2.5 w-2.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover:opacity-100 group-focus-within:opacity-100 ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {action ? (
        <div className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {action}
        </div>
      ) : null}
    </div>
  );
}
