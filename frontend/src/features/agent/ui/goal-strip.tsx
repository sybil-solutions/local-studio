"use client";

import { useState } from "react";
import { Pause, Play, Target, Trash2 } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { goalElapsedSeconds, goalIsTerminal, type SessionGoal } from "@shared/agent/session-goal";
import { cx } from "@/ui/utils";
import {
  GOAL_STATUS_COLOR,
  GOAL_STATUS_LABEL,
  formatGoalDuration,
  formatGoalTurn,
  goalBudgetTone,
  goalStatusPrefix,
} from "@/features/agent/ui/goal-presentation";

const stripActionClass =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--fg)/45 transition-colors hover:bg-(--hover) hover:text-(--fg)/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--fg)/25";

/** The one always-mounted surface for a goal.
 *
 * A goal is the session's standing intent, so its state has to be readable
 * without opening anything: the objective used to live only inside a collapsed
 * drawer, and the status label only inside the *expanded* drawer, which meant a
 * session could be pursuing, blocked or out of budget with nothing on screen
 * saying so. The strip shows state; the drawer card holds the controls. Exactly
 * one primary action lives here — the one the current status calls for — and
 * clicking anywhere else opens the card.
 *
 * It stays mounted for terminal statuses too. A finished goal that vanished
 * would be a status toast; one that stays until it is cleared is a goal. */
export function GoalStrip({
  goal,
  onTogglePause,
  onClear,
  onOpen,
}: {
  goal: SessionGoal;
  onTogglePause: () => void;
  onClear: () => void;
  onOpen: () => void;
}) {
  const terminal = goalIsTerminal(goal.status);
  const paused = goal.status === "paused";
  const prefix = goalStatusPrefix(goal.status);
  return (
    <div className="mx-auto mb-1 flex w-[calc(100%_-_26px)] max-w-[calc(var(--composer-w)*0.9_-_26px)] items-center gap-2 rounded-[var(--composer-radius-inner)] border border-(--border) bg-(--fg)/[0.022] px-2.5 py-1 text-[length:var(--fs-xs)] backdrop-blur-sm [corner-shape:superellipse(1.5)] sm:w-[calc(90%_-_26px)]">
      <button
        type="button"
        onClick={onOpen}
        title={goal.objective}
        aria-label={`${GOAL_STATUS_LABEL[goal.status]}: ${goal.objective}`}
        className="flex h-6 min-w-0 flex-1 items-center gap-2 text-left"
      >
        <Target
          className={cx("h-3.5 w-3.5 shrink-0", GOAL_STATUS_COLOR[goal.status])}
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-(--fg)/70">
          {prefix ? <span className="text-(--fg)/85">{prefix} · </span> : null}
          {goal.objective}
        </span>
        {/* One turn counter, shared with the card — two competing numbers a
            row apart ("Iteration 4" over "3/10 turns") read as two facts. */}
        <span
          className={cx(
            "shrink-0 tabular-nums",
            goal.turnBudget !== null
              ? goalBudgetTone(goal.turnsUsed, goal.turnBudget, goal.status === "budget_limited")
              : "text-(--fg)/34",
          )}
        >
          {formatGoalTurn(goal)}
        </span>
        <GoalElapsed goal={goal} />
      </button>
      {terminal ? (
        <button
          type="button"
          onClick={onClear}
          className={stripActionClass}
          aria-label="Clear goal"
          title="Clear goal"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onTogglePause}
          className={stripActionClass}
          aria-label={paused ? "Resume goal" : "Pause goal"}
          title={paused ? "Resume goal" : "Pause goal"}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}

/** The clock lives in its own component so its 1s tick re-renders one span, not
 *  the strip, and never anything upstream of it.
 *
 * It ticks only while a run is genuinely open — banked seconds plus the current
 * run, never wall time since the goal was created. A paused goal's clock is
 * frozen because a paused goal is not being worked on. */
function GoalElapsed({ goal }: { goal: SessionGoal }) {
  const ticking = goal.status === "active" && goal.activeRunStartedAt !== null;
  const [now, setNow] = useState(() => Date.now());
  useMountSubscription(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return (
    <span className="shrink-0 tabular-nums text-(--fg)/34">
      {formatGoalDuration(goalElapsedSeconds(goal, now))}
    </span>
  );
}
