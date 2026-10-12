"use client";

import { useCallback, useMemo, useState } from "react";
import { ErrorBox, Button } from "@/ui";
import type { GitAction, GitState } from "@/features/agent/contracts";
import { safeJson } from "@/features/agent/safe-json";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  parseUnifiedDiff,
  type DiffFile,
  type DiffViewMode,
} from "@/features/agent/ui/git-diff-panel-model";
import {
  GitPanelHeader,
  GitWorkflowBar,
  PrSection,
  loadPr,
  mergePr,
  type MergeMethod,
  type PrPayload,
} from "@/features/agent/ui/git-diff-panel-workflow";
import { DiffFileList } from "@/features/agent/ui/git-diff-panel-diff-view";

export function GitDiffPanel({ cwd }: { cwd: string | null }) {
  const [payload, setPayload] = useState<(Partial<GitState> & { error?: string }) | null>(null);
  const [prPayload, setPrPayload] = useState<PrPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");

  const load = useCallback(async () => {
    if (!cwd) {
      setPayload(null);
      setPrPayload(null);
      return;
    }
    setLoading(true);
    setMergeError(null);
    const [git, pr] = await Promise.allSettled([loadGitState(cwd), loadPr(cwd)]);
    setPayload(
      git.status === "fulfilled"
        ? git.value
        : { error: git.reason instanceof Error ? git.reason.message : "Failed to load git state" },
    );
    setPrPayload(pr.status === "fulfilled" ? pr.value : null);
    setLoading(false);
  }, [cwd]);

  const run = useCallback(
    async (action: GitAction) => {
      if (!cwd) return;
      setLoading(true);
      try {
        setPayload(await runGitAction(cwd, action));
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

  const merge = useCallback(
    async (method: MergeMethod) => {
      if (!cwd || !prPayload?.pr) return;
      setMerging(true);
      setMergeError(null);
      try {
        await mergePr(cwd, prPayload.pr.number, method);
        await load();
      } catch (error) {
        setMergeError(error instanceof Error ? error.message : "Merge failed");
      } finally {
        setMerging(false);
      }
    },
    [cwd, prPayload?.pr, load],
  );

  useMountSubscription(() => {
    void load();
  }, [load]);
  const files = useMemo(() => parseUnifiedDiff(payload?.diff ?? ""), [payload?.diff]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-(--color-panel)">
      <GitPanelHeader cwd={cwd} loading={loading} payload={payload} onReload={load} />
      <GitWorkflowBar
        payload={payload}
        loading={loading}
        commitMessage={commitMessage}
        onCommitMessage={setCommitMessage}
        onRun={run}
      />
      <PrSection
        pr={prPayload?.pr ?? null}
        merging={merging}
        mergeError={mergeError}
        onMerge={merge}
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
  viewMode: DiffViewMode;
  onViewMode: (mode: DiffViewMode) => void;
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
  if (payload?.error) return <ErrorBox className="m-3 p-3">{payload.error}</ErrorBox>;
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
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void initGit()}
        disabled={loading}
        className="w-fit"
      >
        Initialize git repository
      </Button>
    </div>
  );
}

function EmptyDiffPanel({ loading, status }: { loading: boolean; status: string[] }) {
  return (
    <div className="p-4 text-xs text-(--dim)">
      {loading ? "Loading diff…" : "No unstaged tracked-file changes."}
      {status.length > 0 ? (
        <pre className="mt-3 overflow-auto rounded-md border border-(--border)/80 bg-(--color-input) p-2 font-mono text-[length:var(--fs-sm)] text-(--fg)">
          {status.join("\n")}
        </pre>
      ) : null}
    </div>
  );
}

async function loadGitState(cwd: string): Promise<GitState> {
  const response = await fetch(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`, {
    cache: "no-store",
  });
  const payload = await safeJson<GitState & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to load git state");
  return payload;
}

async function runGitAction(cwd: string, action: GitAction): Promise<GitState> {
  const response = await fetch(`/api/agent/git?cwd=${encodeURIComponent(cwd)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  const payload = await safeJson<GitState & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Git action failed");
  return payload;
}
