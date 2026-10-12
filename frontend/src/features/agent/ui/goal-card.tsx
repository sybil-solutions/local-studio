"use client";

import { useId, useState } from "react";
import { FilePenLine, Pause, Play, RotateCcw, Save, Target, Trash2, X } from "@/ui/icon-registry";
import { goalIsTerminal, type SessionGoal } from "@shared/agent/session-goal";
import { cx } from "@/ui/utils";
import {
  GOAL_STATUS_COLOR,
  GOAL_STATUS_LABEL,
  formatGoalTurn,
  goalBudgetTone,
} from "@/features/agent/ui/goal-presentation";

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
        {formatGoalTurn(goal)}
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
  // Panes are forkable, so two drawers can be open at once — a hardcoded id
  // here made the label focus the other drawer's input.
  const budgetInputId = useId();
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
        <label className="flex items-center gap-1.5 text-(--fg)/48" htmlFor={budgetInputId}>
          Turn budget
        </label>
        <input
          id={budgetInputId}
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
