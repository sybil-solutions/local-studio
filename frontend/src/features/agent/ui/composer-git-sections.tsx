"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  Check,
  ChevronRight,
  FolderOpen,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "@/ui/icon-registry";
import { GitBranchIcon } from "@/ui/icons";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { GitSummary } from "@/features/agent/projects/types";
import {
  addWorktree,
  createBranch,
  listBranches,
  listWorktrees,
  removeWorktree,
  switchBranch,
} from "@/features/agent/projects/api";
import type { GitBranch as GitBranchType, GitWorktree } from "@/features/agent/contracts";
import { cx } from "@/ui/utils";

export const iconButtonClass =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--fg)/42 transition-colors hover:bg-(--hover) hover:text-(--fg)/82 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--fg)/25";

export const listRowClass =
  "flex h-8 w-full items-center gap-2 rounded-[10px] px-2 text-left transition-colors";

export const searchInputClass =
  "h-7 w-full min-w-0 rounded-md bg-(--fg)/[0.04] px-2 text-[length:var(--fs-xs)] text-(--fg) outline-none placeholder:text-(--fg)/30 focus:bg-(--fg)/[0.06]";

export function GitResourceSections({
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
      <GitResourceSection
        loading={loading}
        busy={busy}
        enabled={enabled}
        config={{
          icon: <GitBranch className="h-3.5 w-3.5 shrink-0 text-(--fg)/46" />,
          noun: "branch",
          items: branches,
          createFields: [{ ariaLabel: "New branch name", placeholder: "Branch name" }],
          onCreate: ([name]) =>
            void run(async () => {
              await createBranch(cwd, name);
              await onBranchSwitched();
            }, "Failed to create branch"),
          keyOf: (branch) => branch.name,
          nameOf: (branch) => branch.name,
          isCurrent: (branch) => branch.current,
          rowIcon: <GitBranch className="h-3.5 w-3.5 shrink-0 text-(--fg)/34" />,
          rowTitle: (branch) =>
            branch.remote ? `Remote branch ${branch.name}` : `Switch to ${branch.name}`,
          rowBody: (branch) => (
            <span className="min-w-0 flex-1 truncate">
              {branch.name}
              {branch.remote ? <span className="text-(--dim)"> (remote)</span> : null}
            </span>
          ),
          chevron: true,
          onSwitch: (branch) =>
            void run(async () => {
              await switchBranch(cwd, branch.name);
              await onBranchSwitched();
            }, "Failed to switch branch"),
        }}
      />
      <GitResourceSection
        loading={loading}
        busy={busy}
        enabled={enabled}
        config={{
          icon: <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-(--fg)/46" />,
          noun: "worktree",
          items: worktrees,
          createFields: [
            { ariaLabel: "New worktree branch", placeholder: "Branch (e.g. feat/new-thing)" },
            {
              ariaLabel: "New worktree path",
              placeholder: (drafts) => defaultWorktreePath(cwd, drafts[0] ?? ""),
            },
          ],
          onCreate: ([branch, path]) =>
            void run(async () => {
              await addWorktree(cwd, branch, path);
              await onWorktreePicked(path);
            }, "Failed to create worktree"),
          keyOf: (worktree) => worktree.path,
          nameOf: (worktree) => worktree.path,
          isCurrent: (worktree) => worktree.current,
          rowIcon: <FolderOpen className="h-3.5 w-3.5 shrink-0 text-(--fg)/34" strokeWidth={1.7} />,
          rowTitle: (worktree) =>
            worktree.current ? "Current working tree" : `Open worktree at ${worktree.path}`,
          rowBody: (worktree) => (
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[length:var(--fs-xs)]">
                {worktree.branch ?? "detached"}
              </span>
              <span className="block truncate text-[length:var(--fs-xs)] text-(--fg)/40">
                {worktree.path}
              </span>
            </span>
          ),
          onSwitch: (worktree) =>
            void run(() => onWorktreePicked(worktree.path), "Failed to open worktree"),
          onRemove: {
            label: "Remove worktree",
            run: (worktree) =>
              void run(async () => {
                await removeWorktree(cwd, worktree.path);
              }, "Failed to remove worktree"),
          },
        }}
      />
    </>
  );
}

type CreateField = {
  ariaLabel: string;
  placeholder: string | ((drafts: string[]) => string);
};

type GitResourceConfig<T> = {
  icon: ReactNode;
  /** Singular resource name ("branch"); every section label derives from it. */
  noun: string;
  items: T[] | null;
  createFields: CreateField[];
  onCreate: (values: string[]) => void;
  keyOf: (item: T) => string;
  nameOf: (item: T) => string;
  isCurrent: (item: T) => boolean;
  rowIcon: ReactNode;
  rowTitle: (item: T) => string;
  rowBody: (item: T) => ReactNode;
  chevron?: boolean;
  onSwitch: (item: T) => void;
  onRemove?: { label: string; run: (item: T) => void };
};

