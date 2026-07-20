"use client";

// Codex-style "Pursuing goal" bar above the composer: objective, elapsed
// time, and pause/resume/clear controls, backed by the runtime goal store.

import { useCallback, useState } from "react";
import { Pause, Play, X } from "@/ui/icon-registry";
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

  useMountSubscription(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchGoal(piSessionId);
        if (!cancelled) setGoal(next);
      } catch {
        // Transient; next poll retries.
      }
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

  return (
    <div
      data-testid="session-goal-bar"
      className="mx-auto mb-1.5 flex w-full max-w-[var(--composer-w)] items-center gap-2.5 rounded-2xl bg-(--fg)/[0.03] px-4 py-2.5 text-[length:var(--fs-base)]"
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          goal.status === "active"
            ? "bg-(--ok,--accent)"
            : goal.status === "blocked"
              ? "bg-(--err)"
              : "bg-(--hl3)"
        }`}
      />
      <span className="shrink-0 text-(--fg)/85">{STATUS_LABEL[goal.status]}</span>
      <span className="min-w-0 flex-1 truncate text-(--fg)/45" title={goal.objective}>
        {goal.objective}
      </span>
      <span className="shrink-0 font-mono text-[length:var(--fs-sm)] tabular-nums text-(--fg)/45">
        {formatElapsed(goal.createdAt)}
        {goal.turnBudget ? ` · ${goal.turnsUsed}/${goal.turnBudget} turns` : ""}
      </span>
      {!terminal ? (
        <button
          type="button"
          onClick={() => void mutate({ status: paused ? "active" : "paused" })}
          className="shrink-0 rounded-full p-1 text-(--fg)/60 transition-colors hover:bg-(--hover) hover:text-(--fg)"
          aria-label={paused ? "Resume goal" : "Pause goal"}
          title={paused ? "Resume goal" : "Pause goal"}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void mutate(null)}
        className="shrink-0 rounded-full p-1 text-(--fg)/60 transition-colors hover:bg-(--hover) hover:text-(--fg)"
        aria-label="Clear goal"
        title="Clear goal"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
