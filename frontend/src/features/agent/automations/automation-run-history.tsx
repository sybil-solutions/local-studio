"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/ui";
import { Trash2 } from "@/ui/icon-registry";
import type { Automation } from "@shared/agent/automation";
import { relativeTime } from "./automation-model";

/**
 * The recorded runs of one automation, and the only way to forget them.
 *
 * Clearing is destructive and irreversible, so it takes the editor's
 * confirm-then-act shape rather than acting on the first click, and both labels
 * name the number of runs that disappear.
 */
export function AutomationRunHistory({
  automation,
  clearing,
  busy,
  onClearRuns,
}: {
  automation: Automation;
  clearing: boolean;
  busy: boolean;
  onClearRuns?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const count = automation.runs.length;
  const runWord = count === 1 ? "run" : "runs";

  return (
    <div className="border-t border-(--ui-separator) pt-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">Run history</h3>
        {onClearRuns ? (
          confirming ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                loading={clearing}
                disabled={busy}
                onClick={onClearRuns}
              >
                Delete {count} {runWord}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirming(true)}
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Clear {count} {runWord}
            </Button>
          )
        ) : (
          <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">
            {count} {runWord}
          </span>
        )}
      </div>
      <div className="divide-y divide-(--ui-separator) border-y border-(--ui-separator)">
        {automation.runs.map((run, index) => (
          <RunRow key={`${run.at}-${run.piSessionId ?? index}`} run={run} />
        ))}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: Automation["runs"][number] }) {
  // The session id is what opens the thread; the project only preselects
  // the sidebar. Requiring both hid every run of an automation whose cwd
  // is not a registered project — the scheduler resolves projectId by
  // matching cwd against the project list, so that is most of them — and
  // the UI claimed "Transcript unavailable" for threads that existed.
  const transcriptHref = run.piSessionId
    ? `/agent?${run.projectId ? `project=${encodeURIComponent(run.projectId)}&` : ""}session=${encodeURIComponent(run.piSessionId)}&replace=1`
    : null;
  return (
    <div className="px-1 py-3 transition-colors hover:bg-(--ui-hover)/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={
              run.outcome === "error"
                ? "text-[length:var(--fs-sm)] font-medium text-(--ui-danger)"
                : "text-[length:var(--fs-sm)] font-medium text-(--ui-fg)"
            }
          >
            {run.outcome === "error" ? "Failed" : "Completed"} {relativeTime(run.at)}
          </p>
          <p className="mt-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">
            {new Date(run.at).toLocaleString()}
          </p>
        </div>
        {transcriptHref ? (
          <Link
            href={transcriptHref}
            className="shrink-0 text-[length:var(--fs-sm)] text-(--link) hover:underline"
          >
            Open run
          </Link>
        ) : (
          <span className="shrink-0 text-[length:var(--fs-xs)] text-(--ui-muted)">
            Transcript unavailable
          </span>
        )}
      </div>
      {run.error ? (
        <p className="mt-2 whitespace-pre-wrap text-[length:var(--fs-sm)] leading-5 text-(--ui-danger)">
          {run.error}
        </p>
      ) : run.summary ? (
        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[length:var(--fs-sm)] leading-5 text-(--ui-muted)">
          {run.summary}
        </p>
      ) : null}
    </div>
  );
}
