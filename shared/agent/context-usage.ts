// Canonical context-usage shape shared by the agent runtime package and the
// frontend's runtime-schema (whose Effect schema must stay in sync with this
// type — see frontend/src/features/agent/runtime/runtime-schema.ts).
export type RuntimeContextUsage = {
  readonly tokens: number | null;
  readonly contextWindow: number;
  readonly percent: number | null;
  readonly shouldCompact: boolean;
};
