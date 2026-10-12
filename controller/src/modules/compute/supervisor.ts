import { Effect, Schedule } from "effect";
import type { ComputeService } from "./lifecycle";

/**
 * One loop per node, and the only thing in the system that reaps. Each pass asks
 * `superviseOnce` to drop records whose handle is gone — which frees their devices by
 * construction. There is no liveness fiber mutating shared state, no serial counter to
 * race, and nothing to release: deleting the record *is* the release.
 */

const SUPERVISE_INTERVAL_MS = 2_000;

export const startComputeSupervisor = (
  compute: ComputeService,
  onError: (error: unknown) => void,
): Effect.Effect<never> =>
  compute
    .superviseOnce()
    .pipe(
      Effect.asVoid,
      Effect.catchCause((cause) => Effect.sync(() => onError(cause))),
      Effect.repeat(Schedule.spaced(SUPERVISE_INTERVAL_MS)),
      Effect.andThen(Effect.never),
    );
