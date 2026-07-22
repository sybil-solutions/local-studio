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
  resetTurns?: boolean;
};
