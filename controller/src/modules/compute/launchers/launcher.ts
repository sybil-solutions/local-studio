import { Effect } from "effect";
import { closeSync, openSync, readSync, statSync } from "node:fs";
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
  readonly alive: (reference: HandleReference) => Effect.Effect<boolean>;
  readonly owns: (reference: HandleReference, record: InstanceRecord) => Effect.Effect<boolean>;
  /** TERM, wait up to graceMs, then KILL. Idempotent; a dead handle is a success. */
  readonly stop: (reference: HandleReference, graceMs: number) => Effect.Effect<void>;
  readonly logTail: (reference: HandleReference, record: InstanceRecord) => Effect.Effect<string>;
}

/** Uniform tail length for every failure path — the old code truncated the same crash to
 *  200 chars on one path and 20 lines on another. */
export const LOG_TAIL_BYTES = 4_096;

export const readLogTail = (path: string, bytes = LOG_TAIL_BYTES): string => {
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - bytes);
    const length = size - start;
    if (length <= 0) return "";
    const buffer = Buffer.alloc(length);
    const descriptor = openSync(path, "r");
    try {
      readSync(descriptor, buffer, 0, length, start);
    } finally {
      closeSync(descriptor);
    }
    return buffer.toString("utf8");
  } catch {
    return "";
  }
};

export const spawnFailed = (detail: string): Effect.Effect<never, LaunchFailure> =>
  Effect.fail<LaunchFailure>({ kind: "spawn-failed", detail });
