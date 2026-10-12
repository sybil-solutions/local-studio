"use client";

// A subagent, rendered where it was spawned.
//
// This used to be a strip pinned above the composer: the whole session's
// children in one list, detached from the turn that started them, so a
// transcript scrolled back three fan-outs told you nothing about which
// subagents belonged to which request. Here the row sits in the conversation
// at its own turn, and clicking it opens that child's session in the side
// panel rather than navigating the workspace away from the parent.
//
// Identity comes from two places, because neither alone covers the whole run:
// the tool's own result carries the run id and pi session id but only once it
// finishes, while the shared poll knows live status from the moment the child
// starts. So the row reads the block for ids, falls back to matching the live
// poll by name, and prefers whichever it has.

import { createContext, useContext } from "react";
import { Spinner } from "@/ui";
import { Bot, ChevronRight } from "@/ui/icon-registry";
import type { ToolBlock } from "@/features/agent/messages";
import { useToolsActions } from "@/features/agent/tools/context";
import {
  SUBAGENT_STATUS_DOT,
  subagentStatusLabel,
  useSubagents,
  type SubagentRun,
} from "@/features/agent/ui/use-subagents";
import { cx } from "@/ui/utils";

/** The parent session a transcript belongs to. A context rather than four
 *  layers of props: the blocks between here and ChatPane are memoized, and
 *  threading a value through them would defeat those memo boundaries. */
export const TranscriptSessionContext = createContext<{
  piSessionId: string | null;
  cwd: string | null;
}>({ piSessionId: null, cwd: null });

function stringField(source: Record<string, unknown> | undefined, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function subagentName(block: ToolBlock): string {
  return stringField(block.details, "name") ?? stringField(block.args, "name") ?? "Subagent";
}

/** The live run behind this block: by run id when the tool has returned one,
 *  otherwise the newest run carrying the same name. */
function matchRun(block: ToolBlock, runs: SubagentRun[]): SubagentRun | null {
  const runId = stringField(block.details, "runId");
  if (runId) {
    const byId = runs.find((run) => run.id === runId);
    if (byId) return byId;
  }
  const name = subagentName(block);
  const byName = runs.filter((run) => run.name === name);
  return byName.length > 0 ? (byName[byName.length - 1] ?? null) : null;
}

export function SubagentRow({ block }: { block: ToolBlock }) {
  const { piSessionId: parentPiSessionId, cwd } = useContext(TranscriptSessionContext);
  const { requestSessionPreview } = useToolsActions();
  const runs = useSubagents(parentPiSessionId);
  const run = matchRun(block, runs);
  const name = subagentName(block);
  const childPiSessionId = stringField(block.details, "piSessionId") ?? run?.piSessionId ?? null;
  // The block's own status is the fallback for a replayed transcript whose
  // runs the registry no longer holds.
  const status = run?.status ?? (block.status === "running" ? "running" : "done");
  const working = status === "running" && run?.active !== false;
  const label = run ? subagentStatusLabel(run) : status === "running" ? "working" : "done";
  const failure = run?.error ?? (block.status === "error" ? block.resultText : null);

  return (
    <button
      type="button"
      disabled={!childPiSessionId}
      onClick={() => {
        if (!childPiSessionId) return;
        requestSessionPreview({ piSessionId: childPiSessionId, title: name, cwd });
      }}
      title={
        failure
          ? `${name} — failed: ${failure}`
          : childPiSessionId
            ? `${name} — open this subagent's session in the panel`
            : `${name} — starting`
      }
      className="group my-0.5 flex h-7 w-full items-center gap-2 rounded-[8px] px-1.5 text-left transition-colors hover:bg-(--hover) disabled:cursor-default"
    >
      <Bot className="h-3.5 w-3.5 shrink-0 text-(--fg)/40" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 shrink truncate text-[length:var(--fs-sm)] text-(--fg)/75">
        {name}
      </span>
      {working ? (
        <Spinner size="xs" />
      ) : (
        <span
          className={cx(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            SUBAGENT_STATUS_DOT[status] ?? "bg-(--fg)/30",
          )}
        />
      )}
      <span className="shrink-0 text-[length:var(--fs-xs)] text-(--fg)/40">{label}</span>
      <span className="min-w-0 flex-1" />
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-(--fg)/25 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
