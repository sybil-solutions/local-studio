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
  const [viewMode, setViewMode] = useState<"unified" | "side-by-side" | "stacked">("unified");

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
        viewMode={viewMode}
        onViewMode={setViewMode}
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
  viewMode,
  onViewMode,
  initGit,
  loading,
  payload,
}: {
  cwd: string | null;
  files: DiffFile[];
  viewMode: "unified" | "side-by-side" | "stacked";
  onViewMode: (mode: "unified" | "side-by-side" | "stacked") => void;
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
  return <DiffFileList files={files} viewMode={viewMode} onViewMode={onViewMode} />;
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
  return (
    <div className="p-4 text-xs text-(--dim)">
      {loading ? "Loading diff…" : "No unstaged tracked-file changes."}
      {status.length > 0 ? (
        <pre className="mt-3 overflow-auto rounded border border-(--border) bg-(--surface) p-2 font-mono text-[11px] text-(--fg)">
          {status.join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

function DiffFileList({
  files,
  viewMode,
  onViewMode,
}: {
  files: DiffFile[];
  viewMode: "unified" | "side-by-side" | "stacked";
  onViewMode: (mode: "unified" | "side-by-side" | "stacked") => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-5">
      <div className="sticky top-0 z-10 mb-2 flex items-center justify-end gap-1 bg-(--bg)/95 py-1">
        <DiffModeButton active={viewMode === "unified"} onClick={() => onViewMode("unified")}>
          Unified
        </DiffModeButton>
        <DiffModeButton
          active={viewMode === "side-by-side"}
          onClick={() => onViewMode("side-by-side")}
        >
          Side by side
        </DiffModeButton>
        <DiffModeButton active={viewMode === "stacked"} onClick={() => onViewMode("stacked")}>
          Top / bottom
        </DiffModeButton>
      </div>
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
            {viewMode === "side-by-side" ? (
              <SideBySideDiff file={file} />
            ) : viewMode === "stacked" ? (
              <StackedDiff file={file} />
            ) : (
              <UnifiedDiff file={file} />
            )}
          </details>
        ))}
      </div>
    </div>
  );
}

function DiffModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-6 rounded px-2 text-[10px] ${
        active ? "bg-(--surface) text-(--fg)" : "text-(--dim) hover:text-(--fg)"
      }`}
    >
      {children}
    </button>
  );
}

function UnifiedDiff({ file }: { file: DiffFile }) {
  return (
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
  );
}

function SideBySideDiff({ file }: { file: DiffFile }) {
  const rows = pairDiffLines(file);
  return (
    <div className="min-w-[52rem]">
      {rows.map((row, index) => (
        <div
          key={`${file.path}-pair-${index}`}
          className="grid grid-cols-2 border-b border-(--border)/20"
        >
          <DiffCell line={row.left} side="old" />
          <DiffCell line={row.right} side="new" />
        </div>
      ))}
    </div>
  );
}

function StackedDiff({ file }: { file: DiffFile }) {
  const oldLines = file.lines.filter((line) => line.kind !== "add");
  const newLines = file.lines.filter((line) => line.kind !== "del");
  return (
    <div className="grid gap-2 p-2">
      <div className="rounded border border-red-500/20">
        <div className="border-b border-red-500/20 px-2 py-1 text-[10px] uppercase tracking-wide text-red-300">
          Before
        </div>
        {oldLines.map((line, index) => (
          <DiffStackLine key={`${file.path}-old-${index}`} line={line} />
        ))}
      </div>
      <div className="rounded border border-emerald-500/20">
        <div className="border-b border-emerald-500/20 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-300">
          After
        </div>
        {newLines.map((line, index) => (
          <DiffStackLine key={`${file.path}-new-${index}`} line={line} />
        ))}
      </div>
    </div>
  );
}

function DiffCell({ line, side }: { line?: DiffFile["lines"][number]; side: "old" | "new" }) {
  if (!line) {
    return <div className="min-h-5 border-r border-(--border)/20 bg-(--surface)/20" />;
  }
  const lineNumber = side === "old" ? line.oldLine : line.newLine;
  return (
    <div
      className={`grid grid-cols-[3rem_1fr] gap-2 border-r border-(--border)/20 px-2 ${diffLineClassName(line.kind)}`}
    >
      <span className="select-none text-right text-(--dim)">{lineNumber ?? ""}</span>
      <span className="whitespace-pre">
        {diffLinePrefix(line.kind)}
        {line.text}
      </span>
    </div>
  );
}

function DiffStackLine({ line }: { line: DiffFile["lines"][number] }) {
  return (
    <div className={`grid grid-cols-[3rem_1fr] gap-2 px-2 ${diffLineClassName(line.kind)}`}>
      <span className="select-none text-right text-(--dim)">
        {line.kind === "del" ? line.oldLine : (line.newLine ?? line.oldLine ?? "")}
      </span>
      <span className="whitespace-pre">
        {diffLinePrefix(line.kind)}
        {line.text}
      </span>
    </div>
  );
}

function pairDiffLines(file: DiffFile): Array<{
  left?: DiffFile["lines"][number];
  right?: DiffFile["lines"][number];
}> {
  const rows: Array<{ left?: DiffFile["lines"][number]; right?: DiffFile["lines"][number] }> = [];
  const pendingDeletes: DiffFile["lines"] = [];
  for (const line of file.lines) {
    if (line.kind === "del") {
      pendingDeletes.push(line);
      continue;
    }
    if (line.kind === "add") {
      rows.push({ left: pendingDeletes.shift(), right: line });
      continue;
    }
    while (pendingDeletes.length > 0) rows.push({ left: pendingDeletes.shift() });
    rows.push({ left: line, right: line });
  }
  while (pendingDeletes.length > 0) rows.push({ left: pendingDeletes.shift() });
  return rows;
}
