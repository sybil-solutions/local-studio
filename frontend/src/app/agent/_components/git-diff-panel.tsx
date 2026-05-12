"use client";

import { useCallback, useMemo, useState } from "react";
import { GitBranchIcon, ReloadIcon } from "@/components/icons";
import { useGitDiffPanelEffects } from "@/hooks/agent/use-git-diff-panel-effects";

import {
  diffLineClassName,
  diffLinePrefix,
  gitDiffHeaderTitle,
  parseUnifiedDiff,
  type DiffFile,
  type GitDiffPayload,
} from "./git-diff-panel-model";

export function GitDiffPanel({ cwd }: { cwd: string | null }) {
  const [payload, setPayload] = useState<GitDiffPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!cwd) {
      setPayload(null);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/agent/git-diff?cwd=${encodeURIComponent(cwd)}`, {
        cache: "no-store",
      });
      const next = (await response.json()) as GitDiffPayload;
      setPayload(next);
    } catch (error) {
      setPayload({ error: error instanceof Error ? error.message : "Failed to load git diff" });
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  const initGit = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/agent/git-diff?cwd=${encodeURIComponent(cwd)}`, {
        method: "POST",
      });
      if (!response.ok) {
        const next = (await response.json()) as GitDiffPayload;
        setPayload({ error: next.error || "Failed to initialize git repository" });
        return;
      }
      await load();
    } catch (error) {
      setPayload({
        error: error instanceof Error ? error.message : "Failed to initialize git repository",
      });
    } finally {
      setLoading(false);
    }
  }, [cwd, load]);

  useGitDiffPanelEffects(load);

  const files = useMemo(() => parseUnifiedDiff(payload?.diff ?? ""), [payload?.diff]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--border) px-3 text-xs">
        <GitBranchIcon className="h-3.5 w-3.5 text-(--dim)" />
        <span className="min-w-0 flex-1 truncate text-(--fg)" title={cwd ?? ""}>
          {gitDiffHeaderTitle(payload, cwd)}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || !cwd}
          className="rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg) disabled:opacity-40"
          title="Refresh diff"
        >
          <ReloadIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <GitDiffPanelBody
        cwd={cwd}
        files={files}
        initGit={initGit}
        loading={loading}
        payload={payload}
      />
    </section>
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
  payload: GitDiffPayload | null;
}) {
  if (!cwd) {
    return (
      <div className="p-4 text-xs text-(--dim)">
        Choose a project directory to view git changes.
      </div>
    );
  }
  if (payload?.error) {
    return (
      <div className="m-3 rounded border border-(--err)/30 bg-(--err)/10 p-3 text-xs text-(--err)">
        {payload.error}
      </div>
    );
  }
  if (payload?.isRepo === false) {
    return <InitializeGitPanel initGit={initGit} loading={loading} />;
  }
  if (files.length === 0) {
    return <EmptyDiffPanel loading={loading} status={payload?.status ?? []} />;
  }
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
