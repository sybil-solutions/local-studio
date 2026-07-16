"use client";

import { useCallback, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, UiModal, UiModalHeader } from "@/ui";
import { TerminalSquare, X as XIcon } from "@/ui/icon-registry";
import {
  OPEN_TERMINAL_EVENT,
  terminalOwnerLabel,
  type OpenTerminalEventDetail,
} from "@/features/agent/terminal-owners";
import {
  removePersistentTerminalOwner,
  usePersistentTerminalOwners,
} from "@/features/agent/ui/use-persistent-terminal-owners";
import { ChevronDownIcon, PlusIcon } from "@/ui/icons";
import {
  usePinnedSessionsEffect,
  useProjectsNavAddProjectEffect,
  useProjectsNavSessionPrefs,
} from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import { useOpenSessions, useSessionActivity } from "@/features/agent/ui/use-open-sessions";
import {
  sessionActivity,
  uniqueOpenSessions,
  type OpenAgentSession,
} from "@/features/agent/session-index";
import { isLocalSessionPrefKey } from "@/features/agent/messages/prefs";
import { useProjects } from "@/features/agent/projects/context";
import { addProjectFromPath, openProjectDirectory } from "@/features/agent/projects/api";
import { isChatsProject, type Project as ProjectEntry } from "@/features/agent/projects/types";
import { ProjectDirectoryPickerModal } from "./projects-nav/directory-picker-modal";
import {
  ActiveSessionRow,
  NewChatPlusButton,
  ProjectRow,
  ProjectSessions,
  SessionRow,
} from "./projects-nav/session-rows";
import { mergeActiveSessionPref } from "./projects-nav/helpers";
import type { PinnedSession } from "./projects-nav/types";

