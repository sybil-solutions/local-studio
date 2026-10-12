import { Schema } from "effect";

export const GOAL_STATUSES = ["active", "paused", "blocked", "complete", "budget_limited"] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GoalStatusSchema = Schema.Literals(GOAL_STATUSES);

export const SessionGoalSchema = Schema.Struct({
  version: Schema.Literal(1),
  objective: Schema.String,
  status: GoalStatusSchema,
  turnBudget: Schema.NullOr(Schema.Number),
  turnsUsed: Schema.Number,
  // Pursuit time, not wall time. `createdAt` keeps running while the goal is
  // paused, while the user is asleep, and while the session is detached, so it
  // cannot answer "how long has this goal been worked on". The driver banks a
  // finished run's duration into `timeUsedSeconds` and parks the current run's
  // start in `activeRunStartedAt`; elapsed is the sum of the two, and only
  // while a run is actually open. Both survive reload because they are stored,
  // which is what makes the clock monotonic across remounts.
  timeUsedSeconds: Schema.Number,
  activeRunStartedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type SessionGoal = Schema.Schema.Type<typeof SessionGoalSchema>;

export const SessionGoalResponseSchema = Schema.Struct({
  goal: Schema.NullOr(SessionGoalSchema),
});

export type SessionGoalPatch = {
  objective?: string;
  status?: GoalStatus;
  turnBudget?: number | null;
  /** Start the pursuit over: turns, banked time and `createdAt` all reset.
   *  Every path that sets a NEW objective must send this, or the card keeps
   *  reporting the previous objective's turn count and age. */
  resetTurns?: boolean;
};

/** Statuses the goal can no longer leave on its own. The UI has to offer a way
 *  out of each of them or the goal is stuck until it is deleted. */
export function goalIsTerminal(status: GoalStatus): boolean {
  return status === "complete" || status === "blocked" || status === "budget_limited";
}

/** Seconds of pursuit to show right now: banked time plus the open run.
 *  `now` is a parameter so the caller's ticker owns the clock. */
export function goalElapsedSeconds(goal: SessionGoal, now: number): number {
  const openRunStart = goal.activeRunStartedAt ? Date.parse(goal.activeRunStartedAt) : NaN;
  const openRunSeconds = Number.isFinite(openRunStart) ? Math.max(0, (now - openRunStart) / 1000) : 0;
  return Math.max(0, goal.timeUsedSeconds) + openRunSeconds;
}
