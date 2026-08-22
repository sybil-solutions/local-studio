"use client";

import { useState } from "react";
import { FilePenLine, Pause, Play, RotateCcw, Save, Target, Trash2, X } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  goalElapsedSeconds,
  goalIsTerminal,
  type GoalStatus,
  type SessionGoal,
} from "@shared/agent/session-goal";
import { cx } from "@/ui/utils";

/** Spelled-out status. The strip carries status as colour plus an icon and uses
 *  this for its accessible name; the drawer card shows it as text. */
const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Pursuing goal",
  paused: "Goal paused",
  blocked: "Goal blocked",
  complete: "Goal complete",
  budget_limited: "Goal out of budget",
};

/** Colour token for a status. Every one of these has a baseline in the bare
 *  `:root` block of tokens.css, so they resolve on all themes. */
const GOAL_STATUS_COLOR: Record<GoalStatus, string> = {
  active: "text-(--accent)",
  paused: "text-(--fg)/34",
  blocked: "text-(--err)",
  complete: "text-(--ok)",
  budget_limited: "text-(--warn)",
};

/** Blocked and out-of-budget both demand a decision from the user, so the strip
 *  spells them out inline instead of trusting the icon colour alone. */
function goalStatusPrefix(status: GoalStatus): string {
  if (status === "blocked") return "Blocked";
  if (status === "budget_limited") return "Out of budget";
  return "";
}

/** Coarse-to-fine duration. The old minutes-only format read "0m" for the whole
 *  first minute of every goal, which is exactly when someone is watching. */
function formatGoalDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Budget colour: warn on the last turn, error once it is spent. */
function goalBudgetTone(turnsUsed: number, turnBudget: number, spent: boolean): string {
  if (spent) return "text-(--err)";
  return turnsUsed >= turnBudget - 1 ? "text-(--warn)" : "text-(--fg)/40";
}

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
  // Turn N is in flight while the goal is active; once it settles, N is done.
  const iteration = goal.status === "active" ? goal.turnsUsed + 1 : Math.max(1, goal.turnsUsed);
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
        <span className="hidden shrink-0 tabular-nums text-(--fg)/34 sm:inline">
          Iteration {iteration}
        </span>
        {goal.turnBudget !== null ? (
          <span
            className={cx(
              "shrink-0 tabular-nums",
              goalBudgetTone(goal.turnsUsed, goal.turnBudget, goal.status === "budget_limited"),
            )}
          >
            {goal.turnsUsed}/{goal.turnBudget}
          </span>
        ) : null}
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

const iconButtonClass =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--fg)/42 transition-colors hover:bg-(--hover) hover:text-(--fg)/82 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--fg)/25";

export type GoalDraft = { objective: string; turnBudget: number | null; resetProgress: boolean };

/** The control surface for a goal, inside the composer drawer. The strip above
 *  reports state; everything that CHANGES a goal lives here — set, edit,
 *  budget, pause/resume, restart, clear — so no fact is edited in two places.
 *
 * Every status is escapable from this card. A complete, blocked or
 * out-of-budget goal used to hide its pause/resume control, leaving deletion as
 * the only way out, and an edit made from here wrote the objective without
 * touching the status, so a re-aimed goal kept reading "Goal complete" while
 * silently steering nothing. Editing reactivates; terminal statuses get an
 * explicit Restart. */