function GitResourceSection<T>({
  loading,
  busy,
  enabled,
  config,
}: {
  loading: boolean;
  busy: boolean;
  enabled: boolean;
  config: GitResourceConfig<T>;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [drafts, setDrafts] = useState<string[]>(() => config.createFields.map(() => ""));
  const items = config.items ?? [];
  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((item) => config.nameOf(item).toLowerCase().includes(q)) : items;

  const submitCreate = () => {
    const values = drafts.map((draft) => draft.trim());
    if (values.some((value) => !value)) return;
    config.onCreate(values);
    setDrafts(config.createFields.map(() => ""));
    setCreating(false);
  };

  // A single-field form submits inline (Enter/Escape on the input, check button
  // beside it); a multi-field form stacks its inputs and gets explicit
  // cancel/confirm buttons.
  const single = config.createFields.length === 1;
  const { noun } = config;
  const submitButton = (
    <button
      type="button"
      disabled={!drafts[0]?.trim() || busy}
      onClick={submitCreate}
      className={`${iconButtonClass} bg-(--fg)/90 text-(--bg) hover:bg-(--fg) hover:text-(--bg) disabled:opacity-35`}
      aria-label={`Create ${noun}`}
      title={`Create ${noun}`}
    >
      <Check className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <SectionShell
      icon={config.icon}
      label={`${noun[0]!.toUpperCase()}${noun.slice(1)}s`}
      count={config.items?.length ?? 0}
      addLabel={`New ${noun}`}
      addDisabled={!enabled}
      onAdd={() => setCreating((value) => !value)}
      query={query}
      onQueryChange={setQuery}
      placeholder={`Search ${noun}s…`}
      loading={loading}
      itemsLoaded={config.items !== null}
      emptyLabel={`No ${noun}s`}
      empty={config.items !== null && filtered.length === 0}
      create={
        creating ? (
          <div className={cx(single ? "flex items-center" : "flex flex-col", "gap-1 px-2 pb-0.5")}>
            {config.createFields.map((field, index) => (
              <input
                key={field.ariaLabel}
                autoFocus={index === 0}
                value={drafts[index] ?? ""}
                onChange={(event) => {
                  const next = event.target.value;
                  setDrafts((prev) => prev.map((value, i) => (i === index ? next : value)));
                }}
                onKeyDown={
                  single
                    ? (event) => {
                        if (event.key === "Enter") submitCreate();
                        if (event.key === "Escape") setCreating(false);
                      }
                    : undefined
                }
                placeholder={
                  typeof field.placeholder === "function"
                    ? field.placeholder(drafts)
                    : field.placeholder
                }
                className={searchInputClass}
                aria-label={field.ariaLabel}
              />
            ))}
            {single ? (
              submitButton
            ) : (
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className={iconButtonClass}
                  aria-label={`Cancel creating ${noun}`}
                  title="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                {submitButton}
              </div>
            )}
          </div>
        ) : null
      }
    >
      {filtered.map((item) => {
        const current = config.isCurrent(item);
        const key = config.keyOf(item);
        const remove = config.onRemove;
        const row = (
          <button
            key={remove ? undefined : key}
            type="button"
            disabled={busy || current || !enabled}
            onClick={() => config.onSwitch(item)}
            className={cx(
              listRowClass,
              remove ? "min-w-0 flex-1" : null,
              current ? "bg-(--hover)/50 text-(--fg)/90" : "hover:bg-(--hover)",
              "disabled:opacity-60",
            )}
            title={config.rowTitle(item)}
          >
            {current ? <Check className="h-3.5 w-3.5 shrink-0 text-(--accent)" /> : config.rowIcon}
            {config.rowBody(item)}
            {config.chevron && !current && enabled ? (
              <ChevronRight className="h-3 w-3 shrink-0 text-(--fg)/30" />
            ) : null}
          </button>
        );
        if (!remove) return row;
        return (
          <div key={key} className="group flex min-w-0 items-center">
            {row}
            {!current && enabled ? (
              <button
                type="button"
                onClick={() => remove.run(item)}
                className="mr-1 shrink-0 rounded-md p-1 text-(--fg)/40 opacity-0 transition-opacity hover:bg-(--fg)/[0.06] hover:text-(--err) group-hover:opacity-100"
                aria-label={remove.label}
                title={remove.label}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        );
      })}
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
  return (
    <div>
      <div className="flex h-7 w-full items-center gap-1.5 rounded-[10px] px-2 text-[length:var(--fs-sm)] font-medium text-(--fg)/52">
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count > 0 ? <span className="text-(--fg)/34">{count}</span> : null}
        {!addDisabled ? (
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
      <div className="px-2 pb-0.5">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          className={searchInputClass}
        />
      </div>
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
    </div>
  );
}

function defaultWorktreePath(cwd: string, branch: string): string {
  const cleaned = branch.trim().replace(/\//g, "-") || "worktree";
  const parent = cwd.slice(0, cwd.lastIndexOf("/") + 1) || "./";
  return `${parent}${cleaned}`;
}

export function GitRow({
  gitSummary,
  gitBranch,
  onInitGit,
  onOpenDiff,
  compact = false,
}: {
  gitSummary?: GitSummary | null;
  gitBranch?: string | null;
  onInitGit?: () => void;
  onOpenDiff: () => void;
  compact?: boolean;
}) {
  // Compact rows sit beside the summary button on one shared line, so they
  // keep the row metrics but give up w-full and let the summary take the slack.
  const rowClass = compact
    ? "flex h-8 shrink-0 items-center gap-2 rounded-[10px] px-2 text-left transition-colors"
    : listRowClass;
  if (gitSummary?.isRepo) {
    return (
      <button
        type="button"
        onClick={onOpenDiff}
        className={cx(rowClass, "hover:bg-(--hover)")}
        title="View changes"
      >
        <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-(--fg)/56" />
        <span className={cx("min-w-0 truncate text-(--fg)/72", compact ? "max-w-28" : "flex-1")}>
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
        className={cx(rowClass, "text-(--fg)/56 hover:bg-(--hover) hover:text-(--fg)/82")}
      >
        <GitBranchIcon className="h-3.5 w-3.5 shrink-0" />
        Initialize git
      </button>
    );
  }
  return null;
}
