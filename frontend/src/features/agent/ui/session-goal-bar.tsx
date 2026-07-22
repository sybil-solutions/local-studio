"use client";

import { useCallback, useState } from "react";
import { ChevronDown, FilePenLine, Pause, Play, Save, Target, Trash2, X } from "@/ui/icon-registry";
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

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
        setEditing(false);
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
  const terminal =
    goal.status === "complete" || goal.status === "blocked" || goal.status === "budget_limited";
  const detailId = `session-goal-detail-${piSessionId}`;
  const iconButtonClass =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-(--fg)/42 transition-colors hover:bg-(--hover) hover:text-(--fg)/82 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--fg)/25";

  const startEditing = () => {
    setDraft(goal.objective);
    setEditing(true);
    setExpanded(true);
  };

  const saveObjective = async () => {
    const objective = draft.trim();
    if (!objective) return;
    await mutate({ objective });
    setEditing(false);
  };

  return (
    <section
      data-testid="session-goal-bar"
      className="relative z-[90] mx-auto -mb-4 w-[calc(90%_-_26px)] max-w-[calc(var(--composer-w)*0.9_-_26px)] overflow-hidden rounded-[var(--composer-radius-inner)] border border-(--border)/80 bg-(--composer)/70 pb-4 text-[length:var(--fs-sm)] shadow-[var(--composer-elevation-inner)] backdrop-blur-sm [corner-shape:superellipse(1.5)]"
    >
      <div className="flex h-11 items-center gap-2 px-3">
        <Target
          className={`h-4 w-4 shrink-0 ${
            goal.status === "active"
              ? "text-(--fg)/56"
              : goal.status === "blocked"
                ? "text-(--err)"
                : "text-(--fg)/34"
          }`}
        />
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
          aria-expanded={expanded}
          aria-controls={detailId}
        >
          <span className="shrink-0 font-medium text-(--fg)/82">{STATUS_LABEL[goal.status]}</span>
          {!expanded ? (
            <span className="min-w-0 truncate text-(--fg)/40" title={goal.objective}>
              {goal.objective}
            </span>
          ) : null}
        </button>
        <span className="shrink-0 tabular-nums text-(--fg)/40">
          {formatElapsed(goal.createdAt)}
          {goal.turnBudget ? ` · ${goal.turnsUsed}/${goal.turnBudget}` : ""}
        </span>
        <button
          type="button"
          onClick={startEditing}
          className={iconButtonClass}
          aria-label="Edit goal"
          title="Edit goal"
        >
          <FilePenLine className="h-3.5 w-3.5" />
        </button>
        {!terminal ? (
          <button
            type="button"
            onClick={() => void mutate({ status: paused ? "active" : "paused" })}
            className={iconButtonClass}
            aria-label={paused ? "Resume goal" : "Pause goal"}
            title={paused ? "Resume goal" : "Pause goal"}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void mutate(null)}
          className={iconButtonClass}
          aria-label="Clear goal"
          title="Clear goal"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={iconButtonClass}
          aria-label={expanded ? "Collapse goal" : "Expand goal"}
          title={expanded ? "Collapse goal" : "Expand goal"}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {expanded ? (
        <div id={detailId} className="px-4 pb-4 pt-1">
          {editing ? (
            <div className="rounded-xl border border-(--border) bg-(--composer)/45 p-2.5">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setEditing(false);
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void saveObjective();
                  }
                }}
                rows={2}
                autoFocus
                className="max-h-28 min-h-14 w-full resize-none bg-transparent text-[length:var(--fs-base)] leading-relaxed text-(--fg)/72 outline-none placeholder:text-(--fg)/30"
                aria-label="Goal objective"
              />
              <div className="flex justify-end gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className={iconButtonClass}
                  aria-label="Cancel editing goal"
                  title="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void saveObjective()}
                  disabled={!draft.trim()}
                  className={`${iconButtonClass} bg-(--fg)/90 text-(--bg) hover:bg-(--fg) hover:text-(--bg) disabled:opacity-35`}
                  aria-label="Save goal"
                  title="Save goal"
                >
                  <Save className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <p className="max-w-[92%] text-[length:var(--fs-base)] leading-[1.55] text-(--fg)/48">
              {goal.objective}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
