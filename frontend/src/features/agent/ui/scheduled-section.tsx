"use client";

import { Effect } from "effect";
import Link from "next/link";
import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { Clock, Pause, Play, Plus } from "@/ui/icon-registry";
import { Spinner } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { Automation } from "@shared/agent/automation";
import {
  listAutomations,
  runAutomation,
  updateAutomation,
} from "@/features/agent/automations/automation-api";
import { scheduleLabel } from "@/features/agent/automations/automation-model";

export function ScheduledSection() {
  const pathname = usePathname();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    void Effect.runPromise(listAutomations())
      .then(setAutomations)
      .catch(() => undefined);
  }, []);

  useMountSubscription(() => {
    reload();
    const timer = window.setInterval(reload, 30_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const perform = useCallback(
    async (id: string, effect: Effect.Effect<unknown, Error>) => {
      setPendingId(id);
      try {
        await Effect.runPromise(effect);
        reload();
      } finally {
        setPendingId(null);
      }
    },
    [reload],
  );

  const pageActive = pathname.startsWith("/agent/automations");

  return (
    <div className="flex shrink-0 flex-col pt-3">
      <div
        className={`group flex h-[var(--sidebar-row-height)] items-center rounded-[var(--sidebar-row-radius)] ${
          pageActive ? "bg-(--active)" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-full w-6 shrink-0 items-center justify-center text-(--hl2) hover:text-(--fg)"
          aria-label={expanded ? "Collapse automations" : "Expand automations"}
          aria-expanded={expanded}
        >
          <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <Link
          href="/agent/automations"
          prefetch={false}
          className="flex h-full min-w-0 flex-1 items-center text-[length:var(--fs-sm)] font-normal text-(--hl2) hover:text-(--fg)"
        >
          <span className="truncate">Automations</span>
          {automations.length > 0 ? (
            <span className="ml-1.5 text-[length:var(--fs-xs)] tabular-nums text-(--hl2)/70">
              {automations.length}
            </span>
          ) : null}
        </Link>
        <Link
          href="/agent/automations?new=1"
          prefetch={false}
          className="mr-1 flex h-6 w-6 items-center justify-center rounded-md text-(--dim)/75 transition-colors hover:bg-(--hover) hover:text-(--fg)"
          title="New automation"
          aria-label="New automation"
        >
          <Plus className="h-3.5 w-3.5" />
        </Link>
      </div>

      {expanded
        ? automations.map((automation) => (
            <div
              key={automation.id}
              className="group relative flex h-[var(--sidebar-row-height)] items-center rounded-[var(--sidebar-row-radius)] pl-2 pr-1.5 text-(--fg) transition-colors hover:bg-(--hover)"
            >
              <Link
                href={`/agent/automations?automation=${encodeURIComponent(automation.id)}`}
                prefetch={false}
                title={`${automation.name} · ${scheduleLabel(automation.schedule)}`}
                className="flex min-w-0 flex-1 items-center gap-2 pr-14 text-left"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    automation.status === "paused"
                      ? "bg-(--dim)/45"
                      : automation.lastRun?.outcome === "error"
                        ? "bg-(--err)"
                        : "bg-(--link)"
                  }`}
                />
                <span
                  className={`truncate text-[length:var(--fs-md)] font-normal ${
                    automation.status === "paused" ? "text-(--dim)" : ""
                  }`}
                >
                  {automation.name}
                </span>
                {automation.unread ? (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--link)" />
                ) : null}
              </Link>
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  disabled={pendingId === automation.id}
                  onClick={() => void perform(automation.id, runAutomation(automation.id))}
                  className="flex h-5 w-5 items-center justify-center text-(--dim)/65 hover:text-(--fg) disabled:opacity-50"
                  title="Run now"
                  aria-label={`Run ${automation.name} now`}
                >
                  {pendingId === automation.id ? (
                    <Spinner size="xs" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </button>
                <button
                  type="button"
                  disabled={pendingId === automation.id}
                  onClick={() =>
                    void perform(
                      automation.id,
                      updateAutomation(automation.id, {
                        status: automation.status === "paused" ? "active" : "paused",
                      }),
                    )
                  }
                  className="flex h-5 w-5 items-center justify-center text-(--dim)/65 hover:text-(--fg) disabled:opacity-50"
                  title={automation.status === "paused" ? "Resume" : "Pause"}
                  aria-label={`${automation.status === "paused" ? "Resume" : "Pause"} ${automation.name}`}
                >
                  {automation.status === "paused" ? (
                    <Play className="h-3 w-3" />
                  ) : (
                    <Pause className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          ))
        : null}
    </div>
  );
}
