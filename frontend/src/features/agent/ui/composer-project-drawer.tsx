"use client";

import { useCallback, useState } from "react";
import { ChevronDown, FolderOpen, ListChecks, Plus } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useProjects } from "@/features/agent/projects/context";
import type { GitSummary, Project } from "@/features/agent/projects/types";
import { addProjectFromPath } from "@/features/agent/projects/api";
import {
  GitResourceSections,
  GitRow,
  iconButtonClass,
  listRowClass,
  searchInputClass,
} from "@/features/agent/ui/composer-git-sections";
import { GoalCard, GoalStrip, type GoalDraft } from "@/features/agent/ui/goal-ui";
import { useSessionGoal } from "@/features/agent/ui/use-goal";
import { ADD_PROJECT_EVENT } from "@/lib/workspace-events";
import { cx } from "@/ui/utils";
import { QueuedMessageStack } from "@/features/agent/ui/queued-message-stack";
import type { QueuedMessage } from "@/features/agent/messages";

export function ComposerProjectDrawer({
  piSessionId,
  revision,
  projectName,
  cwd,
  gitBranch,
  gitSummary,
  onInitGit,
  onOpenDiff,
  canPickProject,
  onProjectPicked,
  queueItems,
  running,
  onEditQueued,
  onRemoveQueued,
  onSteerQueued,
}: {
  piSessionId: string | null;
  revision: number;
  projectName: string | null;
  cwd: string;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  onInitGit?: () => void;
  onOpenDiff: () => void;
  canPickProject: boolean;
  onProjectPicked: (project: Project) => void;
  queueItems: QueuedMessage[];
  running: boolean;
  onEditQueued: (queueId: string, text: string) => void;
  onRemoveQueued: (queueId: string) => void;
  onSteerQueued: (queueId: string) => void;
}) {
  const projects = useProjects();
  const [open, setOpen] = useState(false);
  const {
    goal,
    error: goalError,
    patch: patchGoal,
    clear: clearGoal,
  } = useSessionGoal(piSessionId, revision);

  const isRepo = gitSummary?.isRepo === true;
  const gitEnabled = !running && isRepo;

  const submitGoal = useCallback(
    (draft: GoalDraft) => {
      // Every write from this card reactivates. Editing used to send the
      // objective alone, so a re-aimed goal kept its `complete` status — and a
      // non-active goal is excluded from prompt injection, meaning the new
      // objective steered nothing while the card still said "Goal complete".
      void patchGoal({
        objective: draft.objective,
        turnBudget: draft.turnBudget,
        status: "active",
        resetTurns: draft.resetProgress,
      });
    },
    [patchGoal],
  );

  const activeProject = projects.findByPath(cwd) ?? projects.selectedProject;
  // The projects store seeds itself from localStorage synchronously at
  // creation, so the client's very first render already knows the selected
  // project while the server's render cannot. Naming it during hydration is a
  // mismatch, and React responds by throwing away and re-rendering the whole
  // subtree — the composer. Hold the neutral label until after mount, which is
  // one frame, and hydrate clean.
  const [hydrated, setHydrated] = useState(false);
  useMountSubscription(() => setHydrated(true), []);
  // Every source of this name is client-only: `projectName` comes from the
  // pane's restored view state and `activeProject` from the projects store,
  // which seeds from localStorage synchronously. The server can know none of
  // it, so the first client render must say what the server said and only then
  // fill in — otherwise React discards and re-renders the whole composer.
  const label = hydrated
    ? (projectName ?? activeProject?.name ?? "Choose project")
    : "Choose project";
  const hasQueue = queueItems.length > 0;

  const pickProject = (project: Project) => {
    projects.selectProject(project);
    onProjectPicked(project);
    setOpen(false);
  };

  const addProject = () => {
    setOpen(false);
    window.dispatchEvent(new Event(ADD_PROJECT_EVENT));
  };

  return (
    <>
      {goal ? (
        <GoalStrip
          goal={goal}
          onTogglePause={() =>
            void patchGoal({ status: goal.status === "paused" ? "active" : "paused" })
          }
          onClear={() => void clearGoal()}
          onOpen={() => setOpen(true)}
        />
      ) : null}
      <section
        data-testid="composer-drawer"
        className="relative z-0 mx-auto -mb-3 w-[calc(100%_-_26px)] max-w-[calc(var(--composer-w)*0.9_-_26px)] overflow-hidden rounded-[var(--composer-radius-inner)] border border-(--border) bg-(--fg)/[0.022] pb-2 text-[length:var(--fs-xs)] shadow-[var(--composer-elevation-inner)] md:pb-3 md:text-[length:var(--fs-sm)] backdrop-blur-sm [corner-shape:superellipse(1.5)] sm:w-[calc(90%_-_26px)]"
      >
        {/* Collapsed is a summary, not a void: the branch and its diffstat
            are the thing you check between prompts, so they share the single
            row with the project label instead of stacking under it. */}
        <div className="flex items-center gap-1 px-1.5 pt-1">
          <div className="min-w-0 flex-1">
            <DrawerSummaryButton
              open={open}
              onToggle={() => setOpen((value) => !value)}
              label={label}
              queueCount={queueItems.length}
              hasGoal={goal !== null}
            />
          </div>
          {!open ? (
            <GitRow
              compact
              gitSummary={gitSummary}
              gitBranch={gitBranch}
              onInitGit={onInitGit}
              onOpenDiff={onOpenDiff}
            />
          ) : null}
        </div>
        {hasQueue ? (
          <div className="px-1.5 pb-0.5">
            <QueuedMessageStack
              items={queueItems}
              running={running}
              onEdit={onEditQueued}
              onRemove={onRemoveQueued}
              onSteer={onSteerQueued}
            />
          </div>
        ) : null}
        {open ? (
          <div className="flex max-h-[62vh] flex-col gap-0.5 overflow-y-auto px-1.5 pt-1">
            <GoalCard
              goal={goal}
              running={running}
              error={goalError}
              onSubmit={submitGoal}
              onTogglePause={() =>
                void patchGoal({ status: goal?.status === "paused" ? "active" : "paused" })
              }
              onRestart={() => void patchGoal({ status: "active", resetTurns: true })}
              onClear={() => void clearGoal()}
            />
            <div className="my-1 h-px shrink-0 bg-(--separator)" />
            <GitRow
              gitSummary={gitSummary}
              gitBranch={gitBranch}
              onInitGit={onInitGit}
              onOpenDiff={() => {
                setOpen(false);
                onOpenDiff();
              }}
            />
            <ProjectList
              canPickProject={canPickProject}
              cwd={cwd}
              projects={projects.projects}
              activeProjectId={activeProject?.id ?? null}
              onPick={pickProject}
              onAdd={addProject}
            />
            {isRepo ? (
              <GitResourceSections
                key={cwd}
                cwd={cwd}
                enabled={gitEnabled}
                onBranchSwitched={async () => {
                  await projects.loadGitSummary(cwd);
                  await projects.refresh();
                }}
                onWorktreePicked={async (path: string) => {
                  try {
                    const project = await addProjectFromPath(path);
                    projects.upsertProject(project);
                    pickProject(project);
                  } catch {}
                }}
              />
            ) : null}
          </div>
        ) : null}
      </section>
    </>
  );
}

