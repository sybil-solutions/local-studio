"use client";

import { useCallback, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { ConfirmDeleteModal } from "@/ui";
import { PlusIcon } from "@/ui/icons";
import { usePersistentTerminalOwners } from "@/features/agent/ui/use-persistent-terminal-owners";
import {
  useProjectsNavAddProjectEffect,
  useProjectsNavSessionPrefs,
} from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import {
  sessionActivity,
  useOpenSessions,
  useSessionActivity,
} from "@/features/agent/session-index";
import { useProjects } from "@/features/agent/projects/context";
import { addProjectFromPath, openProjectDirectory } from "@/features/agent/projects/api";
import { isChatsProject, type Project as ProjectEntry } from "@/features/agent/projects/types";
import type { NavView } from "@/features/shell/left-sidebar-lazy";
import { ProjectDirectoryPickerModal } from "./projects-nav/directory-picker-modal";
import { SidebarSectionHeader } from "./projects-nav/nav-chrome";
import { useNavSectionOrder, type SectionId } from "./projects-nav/nav-sections";
import { isProjectPinned, toggleProjectPin, usePinnedNav } from "./projects-nav/pinned";
import { PinnedSection } from "./projects-nav/pinned-section";
import { RecentSessionsSection } from "./projects-nav/recent-sessions-section";
import { NewChatPlusButton, ProjectRow, ProjectSessions } from "./projects-nav/session-rows";
import { TerminalRow } from "./projects-nav/terminal-rows";

export function ProjectsNavSection({ expanded, view }: { expanded: boolean; view: NavView }) {
  const projectsContext = useProjects();
  const projects = projectsContext.projects;
  const { moveProjectBefore, refresh: refreshProjects, upsertProject } = projectsContext;
  const chatProject = projects.find(isChatsProject) ?? null;
  const activeSessions = useOpenSessions();
  const activity = useSessionActivity();
  const prefs = useProjectsNavSessionPrefs();
  const pinned = usePinnedNav({ expanded, projects, activeSessions, prefs });
  const terminalOwners = usePersistentTerminalOwners(false, null).owners;
  const sections = useNavSectionOrder();

  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const [addError, setAddError] = useState("");
  const [directoryModalOpen, setDirectoryModalOpen] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [chatsExpanded, setChatsExpanded] = useState(true);
  const [terminalsExpanded, setTerminalsExpanded] = useState(true);
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const removal = useProjectRemoval(projectsContext.removeProject, setOpenIds, setAddError);

  const handleAddProject = useCallback(async () => {
    setAddError("");
    try {
      const result = await openProjectDirectory();
      if (result.source === "fallback") {
        setDirectoryModalOpen(true);
        return;
      }
      if (result.project) upsertProject(result.project);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add project");
    }
  }, [upsertProject]);
  useProjectsNavAddProjectEffect(handleAddProject);

  const handleDirectoryPicked = async (directoryPath: string) => {
    setAddError("");
    try {
      upsertProject(await addProjectFromPath(directoryPath));
      setDirectoryModalOpen(false);
      void refreshProjects();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Failed to add project");
    }
  };

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

  const toggleProject = (id: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const openProject = (id: string) =>
    setOpenIds((current) => (current.has(id) ? current : new Set(current).add(id)));

  const projectDragProps = (projectId: string) => ({
    dragging: dragProjectId === projectId,
    reorderDraggable: true,
    onReorderDragStart: () => setDragProjectId(projectId),
    onReorderDragEnd: () => setDragProjectId(null),
    onReorderDragOver: (event: DragEvent) => {
      if (dragProjectId && dragProjectId !== projectId) event.preventDefault();
    },
    onReorderDrop: () => {
      if (dragProjectId && dragProjectId !== projectId) moveProjectBefore(dragProjectId, projectId);
      setDragProjectId(null);
    },
  });

  if (!expanded) return null;

  if (view === "recents") return <RecentSessionsSection />;

  // Pinned projects render under Pinned instead, so they are not listed twice.
  const unpinnedProjects = projects.filter(
    (project) => !isChatsProject(project) && !pinned.pinnedProjectIds.has(project.id),
  );

  const sectionBody: Record<SectionId, ReactNode> = {
    projects: (
      <>
        <SidebarSectionHeader
          label="Projects"
          open={projectsExpanded}
          onToggle={() => setProjectsExpanded((value) => !value)}
          {...sections.headerDragProps("projects")}
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
        {!projectsExpanded ? null : unpinnedProjects.length === 0 ? (
          <button
            type="button"
            onClick={handleAddProject}
            className="px-2 py-1 text-left text-[length:var(--fs-md)] text-(--dim) hover:text-(--fg)"
          >
            No projects yet — pick a folder to get started.
          </button>
        ) : (
          <>
            {unpinnedProjects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                open={openIds.has(project.id)}
                activeSessions={activeSessions.filter(
                  (session) => session.projectId === project.id,
                )}
                prefs={prefs}
                excludedIds={pinned.renderedSessionIds}
                pinned={isProjectPinned(prefs, project.id)}
                onTogglePin={() => toggleProjectPin(project.id, true)}
                onToggle={() => toggleProject(project.id)}
                onNewChatStart={() => {
                  setProjectsExpanded(true);
                  openProject(project.id);
                }}
                onRemove={() => {
                  setAddError("");
                  removal.request(project);
                }}
                {...projectDragProps(project.id)}
              />
            ))}
            {dragProjectId ? (
              <div
                className="h-2"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  moveProjectBefore(dragProjectId, null);
                  setDragProjectId(null);
                }}
              />
            ) : null}
          </>
        )}
      </>
    ),
    tasks: chatProject ? (
      <>
        <SidebarSectionHeader
          label="Tasks"
          open={chatsExpanded}
          indicator={chatsHasActivity}
          onToggle={() => setChatsExpanded((value) => !value)}
          {...sections.headerDragProps("tasks")}
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
            excludedIds={pinned.renderedSessionIds}
          />
        ) : null}
      </>
    ) : null,
    terminals:
      terminalOwners.length > 0 ? (
        <>
          <SidebarSectionHeader
            label="Terminals"
            open={terminalsExpanded}
            onToggle={() => setTerminalsExpanded((value) => !value)}
            {...sections.headerDragProps("terminals")}
          />
          {terminalsExpanded
            ? terminalOwners.map((owner, index) => (
                <TerminalRow key={owner.mountKey} owner={owner} index={index} />
              ))
            : null}
        </>
      ) : null,
  };

  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <ProjectDirectoryPickerModal
        open={directoryModalOpen}
        error={addError}
        onClose={() => setDirectoryModalOpen(false)}
        onSelect={(directoryPath) => void handleDirectoryPicked(directoryPath)}
      />
      {removal.project ? (
        <ConfirmDeleteModal
          title="Remove project"
          confirmLabel="Remove"
          message={
            <>
              <p>
                Remove <span className="font-medium text-(--ui-fg)">{removal.project.name}</span>{" "}
                from the sidebar?
              </p>
              <p className="break-all font-mono text-[length:var(--fs-sm)] text-(--dim)">
                {removal.project.path}
              </p>
              <p>This does not delete files from disk or archive existing sessions.</p>
            </>
          }
          onCancel={removal.cancel}
          onConfirm={removal.confirm}
        />
      ) : null}
      <PinnedSection
        pinned={pinned}
        activeSessions={activeSessions}
        prefs={prefs}
        onRemoveProject={removal.request}
      />
      {sections.order.map((id) =>
        sectionBody[id] ? (
          <div key={id} {...sections.sectionDropProps(id)}>
            {sectionBody[id]}
          </div>
        ) : null,
      )}
      {addError ? (
        <div className="px-2 py-1 text-[length:var(--fs-sm)] text-red-400">{addError}</div>
      ) : null}
    </div>
  );
}

function useProjectRemoval(
  removeProject: (id: string) => Promise<void>,
  setOpenIds: (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void,
  setError: (message: string) => void,
) {
  const [project, setProject] = useState<ProjectEntry | null>(null);

  const confirm = useCallback(async () => {
    if (!project) return;
    setError("");
    try {
      await removeProject(project.id);
      setOpenIds((current) => {
        if (!current.has(project.id)) return current;
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove project";
      setError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  }, [project, removeProject, setError, setOpenIds]);

  return {
    project,
    request: useCallback((next: ProjectEntry) => setProject(next), []),
    cancel: useCallback(() => setProject(null), []),
    confirm,
  };
}
