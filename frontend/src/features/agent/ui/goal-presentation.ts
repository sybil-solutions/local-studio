import type { GoalStatus, SessionGoal } from "@shared/agent/session-goal";

/** Spelled-out status. The strip carries status as colour plus an icon and uses
 *  this for its accessible name; the drawer card shows it as text. */
export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Pursuing goal",
  paused: "Goal paused",
  blocked: "Goal blocked",
  complete: "Goal complete",
  budget_limited: "Goal out of budget",
};

/** Colour token for a status. Every one of these has a baseline in the bare
 *  `:root` block of tokens.css, so they resolve on all themes. */
export const GOAL_STATUS_COLOR: Record<GoalStatus, string> = {
  active: "text-(--accent)",
  paused: "text-(--fg)/34",
  blocked: "text-(--err)",
  complete: "text-(--ok)",
  budget_limited: "text-(--warn)",
};

/** Blocked and out-of-budget both demand a decision from the user, so the strip
 *  spells them out inline instead of trusting the icon colour alone. */
export function goalStatusPrefix(status: GoalStatus): string {
  if (status === "blocked") return "Blocked";
  if (status === "budget_limited") return "Out of budget";
  return "";
}

/** Coarse-to-fine duration. The old minutes-only format read "0m" for the whole
 *  first minute of every goal, which is exactly when someone is watching. */
export function formatGoalDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Budget colour: warn on the last turn, error once it is spent. */
export function goalBudgetTone(turnsUsed: number, turnBudget: number, spent: boolean): string {
  if (spent) return "text-(--err)";
  return turnsUsed >= turnBudget - 1 ? "text-(--warn)" : "text-(--fg)/40";
}

/** Turn N is in flight while the goal is active; once it settles, N is done. */
export function goalIteration(goal: SessionGoal): number {
  return goal.status === "active" ? goal.turnsUsed + 1 : Math.max(1, goal.turnsUsed);
}

/** The one turn counter, shared by the strip and the card. They used to derive
 *  their own — "Iteration 4" a row above "3/10 turns" — which read as two
 *  different facts about the same goal. */
export function formatGoalTurn(goal: SessionGoal): string {
  const iteration = goalIteration(goal);
  return goal.turnBudget === null ? `Turn ${iteration}` : `Turn ${iteration}/${goal.turnBudget}`;
}
