"use client";

// Every subagent thread this session spawned, on the Status tab.
//
// The transcript shows each child where it was spawned, which answers "what
// happened in this turn". This answers the other question — "what is running
// right now, across the whole session" — without scrolling the conversation.
// Both read the same shared poll, so they cannot disagree.

import { Spinner } from "@/ui";
import { ChevronRight } from "@/ui/icon-registry";
import { useToolsActions } from "@/features/agent/tools/context";
import {
  SUBAGENT_STATUS_DOT,
  subagentStatusLabel,
  useSubagents,
  type SubagentRun,
} from "@/features/agent/ui/use-subagents";
import { StatusGroup } from "@/features/agent/ui/status-panel-parts";
import { cx } from "@/ui/utils";

function elapsed(run: SubagentRun): string {
  const started = Date.parse(run.startedAt);
  const ended = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return "";
  const seconds = Math.max(0, Math.round((ended - started) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function StatusSubagentsSection({
  piSessionId,
  cwd,
}: {
  piSessionId: string | null;
  cwd: string | null;
}) {
  const { requestSessionPreview } = useToolsActions();
  const runs = useSubagents(piSessionId);
  if (runs.length === 0) return null;

  const running = runs.filter((run) => run.status === "running").length;

  return (
    <StatusGroup
      title="Subagents"
      count={runs.length}
      right={
        running > 0 ? (
          <span className="font-mono text-[length:var(--fs-xs)] text-(--ok)">{running} running</span>
        ) : null
      }
    >
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          disabled={!run.piSessionId}
          onClick={() => {
            if (!run.piSessionId) return;
            requestSessionPreview({ piSessionId: run.piSessionId, title: run.name, cwd });
          }}
          title={
            run.status === "error"
              ? `${run.name} — failed: ${run.error ?? "unknown error"}`
              : `${run.name} — open this thread in the panel`
          }
          className="group flex h-6 w-full items-center gap-2 rounded-[6px] px-1 text-left transition-colors hover:bg-(--hover) disabled:cursor-default disabled:opacity-60"
        >
          {run.status === "running" && run.active !== false ? (
            <Spinner size="xs" />
          ) : (
            <span
              className={cx("h-1.5 w-1.5 shrink-0 rounded-full", SUBAGENT_STATUS_DOT[run.status])}
            />
          )}
          <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-(--fg)/80">
            {run.name}
          </span>
          <span className="shrink-0 font-mono text-[length:var(--fs-xs)] tabular-nums text-(--fg)/35">
            {elapsed(run)}
          </span>
          <span className="w-12 shrink-0 truncate text-right text-[length:var(--fs-xs)] text-(--fg)/45">
            {subagentStatusLabel(run)}
          </span>
          <ChevronRight className="h-3 w-3 shrink-0 text-(--fg)/25 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ))}
    </StatusGroup>
  );
}
