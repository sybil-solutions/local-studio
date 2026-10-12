"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GitBranch,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "@/ui/icon-registry";
import { GitBranchIcon } from "@/ui/icons";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useProjects } from "@/features/agent/projects/context";
import type { GitSummary, Project } from "@/features/agent/projects/types";
import {
  addProjectFromPath,
  addWorktree,
  createBranch,
  listBranches,
  listWorktrees,
  removeWorktree,
  switchBranch,
} from "@/features/agent/projects/api";
import type { GitBranch as GitBranchType, GitWorktree } from "@/features/agent/contracts";
import { GoalCard, type GoalDraft } from "@/features/agent/ui/goal-card";
import { GoalStrip } from "@/features/agent/ui/goal-strip";
import { useSessionGoal } from "@/features/agent/ui/use-session-goal";
import { ADD_PROJECT_EVENT } from "@/lib/workspace-events";
import { cx } from "@/ui/utils";
import { QueuedMessageStack } from "@/features/agent/ui/queued-message-stack";
import type { QueuedMessage } from "@/features/agent/messages";

const iconButtonClass =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--fg)/42 transition-colors hover:bg-(--hover) hover:text-(--fg)/82 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--fg)/25";

const listRowClass =
  "flex h-8 w-full items-center gap-2 rounded-[10px] px-2 text-left transition-colors";

const searchInputClass =
  "h-7 w-full min-w-0 rounded-md bg-(--fg)/[0.04] px-2 text-[length:var(--fs-xs)] text-(--fg) outline-none placeholder:text-(--fg)/30 focus:bg-(--fg)/[0.06]";

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
  const [hydrated, setHydrated] = useState(false);
  useMountSubscription(() => setHydrated(true), []);
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
        className="relative z-0 mx-auto -mb-3 w-[calc(100%_-_26px)] max-w-[calc(var(--composer-w)*0.9_-_26px)] overflow-hidden rounded-[var(--composer-radius-inner)] border border-(--border) bg-(--fg)/[0.022] pb-2 text-[length:var(--fs-xs)] md:pb-3 md:text-[length:var(--fs-sm)] [corner-shape:superellipse(1.5)] sm:w-[calc(90%_-_26px)]"
      >
        <div className="flex items-center px-1.5 pt-1">
          <DrawerSummaryButton
            open={open}
            onToggle={() => setOpen((value) => !value)}
            label={label}
            queueCount={queueItems.length}
          />
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

function GitResourceSections({
  cwd,
  enabled,
  onBranchSwitched,
  onWorktreePicked,
}: {
  cwd: string;
  enabled: boolean;
  onBranchSwitched: () => Promise<void>;
  onWorktreePicked: (path: string) => Promise<void>;
}) {
  const [branches, setBranches] = useState<GitBranchType[] | null>(null);
  const [worktrees, setWorktrees] = useState<GitWorktree[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextBranches, nextWorktrees] = await Promise.all([
        listBranches(cwd),
        listWorktrees(cwd),
      ]);
      setBranches(nextBranches);
      setWorktrees(nextWorktrees);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load git state");
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useMountSubscription(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (action: () => Promise<void>, fallback: string) => {
      if (!enabled) return;
      setBusy(true);
      setError(null);
      try {
        await action();
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : fallback);
      } finally {
        setBusy(false);
      }
    },
    [enabled, load],
  );

  if (error) {
    return (
      <div className={cx(listRowClass, "text-(--err)/80")}>
        <span className="min-w-0 flex-1 truncate">{error}</span>
        <button
          type="button"
          onClick={() => void load()}
          className={iconButtonClass}
          aria-label="Retry loading git state"
          title="Retry"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <>
      <BranchSection
        branches={branches}
        loading={loading}
        busy={busy}
        enabled={enabled}
        onSwitch={(name) =>
          void run(async () => {
            await switchBranch(cwd, name);
            await onBranchSwitched();
          }, "Failed to switch branch")
        }
        onCreate={(name) =>
          void run(async () => {
            await createBranch(cwd, name);
            await onBranchSwitched();
          }, "Failed to create branch")
        }
      />
      <WorktreeSection
        worktrees={worktrees}
        loading={loading}
        busy={busy}
        enabled={enabled}
        cwd={cwd}
        onSwitch={(path) => void run(() => onWorktreePicked(path), "Failed to open worktree")}
        onCreate={(branch, path) =>
          void run(async () => {
            await addWorktree(cwd, branch, path);
            await onWorktreePicked(path);
          }, "Failed to create worktree")
        }
        onRemove={(path) =>
          void run(async () => {
            await removeWorktree(cwd, path);
          }, "Failed to remove worktree")
        }
      />
    </>
  );
}

function useFilteredItems<T>(items: T[], nameOf: (item: T) => string, query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => nameOf(item).toLowerCase().includes(q));
}

