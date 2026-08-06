import { Effect } from "effect";
import type { HandleReference, InstanceRecord, LaunchFailure, LaunchPlan } from "../contracts";

/**
 * One interface, three implementations (process, docker, remote). A launcher executes a
 * `LaunchPlan` and answers questions about the handle it returned — it never reads or
 * writes instance records, and it never decides *whether* to act; that is lifecycle's job.
 *
 * `owns` is the single defence against acting on something that is not ours: pids get
 * recycled across reboots and container names can be recreated by hand, so every stop
 * and every log read goes through an ownership check first.
 */
export interface Launcher {
  readonly start: (
    plan: LaunchPlan,
    record: InstanceRecord,
  ) => Effect.Effect<HandleReference, LaunchFailure>;
  readonly alive: (reference: HandleReference, record: InstanceRecord) => Effect.Effect<boolean>;
  readonly owns: (reference: HandleReference, record: InstanceRecord) => Effect.Effect<boolean>;
  /** TERM, wait up to graceMs, then KILL. Idempotent; a dead handle is a success. */
  readonly stop: (
    reference: HandleReference,
    record: InstanceRecord,
    graceMs: number,
  ) => Effect.Effect<void>;
  readonly logTail: (reference: HandleReference, record: InstanceRecord) => Effect.Effect<string>;
}

/** Uniform tail length for every failure path — the old code truncated the same crash to
 *  200 chars on one path and 20 lines on another. */
export const LOG_TAIL_BYTES = 4_096;

export const spawnFailed = (detail: string): Effect.Effect<never, LaunchFailure> =>
  Effect.fail<LaunchFailure>({ kind: "spawn-failed", detail });
