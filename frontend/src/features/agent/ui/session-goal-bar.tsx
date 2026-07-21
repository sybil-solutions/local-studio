"use client";

import { useCallback, useState } from "react";
import { ChevronDown, CircleDot, Pause, Play, Trash2 } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type GoalStatus = "active" | "paused" | "blocked" | "complete" | "budget_limited";

type SessionGoal = {
  objective: string;
  status: GoalStatus;
  turnBudget: number | null;
  turnsUsed: number;
  createdAt: string;
};

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Pursuing goal",
  paused: "Goal paused",
  blocked: "Goal blocked",
  complete: "Goal complete",
  budget_limited: "Goal out of budget",
};

function formatElapsed(sinceIso: string): string {
  const elapsedMs = Date.now() - new Date(sinceIso).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "";
  const minutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

async function fetchGoal(piSessionId: string): Promise<SessionGoal | null> {
  const response = await fetch(`/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`, {
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { goal?: SessionGoal | null };
  return payload.goal ?? null;
}

export function SessionGoalBar({
  piSessionId,
  revision,
}: {
  piSessionId: string;
  revision: number;
}) {
  const [goal, setGoal] = useState<SessionGoal | null>(null);
  const [expanded, setExpanded] = useState(false);

  useMountSubscription(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchGoal(piSessionId);
        if (!cancelled) setGoal(next);
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [piSessionId, revision]);

  const mutate = useCallback(
    async (body: Record<string, unknown> | null) => {
      const url = `/api/agent/goal?piSessionId=${encodeURIComponent(piSessionId)}`;
      if (body === null) {
        await fetch(url, { method: "DELETE" }).catch(() => undefined);
        setGoal(null);
        return;
      }
      await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => undefined);
      setGoal((current) => (current ? { ...current, ...(body as Partial<SessionGoal>) } : current));
    },
    [piSessionId],
  );

  if (!goal) return null;
  const paused = goal.status === "paused";
  const terminal = goal.status === "complete" || goal.status === "blocked";
  const detailId = `session-goal-detail-${piSessionId}`;

  return (
    <section
      data-testid="session-goal-bar"
      className="mx-auto mb-2 w-full max-w-[var(--composer-w)] overflow-hidden rounded-[24px] border border-(--border) bg-(--fg)/[0.025] text-[length:var(--fs-sm)] shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
    >
      <div className="flex min-h-12 items-center gap-2 px-3.5 py-2">
        <CircleDot
          className={`h-4 w-4 shrink-0 ${
            goal.status === "active"
              ? "text-(--ok,--accent)"
              : goal.status === "blocked"
                ? "text-(--err)"
                : "text-(--hl3)"
          }`}
        />
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
          aria-controls={detailId}
        >
          <span className="shrink-0 font-medium text-(--fg)/88">{STATUS_LABEL[goal.status]}</span>
          {!expanded ? (
            <span className="min-w-0 truncate text-(--fg)/48" title={goal.objective}>
              {goal.objective}
            </span>
          ) : null}
        </button>
        <span className="shrink-0 font-mono text-[length:var(--fs-sm)] tabular-nums text-(--fg)/48">
          {formatElapsed(goal.createdAt)}
          {goal.turnBudget ? ` · ${goal.turnsUsed}/${goal.turnBudget}` : ""}
        </span>
        {!terminal ? (
          <button
            type="button"
            onClick={() => void mutate({ status: paused ? "active" : "paused" })}
            className="shrink-0 rounded-full p-1.5 text-(--fg)/55 transition-colors hover:bg-(--hover) hover:text-(--fg)"
            aria-label={paused ? "Resume goal" : "Pause goal"}
            title={paused ? "Resume goal" : "Pause goal"}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void mutate(null)}
          className="shrink-0 rounded-full p-1.5 text-(--fg)/55 transition-colors hover:bg-(--hover) hover:text-(--fg)"
          aria-label="Clear goal"
          title="Clear goal"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="shrink-0 rounded-full p-1.5 text-(--fg)/55 transition-colors hover:bg-(--hover) hover:text-(--fg)"
          aria-label={expanded ? "Collapse goal" : "Expand goal"}
          title={expanded ? "Collapse goal" : "Expand goal"}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {expanded ? (
        <p
          id={detailId}
          className="border-t border-(--border)/75 px-4 py-3 text-[length:var(--fs-base)] leading-relaxed text-(--fg)/62"
        >
          {goal.objective}
        </p>
      ) : null}
    </section>
  );
}
