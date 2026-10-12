import { Schema } from "effect";

export const AutomationScheduleSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("interval"),
    minutes: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("daily"),
    time: Schema.String,
    weekdaysOnly: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    day: Schema.Number,
    time: Schema.String,
  }),
]);

export const AutomationRunSchema = Schema.Struct({
  at: Schema.String,
  piSessionId: Schema.NullOr(Schema.String),
  cwd: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  outcome: Schema.Literals(["ok", "error"]),
  summary: Schema.String,
  error: Schema.optional(Schema.String),
});

export const AutomationSchema = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  modelId: Schema.String,
  cwd: Schema.String,
  /**
   * The pi session every run should continue, so the automation works inside a
   * thread the user already has instead of a blank one. Null (or absent, on
   * records written before this field existed) means each run starts fresh.
   */
  targetSessionId: Schema.optional(Schema.NullOr(Schema.String)),
  schedule: AutomationScheduleSchema,
  status: Schema.Literals(["active", "paused"]),
  nextRunAt: Schema.NullOr(Schema.String),
  lastRun: Schema.NullOr(AutomationRunSchema),
  runs: Schema.Array(AutomationRunSchema),
  unread: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const AutomationsResponseSchema = Schema.Struct({
  automations: Schema.Array(AutomationSchema),
});

export const AutomationResponseSchema = Schema.Struct({
  automation: AutomationSchema,
});

export type AutomationSchedule = typeof AutomationScheduleSchema.Type;
export type AutomationRun = typeof AutomationRunSchema.Type;
export type Automation = typeof AutomationSchema.Type;
