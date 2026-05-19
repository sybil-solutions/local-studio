"use client";

import { useCallback, useMemo, useState } from "react";
import { GitBranchIcon, ReloadIcon } from "@/components/icons";
import type { GitAction, GitRef, GitState } from "@/lib/agent/contracts/git";
import { loadGitState, runGitAction } from "@/lib/agent/git/client";
import { useGitDiffPanelEffects } from "@/hooks/agent/use-git-diff-panel-effects";
import {
  diffLineClassName,
  diffLinePrefix,
  gitDiffHeaderTitle,
  parseUnifiedDiff,
  type DiffFile,
} from "./git-diff-panel-model";

export function GitDiffPanel({ cwd }: { cwd: string | null }) {
  const [payload, setPayload] = useState<(Partial<GitState> & { error?: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [draftBranch, setDraftBranch] = useState("");
  const [commitMessage, setCommitMessage] = useState("");

  const load = useCallback(async () => {
    if (!cwd) return setPayload(null);
    setLoading(true);
    try {
      setPayload(await loadGitState(cwd));
    } catch (error) {
      setPayload({ error: error instanceof Error ? error.message : "Failed to load git state" });
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  const run = useCallback(
    async (action: GitAction) => {
      if (!cwd) return;
      setLoading(true);
      try {
        setPayload(await runGitAction(cwd, action));
        if (action.action === "createBranch") setDraftBranch("");
        if (action.action === "commit") setCommitMessage("");
      } catch (error) {
        setPayload((current) => ({
          ...(current ?? {}),
          error: error instanceof Error ? error.message : "Git action failed",
        }));
      } finally {
        setLoading(false);
      }
    },
    [cwd],
  );

  useGitDiffPanelEffects(load);
  const files = useMemo(() => parseUnifiedDiff(payload?.diff ?? ""), [payload?.diff]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <GitPanelHeader cwd={cwd} loading={loading} payload={payload} onReload={load} />
      <GitWorkflowBar
        payload={payload}
        loading={loading}
        draftBranch={draftBranch}
        commitMessage={commitMessage}
        onDraftBranch={setDraftBranch}
        onCommitMessage={setCommitMessage}
        onRun={run}
      />
      <GitDiffPanelBody
        cwd={cwd}
        files={files}
        initGit={() => run({ action: "init" })}
        loading={loading}
        payload={payload}
      />
    </section>
  );
}

function GitPanelHeader({
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
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--border) px-3 text-xs">
      <GitBranchIcon className="h-3.5 w-3.5 text-(--dim)" />
      <span className="min-w-0 flex-1 truncate text-(--fg)" title={cwd ?? ""}>
        {gitDiffHeaderTitle(payload, cwd)}
      </span>
      <button
        type="button"
        onClick={() => void onReload()}
        disabled={loading || !cwd}
        className="rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg) disabled:opacity-40"
        title="Refresh git state"
      >
        <ReloadIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}

function GitWorkflowBar({
  payload,
  loading,
  draftBranch,
  commitMessage,
  onDraftBranch,
  onCommitMessage,
  onRun,
}: {
  payload: (Partial<GitState> & { error?: string }) | null;
  loading: boolean;
  draftBranch: string;
  commitMessage: string;
  onDraftBranch: (value: string) => void;
  onCommitMessage: (value: string) => void;
  onRun: (action: GitAction) => Promise<void>;
}) {
  if (!payload?.isRepo) return null;
  const dirty = (payload.status?.length ?? 0) > 0;
  return (
    <div className="grid gap-2 border-b border-(--border) bg-(--surface)/35 p-2 text-[11px] text-(--dim)">
      <div className="flex flex-wrap items-center gap-2">
        <RefSelect
          refs={payload.refs ?? []}
          branch={payload.branch}
          loading={loading}
          onRun={onRun}
        />
        <input
          value={draftBranch}
          onChange={(event) => onDraftBranch(event.target.value)}
          placeholder="new branch"
          className="h-7 min-w-0 flex-1 rounded border border-(--border) bg-(--bg) px-2 text-(--fg) outline-none"
        />
        <button
          type="button"
          disabled={loading || !draftBranch.trim()}
          onClick={() => void onRun({ action: "createBranch", branch: draftBranch.trim() })}
          className="h-7 rounded border border-(--border) px-2 text-(--fg) disabled:opacity-40"
        >
          Branch
        </button>
        <button
          type="button"
          disabled={loading || !payload.branch}
          onClick={() => void onRun({ action: "push" })}
          className="h-7 rounded border border-(--border) px-2 text-(--fg) disabled:opacity-40"
        >
          Push
        </button>
        {payload.prUrl ? (
          <a
            className="h-7 rounded border border-(--border) px-2 leading-7 text-(--fg)"
            href={payload.prUrl}
            target="_blank"
          >
            PR
          </a>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={commitMessage}
          onChange={(event) => onCommitMessage(event.target.value)}
          placeholder={dirty ? "commit message" : "working tree clean"}
          disabled={!dirty}
          className="h-7 min-w-0 flex-1 rounded border border-(--border) bg-(--bg) px-2 text-(--fg) outline-none disabled:opacity-45"
        />
        <button
          type="button"
          disabled={loading || !dirty || !commitMessage.trim()}
          onClick={() => void onRun({ action: "commit", message: commitMessage.trim(), paths: [] })}
          className="h-7 rounded border border-(--border) px-2 text-(--fg) disabled:opacity-40"
          title="Stage all current changes and commit"
        >
          Commit all
        </button>
        <span className="font-mono">
          <span className="text-emerald-400">+{payload.additions ?? 0}</span>{" "}
          <span className="text-red-400">-{payload.deletions ?? 0}</span>{" "}
          {payload.status?.length ?? 0} files
        </span>
      </div>
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
      className="h-7 min-w-[9rem] rounded border border-(--border) bg-(--bg) px-2 text-(--fg)"
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

function GitDiffPanelBody({
  cwd,
  files,
  initGit,
  loading,
  payload,
}: {
  cwd: string | null;
  files: DiffFile[];
  initGit: () => Promise<void>;
  loading: boolean;
  payload: (Partial<GitState> & { error?: string }) | null;
}) {
  if (!cwd)
    return (
      <div className="p-4 text-xs text-(--dim)">
        Choose a project directory to view git changes.
      </div>
    );
  if (payload?.error)
    return (
      <div className="m-3 rounded border border-(--err)/30 bg-(--err)/10 p-3 text-xs text-(--err)">
        {payload.error}
      </div>
    );
  if (payload?.isRepo === false) return <InitializeGitPanel initGit={initGit} loading={loading} />;
  if (files.length === 0)
    return <EmptyDiffPanel loading={loading} status={payload?.status ?? []} />;
  return <DiffFileList files={files} />;
}

function InitializeGitPanel({
  initGit,
  loading,
}: {
  initGit: () => Promise<void>;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 p-4 text-xs text-(--dim)">
      <span>This directory is not a git repository.</span>
      <button
        type="button"
        onClick={() => void initGit()}
        disabled={loading}
        className="w-fit rounded border border-(--border) bg-(--surface) px-2 py-1 text-(--fg) hover:bg-(--bg) disabled:opacity-50"
      >
        Initialize git repository
      </button>
    </div>
  );
}

function EmptyDiffPanel({ loading, status }: { loading: boolean; status: string[] }) {
  const rows = status.map(parseStatusLine).filter((row): row is GitStatusRow => Boolean(row));
  return (
    <div className="p-4 text-xs text-(--dim)">
      {loading ? "Loading diff…" : "No unstaged tracked-file changes."}
      {rows.length > 0 ? (
        <div className="mt-3 grid gap-1">
          {rows.map((row) => (
            <details
              key={`${row.status}:${row.path}`}
              className="rounded-md border border-(--border) bg-(--surface)/45"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 text-(--fg) hover:bg-(--hover) [&::-webkit-details-marker]:hidden">
                <span className="rounded border border-(--border) px-1 font-mono text-[10px] text-(--dim)">
                  {row.label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{row.path}</span>
              </summary>
              <div className="border-t border-(--border) px-2 py-2 text-[11px] leading-5">
                <div className="text-(--dim)">No textual diff is available for this file yet.</div>
                <div className="mt-1 font-mono text-(--fg)">{row.path}</div>
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type GitStatusRow = { status: string; label: string; path: string };

function parseStatusLine(line: string): GitStatusRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const status = trimmed.slice(0, 2).trim() || trimmed.slice(0, 1);
  const path = trimmed.slice(2).trim();
  if (!path) return null;
  const label =
    status === "??"
      ? "Untracked"
      : status === "M"
        ? "Modified"
        : status === "A"
          ? "Added"
          : status === "D"
            ? "Deleted"
            : status;
  return { status, label, path };
}

function DiffFileList({ files }: { files: DiffFile[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-5">
      <div className="flex flex-col gap-2">
        {files.map((file, fileIndex) => (
          <details
            key={file.path}
            className="overflow-hidden rounded-md border border-(--border) bg-(--bg)"
            open={fileIndex === 0}
          >
            <summary
              className="flex cursor-pointer list-none items-center gap-2 border-b border-(--border) bg-(--surface)/70 px-2 py-1.5 text-xs text-(--fg) hover:bg-(--surface)"
              title={file.path}
            >
              <span className="min-w-0 flex-1 truncate">{file.path}</span>
              <span className="shrink-0 font-mono text-[10px]">
                <span className="text-emerald-400">+{file.additions}</span>{" "}
                <span className="text-red-400">-{file.deletions}</span>
              </span>
            </summary>
            <div className="min-w-max">
              {file.lines.map((line, index) => (
                <div
                  key={`${file.path}-${index}`}
                  className={`grid grid-cols-[3rem_3rem_1fr] gap-2 border-b border-(--border)/20 px-2 ${diffLineClassName(line.kind)}`}
                >
                  <span className="select-none text-right text-(--dim)">{line.oldLine ?? ""}</span>
                  <span className="select-none text-right text-(--dim)">{line.newLine ?? ""}</span>
                  <span className="whitespace-pre">
                    {diffLinePrefix(line.kind)}
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