function ProjectList({
  canPickProject,
  cwd,
  projects,
  activeProjectId,
  onPick,
  onAdd,
}: {
  canPickProject: boolean;
  cwd: string;
  projects: Project[];
  activeProjectId: string | null;
  onPick: (project: Project) => void;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState("");
  const text = query.trim().toLowerCase();
  const filtered = projects.filter(
    (project) =>
      !text ||
      project.name.toLowerCase().includes(text) ||
      project.path.toLowerCase().includes(text),
  );

  if (!canPickProject) {
    return (
      <div className={cx(listRowClass, "text-(--fg)/56")}>
        <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--fs-xs)]">
          {cwd || "No working directory"}
        </span>
      </div>
    );
  }
  return (
    <div>
      <div className="flex h-7 w-full items-center gap-1.5 rounded-[10px] px-2 text-[length:var(--fs-sm)] font-medium text-(--fg)/52">
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-(--fg)/46" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate">Projects</span>
        {projects.length > 0 ? <span className="text-(--fg)/34">{projects.length}</span> : null}
        <button
          type="button"
          onClick={onAdd}
          className={iconButtonClass}
          aria-label="Add project"
          title="Add project"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="px-2 pb-0.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects…"
          className={searchInputClass}
        />
      </div>
      <div className="flex max-h-44 flex-col overflow-y-auto">
        {filtered.map((project) => {
          const active = project.id === activeProjectId;
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => onPick(project)}
              className={cx(listRowClass, active ? "bg-(--hover)/60" : "hover:bg-(--hover)")}
            >
              <span
                className={cx(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  active ? "bg-(--accent)" : "bg-(--dim)/35",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-(--fg)/78">{project.name}</span>
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <div className={cx(listRowClass, "text-(--fg)/40")}>No matching projects</div>
        ) : null}
        <button
          type="button"
          onClick={onAdd}
          className={cx(listRowClass, "text-(--fg)/56 hover:bg-(--hover) hover:text-(--fg)/82")}
        >
          <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Add project…
        </button>
      </div>
    </div>
  );
}

function DrawerSummaryButton({
  open,
  onToggle,
  label,
  queueCount,
  hasGoal,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  queueCount: number;
  hasGoal: boolean;
}) {
  const hasQueue = queueCount > 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      // Same metrics as every list row below it — the collapsed summary and
      // the expanded rows share one left edge and one height, so toggling
      // the drawer doesn't make the text jump.
      className={cx(listRowClass, "text-(--fg)/78 hover:bg-(--hover)")}
    >
      {hasQueue ? (
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-(--fg)/56" strokeWidth={1.7} />
      ) : (
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-(--fg)/56" strokeWidth={1.7} />
      )}
      <span className="min-w-0 flex-1 truncate">
        {hasQueue ? `${queueCount} queued message${queueCount === 1 ? "" : "s"}` : label}
      </span>
      {/* The objective is NOT repeated here. It lives one row up in the goal
          strip, which is always mounted; printing it twice, a row apart, was
          the same fact competing with itself. */}
      {hasGoal || hasQueue ? (
        <ChevronDown
          className={cx(
            "h-3.5 w-3.5 shrink-0 text-(--fg)/36 transition-transform",
            open && "rotate-180",
          )}
          strokeWidth={1.75}
        />
      ) : null}
    </button>
  );
}
