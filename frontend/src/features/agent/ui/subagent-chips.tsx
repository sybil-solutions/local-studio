"use client";

// Codex-style subagent chips: each child agent this session spawned, with a
// live status dot; click to open the subagent's own session (drill-in).

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type SubagentRun = {
  id: string;
  name: string;
  piSessionId: string | null;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt: string | null;
  error?: string;
};

async function fetchSubagents(parentPiSessionId: string): Promise<SubagentRun[]> {
  const response = await fetch(
    `/api/agent/subagents?piSessionId=${encodeURIComponent(parentPiSessionId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) return [];
  const payload = (await response.json()) as { subagents?: SubagentRun[] };
  return Array.isArray(payload.subagents) ? payload.subagents : [];
}

export function SubagentChips({ piSessionId }: { piSessionId: string }) {
  const router = useRouter();
  const [runs, setRuns] = useState<SubagentRun[]>([]);

  useMountSubscription(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchSubagents(piSessionId);
        if (!cancelled) setRuns(next);
      } catch {
        // Transient; next poll retries.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [piSessionId]);

  if (runs.length === 0) return null;

  return (
    <div className="mx-auto mb-1.5 flex w-full max-w-[var(--composer-w)] flex-wrap items-center gap-1.5">
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          disabled={!run.piSessionId}
          onClick={() => {
            if (run.piSessionId) {
              router.push(`/agent?session=${encodeURIComponent(run.piSessionId)}`);
            }
          }}
          title={
            run.status === "error"
              ? `${run.name} — failed: ${run.error ?? "unknown error"}`
              : `${run.name} — ${run.status === "running" ? "working" : "open the subagent session"}`
          }
          className="flex items-center gap-1.5 rounded-full bg-(--fg)/[0.05] px-2.5 py-1 text-[length:var(--fs-sm)] text-(--fg)/75 transition-colors hover:bg-(--fg)/[0.08] hover:text-(--fg)/90 disabled:cursor-default"
        >
          {run.status === "running" ? (
            <Spinner size="xs" />
          ) : (
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                run.status === "error" ? "bg-(--err)" : "bg-(--ok,#40c977)"
              }`}
            />
          )}
          <span className="max-w-44 truncate">{run.name}</span>
          {run.status === "done" ? <span className="text-(--fg)/40">updated</span> : null}
        </button>
      ))}
    </div>
  );
}