export function GoalCard({
  goal,
  running,
  error,
  onSubmit,
  onTogglePause,
  onRestart,
  onClear,
}: {
  goal: SessionGoal | null;
  running: boolean;
  error: string | null;
  onSubmit: (draft: GoalDraft) => void;
  onTogglePause: () => void;
  onRestart: () => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [budgetDraft, setBudgetDraft] = useState("");

  const startEditing = () => {
    setDraft(goal?.objective ?? "");
    setBudgetDraft(goal?.turnBudget === null || goal === null ? "" : String(goal.turnBudget));
    setEditing(true);
  };

  const submit = () => {
    const objective = draft.trim();
    if (!objective) return;
    const parsed = Number.parseInt(budgetDraft.trim(), 10);
    onSubmit({
      objective,
      turnBudget: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
      // Turns and the clock measure progress toward ONE objective. Re-aiming
      // the goal starts that measurement over; changing only the budget does not.
      resetProgress: objective !== (goal?.objective ?? ""),
    });
    setEditing(false);
  };

  if (!goal && !editing) {
    return (
      <>
        <button
          type="button"
          onClick={startEditing}
          disabled={running}
          title={running ? "Set a goal after the current task finishes." : "Set a session goal"}
          className="flex h-8 w-full items-center gap-2 rounded-[10px] px-2 text-left text-(--fg)/56 transition-colors hover:bg-(--hover) hover:text-(--fg)/82 disabled:pointer-events-none disabled:opacity-40"
        >
          <Target className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Set a goal…
        </button>
        {error ? <div className="px-2 pb-1 text-(--err)">{error}</div> : null}
      </>
    );
  }

  return (
    <div className="rounded-[14px] bg-(--fg)/[0.03] px-2.5 py-2">
      {goal ? (
        <GoalCardHeader
          goal={goal}
          onStartEditing={startEditing}
          onTogglePause={onTogglePause}
          onRestart={onRestart}
          onClear={onClear}
        />
      ) : null}
      {editing ? (
        <GoalEditor
          draft={draft}
          budgetDraft={budgetDraft}
          onDraftChange={setDraft}
          onBudgetChange={setBudgetDraft}
          onCancel={() => setEditing(false)}
          onSave={submit}
        />
      ) : null}
      {error ? <div className="pt-1.5 text-(--err)">{error}</div> : null}
    </div>
  );
}

function GoalCardHeader({
  goal,
  onStartEditing,
  onTogglePause,
  onRestart,
  onClear,
}: {
  goal: SessionGoal;
  onStartEditing: () => void;
  onTogglePause: () => void;
  onRestart: () => void;
  onClear: () => void;
}) {
  const terminal = goalIsTerminal(goal.status);
  const paused = goal.status === "paused";
  return (
    <div className="flex items-center gap-2">
      <Target
        className={cx("h-4 w-4 shrink-0", GOAL_STATUS_COLOR[goal.status])}
        strokeWidth={1.75}
      />
      <span className="shrink-0 font-medium text-(--fg)/82">{GOAL_STATUS_LABEL[goal.status]}</span>
      <span className="min-w-0 flex-1 truncate text-(--fg)/48" title={goal.objective}>
        {goal.objective}
      </span>
      <span
        className={cx(
          "shrink-0 tabular-nums",
          goal.turnBudget === null
            ? "text-(--fg)/40"
            : goalBudgetTone(goal.turnsUsed, goal.turnBudget, goal.status === "budget_limited"),
        )}
      >
        {goal.turnsUsed}
        {goal.turnBudget === null ? "" : `/${goal.turnBudget}`} turns
      </span>
      <button
        type="button"
        onClick={onStartEditing}
        className={iconButtonClass}
        aria-label="Edit goal"
        title="Edit objective or turn budget"
      >
        <FilePenLine className="h-3.5 w-3.5" />
      </button>
      {terminal ? (
        <button
          type="button"
          onClick={onRestart}
          className={iconButtonClass}
          aria-label="Restart goal"
          title="Restart goal"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onTogglePause}
          className={iconButtonClass}
          aria-label={paused ? "Resume goal" : "Pause goal"}
          title={paused ? "Resume goal" : "Pause goal"}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
      )}
      <button
        type="button"
        onClick={onClear}
        className={iconButtonClass}
        aria-label="Clear goal"
        title="Clear goal"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function GoalEditor({
  draft,
  budgetDraft,
  onDraftChange,
  onBudgetChange,
  onCancel,
  onSave,
}: {
  draft: string;
  budgetDraft: string;
  onDraftChange: (value: string) => void;
  onBudgetChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="pt-1.5">
      <textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSave();
          }
        }}
        rows={2}
        autoFocus
        placeholder="Describe the objective — measurable outcomes work best"
        className="max-h-28 min-h-14 w-full resize-none rounded-xl border border-(--border) bg-transparent px-2.5 py-2 leading-relaxed text-(--fg)/72 outline-none placeholder:text-(--fg)/30"
        aria-label="Goal objective"
      />
      <div className="flex items-center gap-2 pt-1">
        <label className="flex items-center gap-1.5 text-(--fg)/48" htmlFor="goal-turn-budget">
          Turn budget
        </label>
        <input
          id="goal-turn-budget"
          type="number"
          min={1}
          value={budgetDraft}
          onChange={(event) => onBudgetChange(event.target.value)}
          placeholder="none"
          className="h-7 w-20 rounded-md bg-(--fg)/[0.04] px-2 tabular-nums text-(--fg) outline-none placeholder:text-(--fg)/30 focus:bg-(--fg)/[0.06]"
        />
        <span className="min-w-0 flex-1 truncate text-(--fg)/34">
          Auto-continues stop once spent
        </span>
        <button
          type="button"
          onClick={onCancel}
          className={iconButtonClass}
          aria-label="Cancel editing goal"
          title="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!draft.trim()}
          className={`${iconButtonClass} bg-(--fg)/90 text-(--bg) hover:bg-(--fg) hover:text-(--bg) disabled:opacity-35`}
          aria-label="Save goal"
          title="Save goal"
        >
          <Save className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
