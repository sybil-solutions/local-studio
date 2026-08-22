/** Everything the session has spent, for the whole of its life.
 *
 *  This is deliberately NOT the context window. Context resets on every
 *  compaction; spend does not. A session that has compacted four times still
 *  cost what it cost, and that total is the number worth showing. */
export type SessionUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  /** Total cost in USD when the provider reports one; 0 for local models. */
  cost: number;
  /** Assistant round-trips, i.e. how many times a model was actually called. */
  calls: number;
  /** Successful compactions, each one a point where the context was discarded. */
  compactions: number;
};
