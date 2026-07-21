"use client";

import { formatTokenCount } from "@/features/agent/messages";
import type { GitSummary } from "@/features/agent/projects/types";
import { GitBranchIcon } from "@/ui/icons";

export function AgentComposerStatusBar({
  cwd,
  gitBranch,
  gitSummary,
  onInitGit,
  currentContextTokens,
  contextWindow,
  onOpenStatus,
  onOpenDiff,
}: {
  cwd: string;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  onInitGit?: () => void;
  currentContextTokens: number;
  contextWindow: number;
  onOpenStatus: () => void;
  onOpenDiff: () => void;
}) {
  const displayCwd = formatHomeRelativePath(cwd);

  return (
    <div className="relative z-20 mx-auto mt-2.5 flex w-full max-w-[var(--composer-w)] items-center gap-2 overflow-visible font-mono text-[length:var(--fs-xs)] text-(--dim)">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-visible">
        <div className="min-w-0 max-w-[42%] shrink overflow-visible">
          {displayCwd ? (
            <span className="block min-w-0 truncate text-(--dim)" title={cwd}>
              {displayCwd}
            </span>
          ) : null}
        </div>
        <GitBranchState gitBranch={gitBranch} gitSummary={gitSummary} onInitGit={onInitGit} />
        <GitSummaryState gitSummary={gitSummary} onOpenDiff={onOpenDiff} />
      </div>
      <ContextReadout
        current={currentContextTokens}
        contextWindow={contextWindow}
        onClick={onOpenStatus}
      />
    </div>
  );
}

function GitBranchState({
  gitBranch,
  gitSummary,
  onInitGit,
}: {
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  onInitGit?: () => void;
}) {
  if (gitBranch) {
    return (
      <span className="inline-flex min-w-0 shrink items-center gap-1 text-(--dim)">
        <GitBranchIcon className="h-3 w-3 shrink-0" />
        <span className="truncate">{gitBranch}</span>
      </span>
    );
  }

  if (gitSummary && !gitSummary.isRepo) {
    return (
      <button
        type="button"
        onClick={onInitGit}
        className="inline-flex shrink-0 items-center gap-1 text-(--dim) hover:text-(--fg)"
        title="Init git"
      >
        <GitBranchIcon className="h-3 w-3" />
        git
      </button>
    );
  }

  return null;
}

function GitSummaryState({
  gitSummary,
  onOpenDiff,
}: {
  gitSummary?: GitSummary | null;
  onOpenDiff: () => void;
}) {
  if (!gitSummary?.isRepo) return null;

  // The single diff-stat surface: the old pill above the composer duplicated
  // this. Clicking opens the working-tree diff in a drawer.
  return (
    <button
      type="button"
      onClick={onOpenDiff}
      className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1 transition-colors hover:bg-(--fg)/[0.05]"
      title="View changes"
    >
      <span className="text-(--ok)">+{gitSummary.additions}</span>
      <span className="text-(--err)">-{gitSummary.deletions}</span>
      {gitSummary.statusCount > 0 ? (
        <span className="text-(--dim)">· {gitSummary.statusCount} files</span>
      ) : null}
    </button>
  );
}

function ContextReadout({
  current,
  contextWindow,
  onClick,
}: {
  current: number;
  contextWindow: number;
  onClick: () => void;
}) {
  const title = `Open status · Context ${formatTokenCount(current)} / ${formatTokenCount(contextWindow)}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-auto inline-flex shrink-0 items-center rounded-sm px-1 text-(--dim) hover:text-(--fg)/80"
      title={title}
      aria-label={title}
    >
      <span className="tabular-nums">
        {formatTokenCount(current)}/{formatTokenCount(contextWindow)}
      </span>
    </button>
  );
}

function formatHomeRelativePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "";
  const homeMatch = normalized.match(/^\/Users\/[^/]+(\/.*)?$/);
  if (homeMatch) return `~${homeMatch[1] ?? ""}`;
  return normalized;
}
