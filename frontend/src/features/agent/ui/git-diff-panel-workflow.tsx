"use client";

import { useState } from "react";
import { GitBranchIcon, ReloadIcon } from "@/ui/icons";
import { Input, Button } from "@/ui";
import type { GitAction, GitRef, GitState } from "@/features/agent/contracts";
import { safeJson } from "@/features/agent/safe-json";
import { gitDiffHeaderTitle } from "@/features/agent/ui/git-diff-panel-model";

export function GitPanelHeader({
  cwd,
  loading,
  payload,
  onReload,
}: {
  cwd: string | null;
  loading: boolean;
  payload: Partial<GitState> | null;
  onReload: () => Promise<void>;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--border)/80 bg-(--color-header) px-3 text-xs">
      <GitBranchIcon className="h-3.5 w-3.5 text-(--dim)" />
      <span className="min-w-0 flex-1 truncate text-(--fg)" title={cwd ?? ""}>
        {gitDiffHeaderTitle(payload, cwd)}
      </span>
      <button
        type="button"
        onClick={() => void onReload()}
        disabled={loading || !cwd}
        className="rounded-md p-1 text-(--dim) hover:bg-(--hover) hover:text-(--fg) disabled:opacity-40"
        title="Refresh review state"
      >
        <ReloadIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

export function GitWorkflowBar({
  payload,
  loading,
  commitMessage,
  onCommitMessage,
  onRun,
}: {
  payload: (Partial<GitState> & { error?: string }) | null;
  loading: boolean;
  commitMessage: string;
  onCommitMessage: (value: string) => void;
  onRun: (action: GitAction) => Promise<void>;
}) {
  if (!payload?.isRepo) return null;
  const dirty = (payload.status?.length ?? 0) > 0;
  return (
    <div className="grid gap-2 border-b border-(--border)/80 bg-(--color-panel) p-2 text-[length:var(--fs-sm)] text-(--dim)">
      <div className="flex items-center gap-2">
        <RefSelect
          refs={payload.refs ?? []}
          branch={payload.branch}
          loading={loading}
          onRun={onRun}
        />
        <span className="min-w-0 flex-1 truncate font-mono">
          <span className="text-(--color-diff-added)">+{payload.additions ?? 0}</span>{" "}
          <span className="text-(--color-diff-removed)">-{payload.deletions ?? 0}</span>{" "}
          {payload.status?.length ?? 0} files
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading || !payload.branch}
          onClick={() => void onRun({ action: "push" })}
        >
          Push
        </Button>
      </div>
      {dirty ? (
        <div className="flex items-center gap-2">
          <Input
            value={commitMessage}
            onChange={(event) => onCommitMessage(event.target.value)}
            placeholder="commit message"
            className="h-7 min-w-0 flex-1 rounded-md border border-(--border)/80 bg-(--color-input) px-2 text-(--fg) outline-none focus:border-(--color-border-hover)"
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || !commitMessage.trim()}
            onClick={() =>
              void onRun({ action: "commit", message: commitMessage.trim(), paths: [] })
            }
            title="Stage all current changes and commit"
          >
            Commit
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RefSelect({
  refs,
  branch,
  loading,
  onRun,
}: {
  refs: GitRef[];
  branch?: string | null;
  loading: boolean;
  onRun: (action: GitAction) => Promise<void>;
}) {
  return (
    <select
      value={branch ?? ""}
      disabled={loading || refs.length === 0}
      onChange={(event) =>
        event.currentTarget.value &&
        void onRun({ action: "checkout", ref: event.currentTarget.value })
      }
      className="h-7 min-w-[9rem] rounded-md border border-(--border)/80 bg-(--color-input) px-2 text-(--fg)"
      title="Switch branch"
    >
      <option value="">{branch ?? "detached"}</option>
      {refs.map((ref) => (
        <option key={ref.name} value={ref.name}>
          {ref.remote ? "remote/" : ""}
          {ref.name}
        </option>
      ))}
    </select>
  );
}

type ChecksSummary = { pending: number; passing: number; failing: number; total: number };

export type PullRequest = {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  mergeable: string;
  checksSummary: ChecksSummary;
};

export type PrPayload = { pr?: PullRequest; error?: string };

export type MergeMethod = "merge" | "squash" | "rebase";

export async function loadPr(cwd: string): Promise<PrPayload> {
  const response = await fetch(`/api/agent/pr?cwd=${encodeURIComponent(cwd)}`, {
    cache: "no-store",
  });
  const payload = await safeJson<PrPayload>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to load pull request");
  return payload;
}

export async function mergePr(cwd: string, number: number, method: MergeMethod): Promise<void> {
  const response = await fetch("/api/agent/pr/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, number, method }),
  });
  const payload = await safeJson<{ ok?: boolean; error?: string }>(response);
  if (!response.ok || payload.error) throw new Error(payload.error || "Merge failed");
}

export function PrSection({
  pr,
  merging,
  mergeError,
  onMerge,
}: {
  pr: PullRequest | null;
  merging: boolean;
  mergeError: string | null;
  onMerge: (method: MergeMethod) => Promise<void>;
}) {
  const [method, setMethod] = useState<MergeMethod>("merge");
  if (!pr) return null;
  const mergeDisabled = merging || pr.state !== "OPEN" || pr.mergeable === "CONFLICTING";
  return (
    <div className="grid shrink-0 gap-1 border-b border-(--border)/80 bg-(--color-panel) px-3 py-2 text-[length:var(--fs-sm)]">
      <div className="flex items-center gap-2">
        <a
          href={pr.url || "#"}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 flex-1 truncate text-(--fg) hover:underline"
          title="Open on GitHub"
        >
          {pr.title} <span className="text-(--dim)">#{pr.number}</span>
        </a>
        <span className="shrink-0 text-(--dim)">{prStatusLabel(pr)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-(--dim)">
        <span className="truncate font-mono">
          {pr.headRefName || "—"} → {pr.baseRefName || "—"}
        </span>
        <span className="font-mono">
          <span className="text-(--color-diff-added)">+{pr.additions}</span>{" "}
          <span className="text-(--color-diff-removed)">−{pr.deletions}</span>
        </span>
        <ChecksLabel summary={pr.checksSummary} />
        <span className="ml-auto inline-flex items-center gap-2">
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as MergeMethod)}
            disabled={mergeDisabled}
            aria-label="Merge method"
            className="h-7 rounded-md border border-(--border)/80 bg-(--color-input) px-2 text-(--fg) disabled:opacity-50"
          >
            <option value="merge">Merge</option>
            <option value="squash">Squash</option>
            <option value="rebase">Rebase</option>
          </select>
          <Button
            variant="ghost"
            size="sm"
            disabled={mergeDisabled}
            loading={merging}
            onClick={() => void onMerge(method)}
          >
            Merge
          </Button>
        </span>
      </div>
      {pr.mergeable === "CONFLICTING" ? (
        <p className="text-(--dim)">This branch has conflicts that must be resolved.</p>
      ) : null}
      {mergeError ? <p className="text-(--color-diff-removed)">{mergeError}</p> : null}
    </div>
  );
}

function ChecksLabel({ summary }: { summary: ChecksSummary }) {
  if (summary.total === 0) return null;
  const parts: string[] = [];
  if (summary.passing > 0) parts.push(`${summary.passing} passing`);
  if (summary.failing > 0) parts.push(`${summary.failing} failing`);
  if (summary.pending > 0) parts.push(`${summary.pending} pending`);
  return (
    <span className={summary.failing > 0 ? "text-(--color-diff-removed)" : undefined}>
      {parts.join(", ")}
    </span>
  );
}

function prStatusLabel(pr: PullRequest): string {
  if (pr.state !== "OPEN") {
    return pr.state.charAt(0) + pr.state.slice(1).toLowerCase();
  }
  return pr.isDraft ? "Draft" : "Ready for review";
}