function BranchSection({
  branches,
  loading,
  busy,
  enabled,
  onSwitch,
  onCreate,
}: {
  branches: GitBranchType[] | null;
  loading: boolean;
  busy: boolean;
  enabled: boolean;
  onSwitch: (name: string) => void;
  onCreate: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const filtered = useFilteredItems(branches ?? [], (branch) => branch.name, query);

  const submitCreate = () => {
    const name = draftName.trim();
    if (!name) return;
    onCreate(name);
    setDraftName("");
    setCreating(false);
  };

  return (
    <SectionShell
      icon={<GitBranch className="h-3.5 w-3.5 shrink-0 text-(--fg)/46" />}
      label="Branches"
      count={branches?.length ?? 0}
      addLabel="New branch"
      addDisabled={!enabled}
      onAdd={() => setCreating((value) => !value)}
      query={query}
      onQueryChange={setQuery}
      placeholder="Search branches…"
      loading={loading}
      itemsLoaded={branches !== null}
      emptyLabel="No branches"
      empty={branches !== null && filtered.length === 0}
      create={
        creating ? (
          <div className="flex items-center gap-1 px-2 pb-0.5">
            <input
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitCreate();
                if (event.key === "Escape") setCreating(false);
              }}
              placeholder="Branch name"
              className={searchInputClass}
              aria-label="New branch name"
            />
            <button
              type="button"
              disabled={!draftName.trim() || busy}
              onClick={submitCreate}
              className={`${iconButtonClass} bg-(--fg)/90 text-(--bg) hover:bg-(--fg) hover:text-(--bg) disabled:opacity-35`}
              aria-label="Create branch"
              title="Create branch"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null
      }
    >
      {filtered.map((branch) => (
        <button
          key={branch.name}
          type="button"
          disabled={busy || branch.current || !enabled}
          onClick={() => onSwitch(branch.name)}
          className={cx(
            listRowClass,
            branch.current ? "bg-(--hover)/50 text-(--fg)/90" : "hover:bg-(--hover)",
            "disabled:opacity-60",
          )}
          title={branch.remote ? `Remote branch ${branch.name}` : `Switch to ${branch.name}`}
        >
          {branch.current ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-(--accent)" />
          ) : (
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-(--fg)/34" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {branch.name}
            {branch.remote ? <span className="text-(--dim)"> (remote)</span> : null}
          </span>
          {!branch.current && enabled ? (
            <ChevronRight className="h-3 w-3 shrink-0 text-(--fg)/30" />
          ) : null}
        </button>
      ))}
    </SectionShell>
  );
}

function WorktreeSection({
  cwd,
  worktrees,
  loading,
  busy,
  enabled,
  onSwitch,
  onCreate,
  onRemove,
}: {
  cwd: string;
  worktrees: GitWorktree[] | null;
  loading: boolean;
  busy: boolean;
  enabled: boolean;
  onSwitch: (path: string) => void;
  onCreate: (branch: string, path: string) => void;
  onRemove: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftBranch, setDraftBranch] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const filtered = useFilteredItems(worktrees ?? [], (worktree) => worktree.path, query);

  const startCreate = () => {
    const branch = draftBranch.trim();
    const path = draftPath.trim();
    if (!branch || !path) return;
    onCreate(branch, path);
    setDraftBranch("");
    setDraftPath("");
    setCreating(false);
  };

  return (
    <SectionShell
      icon={<GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-(--fg)/46" />}
      label="Worktrees"
      count={worktrees?.length ?? 0}
      addLabel="New worktree"
      addDisabled={!enabled}
      onAdd={() => setCreating((value) => !value)}
      query={query}
      onQueryChange={setQuery}
      placeholder="Search worktrees…"
      loading={loading}
      itemsLoaded={worktrees !== null}
      emptyLabel="No worktrees"
      empty={worktrees !== null && filtered.length === 0}
      create={
        creating ? (
          <div className="flex flex-col gap-1 px-2 pb-0.5">
            <input
              autoFocus
              value={draftBranch}
              onChange={(event) => setDraftBranch(event.target.value)}
              placeholder="Branch (e.g. feat/new-thing)"
              className={searchInputClass}
              aria-label="New worktree branch"
            />
            <input
              value={draftPath}
              onChange={(event) => setDraftPath(event.target.value)}
              placeholder={defaultWorktreePath(cwd, draftBranch)}
              className={searchInputClass}
              aria-label="New worktree path"
            />
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className={iconButtonClass}
                aria-label="Cancel creating worktree"
                title="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={!draftBranch.trim() || busy}
                onClick={startCreate}
                className={`${iconButtonClass} bg-(--fg)/90 text-(--bg) hover:bg-(--fg) hover:text-(--bg) disabled:opacity-35`}
                aria-label="Create worktree"
                title="Create worktree"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null
      }
    >
      {filtered.map((worktree) => (
        <div key={worktree.path} className="group flex min-w-0 items-center">
          <button
            type="button"
            disabled={busy || worktree.current || !enabled}
            onClick={() => onSwitch(worktree.path)}
            className={cx(
              listRowClass,
              "min-w-0 flex-1",
              worktree.current ? "bg-(--hover)/50 text-(--fg)/90" : "hover:bg-(--hover)",
              "disabled:opacity-60",
            )}
            title={worktree.current ? "Current working tree" : `Open worktree at ${worktree.path}`}
          >
            {worktree.current ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-(--accent)" />
            ) : (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-(--fg)/34" strokeWidth={1.7} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[length:var(--fs-xs)]">
                {worktree.branch ?? "detached"}
              </span>
              <span className="block truncate text-[length:var(--fs-xs)] text-(--fg)/40">
                {worktree.path}
              </span>
            </span>
          </button>
          {!worktree.current && enabled ? (
            <button
              type="button"
              onClick={() => onRemove(worktree.path)}
              className="mr-1 shrink-0 rounded-md p-1 text-(--fg)/40 opacity-0 transition-opacity hover:bg-(--fg)/[0.06] hover:text-(--err) group-hover:opacity-100"
              aria-label="Remove worktree"
              title="Remove worktree"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ))}
    </SectionShell>
  );
}

function SectionShell({
  icon,
  label,
  count,
  addLabel,
  addDisabled,
  onAdd,
  query,
  onQueryChange,
  placeholder,
  loading,
  itemsLoaded,
  emptyLabel,
  empty,
  create,
  children,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  addLabel: string;
  addDisabled: boolean;
  onAdd: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  loading: boolean;
  itemsLoaded: boolean;
  emptyLabel: string;
  empty: boolean;
  create?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div className="flex h-7 w-full items-center gap-1.5 rounded-[10px] pr-2 text-[length:var(--fs-sm)] font-medium text-(--fg)/52">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[10px] px-2 text-left transition-colors hover:bg-(--hover) hover:text-(--fg)/82"
        >
          {icon}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {count > 0 ? <span className="text-(--fg)/34">{count}</span> : null}
          <ChevronDown
            className={cx(
              "h-3 w-3 shrink-0 text-(--fg)/30 transition-transform",
              expanded && "rotate-180",
            )}
            strokeWidth={1.75}
          />
        </button>
        {expanded && !addDisabled ? (
          <button
            type="button"
            onClick={onAdd}
            className={iconButtonClass}
            aria-label={addLabel}
            title={addLabel}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <>
          {count > 5 ? (
            <div className="px-2 pb-0.5">
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder={placeholder}
                className={searchInputClass}
              />
            </div>
          ) : null}
          {create}
          {loading && !itemsLoaded ? (
            <div className={cx(listRowClass, "text-(--fg)/40")}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Loading…</span>
            </div>
          ) : itemsLoaded && empty ? (
            <div className={cx(listRowClass, "text-(--fg)/40")}>{emptyLabel}</div>
          ) : (
            <div className="max-h-44 overflow-y-auto">{children}</div>
          )}
        </>
      ) : null}
    </div>
  );
}

function defaultWorktreePath(cwd: string, branch: string): string {
  const cleaned = branch.trim().replace(/\//g, "-") || "worktree";
  const parent = cwd.slice(0, cwd.lastIndexOf("/") + 1) || "./";
  return `${parent}${cleaned}`;
}

function GitRow({
  gitSummary,
  gitBranch,
  onInitGit,
  onOpenDiff,
}: {
  gitSummary?: GitSummary | null;
  gitBranch?: string | null;
  onInitGit?: () => void;
  onOpenDiff: () => void;
}) {
  if (gitSummary?.isRepo) {
    return (
      <button
        type="button"
        onClick={onOpenDiff}
        className={cx(listRowClass, "hover:bg-(--hover)")}
        title="View changes"
      >
        <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-(--fg)/56" />
        <span className="min-w-0 flex-1 truncate text-(--fg)/72">
          {gitBranch ?? gitSummary.branch ?? "git"}
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[length:var(--fs-xs)] tabular-nums">
          <span className="text-(--ok)">+{gitSummary.additions}</span>
          <span className="text-(--err)">-{gitSummary.deletions}</span>
          {gitSummary.statusCount > 0 ? (
            <span className="text-(--dim)">· {gitSummary.statusCount} files</span>
          ) : null}
        </span>
      </button>
    );
  }
  if (gitSummary && !gitSummary.isRepo && onInitGit) {
    return (
      <button
        type="button"
        onClick={onInitGit}
        className={cx(listRowClass, "text-(--fg)/56 hover:bg-(--hover) hover:text-(--fg)/82")}
      >
        <GitBranchIcon className="h-3.5 w-3.5 shrink-0" />
        Initialize git
      </button>
    );
  }
  return null;
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
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  queueCount: number;
}) {
  const hasQueue = queueCount > 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex h-8 max-w-full min-w-0 items-center gap-2 rounded-[10px] px-2 text-left text-(--fg)/78 transition-colors hover:bg-(--hover)"
    >
      {hasQueue ? (
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-(--fg)/56" strokeWidth={1.7} />
      ) : (
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-(--fg)/56" strokeWidth={1.7} />
      )}
      <span className="min-w-0 truncate">
        {hasQueue ? `${queueCount} queued message${queueCount === 1 ? "" : "s"}` : label}
      </span>
      <ChevronDown
        className={cx(
          "h-3.5 w-3.5 shrink-0 text-(--fg)/36 transition-transform",
          open && "rotate-180",
        )}
        strokeWidth={1.75}
      />
    </button>
  );
}