export function ProjectsNavSection({ expanded }: { expanded: boolean }) {
  const projectsContext = useProjects();
  const projects = projectsContext.projects;
  const chatProject = projects.find(isChatsProject) ?? null;
  const fileProjects = projects.filter((project) => !isChatsProject(project));
  const upsertProject = projectsContext.upsertProject;
  const moveProjectBefore = projectsContext.moveProjectBefore;
  const removeProject = projectsContext.removeProject;
  const refreshProjects = projectsContext.refresh;
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const activeSessions = useOpenSessions();
  const activity = useSessionActivity();
  const [addError, setAddError] = useState("");
  const [directoryModalOpen, setDirectoryModalOpen] = useState(false);
  const [projectRemoveConfirm, setProjectRemoveConfirm] = useState<ProjectEntry | null>(null);
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
  const [pinnedSessions, setPinnedSessions] = useState<PinnedSession[]>([]);
  const prefs = useProjectsNavSessionPrefs();
  const pinnedPrefIds = useMemo(
    () =>
      Object.entries(prefs)
        .filter(([id, pref]) => pref.pinned && !pref.hidden && !isLocalSessionPrefKey(id))
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
  const pinnedPrefIdsKey = pinnedPrefIds.join("\u0000");
  const hiddenPrefIdsKey = hiddenPrefIds.join("\u0000");
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );
  const pinnedActiveSessions = useMemo(
    () =>
      uniqueOpenSessions(activeSessions)
        .filter((session) => {
          const pref = mergeActiveSessionPref(session, prefs);
          return pref.pinned && !pref.hidden;
        })
        .map((session) => ({ session, project: projectsById.get(session.projectId) }))
        .filter((entry): entry is { session: OpenAgentSession; project: ProjectEntry } =>
          Boolean(entry.project),
        ),
    [activeSessions, prefs, projectsById],
  );
  const pinnedActiveSessionIds = useMemo(
    () => new Set(pinnedActiveSessions.map(({ session }) => session.threadId ?? session.id)),
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
  const confirmProjectRemove = useCallback(async () => {
    if (!projectRemoveConfirm) return;
    setAddError("");
    setRemovingProjectId(projectRemoveConfirm.id);
    try {
      await removeProjectAndCloseRow(projectRemoveConfirm.id);
      setProjectRemoveConfirm(null);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to remove project");
    } finally {
      setRemovingProjectId(null);
    }
  }, [projectRemoveConfirm, removeProjectAndCloseRow]);
  const toggle = (id: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [chatsExpanded, setChatsExpanded] = useState(true);
  const chatsHasActivity = useMemo(() => {
    if (!chatProject) return false;
    return activeSessions.some(
      (session) =>
        session.projectId === chatProject.id &&
        sessionActivity(
          [session.id, session.threadId],
          activity,
          session.status,
          session.focused,
        ) !== "idle",
    );
  }, [activeSessions, activity, chatProject]);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [terminalsExpanded, setTerminalsExpanded] = useState(true);
  useProjectsNavAddProjectEffect(handleAddProject);
  usePinnedSessionsEffect({
    expanded,
    hiddenPrefIdsKey,
    pinnedPrefIdsKey,
    projects,
    setPinnedSessions,
  });
  const router = useRouter();
  const terminalOwners = usePersistentTerminalOwners(false, null).owners;
  const openTerminal = (mountKey: string) => {
    router.push("/agent");
    window.dispatchEvent(
      new CustomEvent<OpenTerminalEventDetail>(OPEN_TERMINAL_EVENT, { detail: { mountKey } }),
    );
  };
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(readSectionOrder);
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [dragSection, setDragSection] = useState<SectionId | null>(null);
  const moveSectionBefore = (dragged: SectionId, target: SectionId) => {
    if (dragged === target) return;
    setSectionOrder((current) => {
      const next = current.filter((entry) => entry !== dragged);
      next.splice(next.indexOf(target), 0, dragged);
      writeSectionOrder(next);
      return next;
    });
  };
  const projectDragProps = (projectId: string) => ({
    reorderDraggable: true,
    onReorderDragStart: () => setDragProjectId(projectId),
    onReorderDragEnd: () => setDragProjectId(null),
    onReorderDragOver: (event: DragEvent) => {
      if (dragProjectId && dragProjectId !== projectId) event.preventDefault();
    },
    onReorderDrop: () => {
      if (dragProjectId && dragProjectId !== projectId) {
        moveProjectBefore(dragProjectId, projectId);
      }
      setDragProjectId(null);
    },
  });
  if (!expanded) {
    return null;
  }
  const projectsSection = (
    <div
      key="projects"
      onDragOver={(event) => {
        if (dragSection && dragSection !== "projects") event.preventDefault();
      }}
      onDrop={() => {
        if (dragSection && dragSection !== "projects") moveSectionBefore(dragSection, "projects");
        setDragSection(null);
      }}
    >
      <SidebarSectionHeader
        label="Projects"
        open={projectsExpanded}
        onToggle={() => setProjectsExpanded((value) => !value)}
        draggable
        onDragStart={() => setDragSection("projects")}
        onDragEnd={() => setDragSection(null)}
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
            className="px-2 py-1 text-left text-[length:var(--fs-md)] text-(--dim) hover:text-(--fg)"
          >
            No projects yet — pick a folder to get started.
          </button>
        ) : (
          <>
            {fileProjects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                open={openIds.has(project.id)}
                activeSessions={activeSessions.filter(
                  (session) => session.projectId === project.id,
                )}
                prefs={prefs}
                excludedIds={pinnedRenderedIds}
                onToggle={() => toggle(project.id)}
                {...projectDragProps(project.id)}
                onNewChatStart={() => {
                  setProjectsExpanded(true);
                  setOpenIds((current) => {
                    if (current.has(project.id)) return current;
                    const next = new Set(current);
                    next.add(project.id);
                    return next;
                  });
                }}
                onRemove={() => {
                  setAddError("");
                  setProjectRemoveConfirm(project);
                }}
              />
            ))}
            {dragProjectId ? (
              <div
                className="h-2"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragProjectId) moveProjectBefore(dragProjectId, null);
                  setDragProjectId(null);
                }}
              />
            ) : null}
          </>
        )
      ) : null}
    </div>
  );
  const tasksSection = chatProject ? (
    <div
      key="tasks"
      onDragOver={(event) => {
        if (dragSection && dragSection !== "tasks") event.preventDefault();
      }}
      onDrop={() => {
        if (dragSection && dragSection !== "tasks") moveSectionBefore(dragSection, "tasks");
        setDragSection(null);
      }}
    >
      <SidebarSectionHeader
        label="Tasks"
        open={chatsExpanded}
        indicator={chatsHasActivity}
        onToggle={() => setChatsExpanded((value) => !value)}
        draggable
        onDragStart={() => setDragSection("tasks")}
        onDragEnd={() => setDragSection(null)}
        action={
          <NewChatPlusButton
            project={chatProject}
            label="New task"
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
    </div>
  ) : null;
  const terminalsSection =
    terminalOwners.length > 0 ? (
      <div
        key="terminals"
        onDragOver={(event) => {
          if (dragSection && dragSection !== "terminals") event.preventDefault();
        }}
        onDrop={() => {
          if (dragSection && dragSection !== "terminals") {
            moveSectionBefore(dragSection, "terminals");
          }
          setDragSection(null);
        }}
      >
        <SidebarSectionHeader
          label="Terminals"
          open={terminalsExpanded}
          onToggle={() => setTerminalsExpanded((value) => !value)}
          draggable
          onDragStart={() => setDragSection("terminals")}
          onDragEnd={() => setDragSection(null)}
        />
        {terminalsExpanded
          ? terminalOwners.map((owner, index) => (
              <div
                key={owner.mountKey}
                className="group relative flex h-8 items-center rounded-lg pl-2 pr-1.5 text-(--fg) transition-colors hover:bg-(--hover)"
              >
                <button
                  type="button"
                  onClick={() => openTerminal(owner.mountKey)}
                  title={owner.cwd ?? owner.title}
                  className="flex min-w-0 flex-1 items-center gap-2 pr-6 text-left"
                >
                  <TerminalSquare
                    className="h-3.5 w-3.5 shrink-0 opacity-70 transition-opacity group-hover:opacity-90"
                    strokeWidth={1.75}
                  />
                  <span className="truncate text-[length:var(--fs-md)] font-normal">
                    {terminalOwnerLabel(owner, index)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removePersistentTerminalOwner(owner.mountKey)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center text-(--dim)/55 opacity-0 transition-opacity hover:text-(--err) group-hover:opacity-100"
                  title="Close terminal"
                  aria-label={`Close terminal ${terminalOwnerLabel(owner, index)}`}
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          : null}
      </div>
    ) : null;
  const sections: Record<SectionId, ReactNode> = {
    projects: projectsSection,
    tasks: tasksSection,
    terminals: terminalsSection,
  };
  return (
    <div className="flex shrink-0 flex-col">
      <ProjectDirectoryPickerModal
        open={directoryModalOpen}
        error={addError}
        onClose={() => setDirectoryModalOpen(false)}
        onSelect={(directoryPath) => void handleDirectoryPicked(directoryPath)}
      />
      <ProjectRemoveConfirmModal
        project={projectRemoveConfirm}
        removing={Boolean(projectRemoveConfirm && removingProjectId === projectRemoveConfirm.id)}
        onCancel={() => setProjectRemoveConfirm(null)}
        onConfirm={() => void confirmProjectRemove()}
      />
      {pinnedSessions.length > 0 || pinnedActiveSessions.length > 0 ? (
        <div className="flex flex-col">
          <div className="flex items-center px-2 pb-1 pt-5 text-[length:var(--fs-sm)] font-normal text-(--hl2)">
            Pinned
          </div>
          {pinnedActiveSessions.map(({ session, project }) => (
            <ActiveSessionRow
              key={session.threadId ?? session.id}
              project={project}
              session={session}
              pref={mergeActiveSessionPref(session, prefs)}
              activity={sessionActivity(
                [session.id, session.threadId],
                activity,
                session.status,
                session.focused,
              )}
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
            ))}
        </div>
      ) : null}
      {sectionOrder.map((id) => sections[id])}
      {addError ? (
        <div className="px-2 py-1 text-[length:var(--fs-sm)] text-red-400">{addError}</div>
      ) : null}
    </div>
  );
}

function ProjectRemoveConfirmModal({
  project,
  removing,
  onCancel,
  onConfirm,
}: {
  project: ProjectEntry | null;
  removing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!project) return null;
  return (
    <UiModal isOpen onClose={removing ? () => {} : onCancel} maxWidth="max-w-md">
      <UiModalHeader title="Remove project" onClose={removing ? undefined : onCancel} />
      <div className="space-y-5 p-6">
        <div className="space-y-2 text-[length:var(--fs-sm)] text-(--ui-muted)">
          <p>
            Remove <span className="font-medium text-(--ui-fg)">{project.name}</span> from the
            sidebar?
          </p>
          <p className="break-all font-mono text-[length:var(--fs-xs)] text-(--dim)">
            {project.path}
          </p>
          <p>This does not delete files from disk or archive existing sessions.</p>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={removing}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={removing}>
            {removing ? "Removing..." : "Remove"}
          </Button>
        </div>
      </div>
    </UiModal>
  );
}
function SidebarSectionHeader({
  label,
  open,
  onToggle,
  action,
  indicator = false,
  draggable = false,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
  indicator?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <div
      className="group flex cursor-default items-center justify-between px-2 pb-1 pt-5 text-[length:var(--fs-sm)] font-normal text-(--hl2)"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1.5 text-left hover:text-(--fg) focus-visible:text-(--fg) focus-visible:outline-none"
        aria-expanded={open}
      >
        <span>{label}</span>
        {!open && indicator ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--link)"
            aria-label={`${label} has unseen activity`}
            title={`${label} has unseen activity`}
          />
        ) : null}
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

type SectionId = "projects" | "tasks" | "terminals";

const NAV_SECTION_ORDER_KEY = "local-studio.agent.nav-section-order.v1";

function readSectionOrder(): SectionId[] {
  const fallback: SectionId[] = ["projects", "tasks", "terminals"];
  if (typeof window === "undefined") return fallback;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(NAV_SECTION_ORDER_KEY) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const valid = parsed.filter(
      (entry): entry is SectionId =>
        entry === "projects" || entry === "tasks" || entry === "terminals",
    );
    if (valid.length === 0) return fallback;
    // Tolerate orders saved before new sections existed.
    for (const id of fallback) if (!valid.includes(id)) valid.push(id);
    return valid;
  } catch {
    return fallback;
  }
}

function writeSectionOrder(order: SectionId[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NAV_SECTION_ORDER_KEY, JSON.stringify(order));
  } catch {}
}
