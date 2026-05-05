"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitBranchIcon, ReloadIcon } from "@/components/icons";

type GitDiffPayload = {
  isRepo?: boolean;
  branch?: string | null;
  status?: string[];
  diff?: string;
  error?: string;
};

type DiffFile = {
  path: string;
  additions: number;
  deletions: number;
  lines: {
    kind: "meta" | "context" | "add" | "del";
    text: string;
    oldLine?: number;
    newLine?: number;
  }[];
};

function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      current = {
        path: match?.[2] ?? line.replace("diff --git ", ""),
        additions: 0,
        deletions: 0,
        lines: [],
      };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = Number(match?.[1] ?? 0);
      newLine = Number(match?.[2] ?? 0);
      current.lines.push({ kind: "meta", text: line });
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      current.lines.push({ kind: "meta", text: line });
      continue;
    }
    if (line.startsWith("+")) {
      current.additions += 1;
      current.lines.push({ kind: "add", text: line.slice(1), newLine });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      current.deletions += 1;
      current.lines.push({ kind: "del", text: line.slice(1), oldLine });
      oldLine += 1;
      continue;
    }
    current.lines.push({
      kind: "context",
      text: line.startsWith(" ") ? line.slice(1) : line,
      oldLine,
      newLine,
    });
    oldLine += 1;
    newLine += 1;
  }

  return files;
}

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

  useEffect(() => {
    void load();
  }, [load]);

  const files = useMemo(() => parseUnifiedDiff(payload?.diff ?? ""), [payload?.diff]);

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-(--border) px-3 text-xs">
        <GitBranchIcon className="h-3.5 w-3.5 text-(--dim)" />
        <span className="min-w-0 flex-1 truncate text-(--fg)" title={cwd ?? ""}>
          {payload?.branch ? payload.branch : cwd ? "Working tree diff" : "No directory"}
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

      {!cwd ? (
        <div className="p-4 text-xs text-(--dim)">
          Choose a project directory to view git changes.
        </div>
      ) : payload?.error ? (
        <div className="m-3 rounded border border-(--err)/30 bg-(--err)/10 p-3 text-xs text-(--err)">
          {payload.error}
        </div>
      ) : payload?.isRepo === false ? (
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
      ) : files.length === 0 ? (
        <div className="p-4 text-xs text-(--dim)">
          {loading ? "Loading diff…" : "No unstaged tracked-file changes."}
          {(payload?.status?.length ?? 0) > 0 ? (
            <pre className="mt-3 overflow-auto rounded border border-(--border) bg-(--surface) p-2 font-mono text-[11px] text-(--fg)">
              {payload?.status?.join("\n")}
            </pre>
          ) : null}
        </div>
      ) : (
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
                      className={`grid grid-cols-[3rem_3rem_1fr] gap-2 border-b border-(--border)/20 px-2 ${
                        line.kind === "add"
                          ? "bg-emerald-500/10 text-emerald-100"
                          : line.kind === "del"
                            ? "bg-red-500/10 text-red-100"
                            : line.kind === "meta"
                              ? "bg-(--surface) text-(--accent)"
                              : "text-(--fg)"
                      }`}
                    >
                      <span className="select-none text-right text-(--dim)">
                        {line.oldLine ?? ""}
                      </span>
                      <span className="select-none text-right text-(--dim)">
                        {line.newLine ?? ""}
                      </span>
                      <span className="whitespace-pre">
                        {line.kind === "add"
                          ? "+"
                          : line.kind === "del"
                            ? "-"
                            : line.kind === "context"
                              ? " "
                              : ""}
                        {line.text}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
