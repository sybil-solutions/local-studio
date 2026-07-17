import { Effect } from "effect";
import type { EngineJob } from "@/lib/types";
import { isTerminalEngineJob } from "@/features/settings/runtime-targets";
import api from "@/lib/api/client";

// Server-side installs can legitimately run for ~30 minutes; poll fast at
// first, then back off, and only give up well past the server install timeout.
const RUNTIME_JOB_POLL_CEILING_MS = 35 * 60_000;
const RUNTIME_JOB_FAST_POLL_WINDOW_MS = 60_000;
const RUNTIME_JOB_FAST_POLL_MS = 1_000;
const RUNTIME_JOB_SLOW_POLL_MS = 3_000;

export const CONTROLLER_UNREACHABLE_MESSAGE =
  "The controller is unreachable, so setup cannot start. Start it with " +
  "`cd controller && bun run start` and reload this page.";

export const requestEffect = <T>(load: () => Promise<T>): Effect.Effect<T, unknown> =>
  Effect.tryPromise({ try: load, catch: (error) => error });

export function finishRuntimeJobEffect(
  jobId: string,
  setRuntimeJobs: (updater: (current: EngineJob[]) => EngineJob[]) => void,
): Effect.Effect<EngineJob, unknown> {
  return Effect.gen(function* () {
    const startedAt = Date.now();
    let job = yield* fetchRuntimeJobEffect(jobId);
    while (!isTerminalEngineJob(job)) {
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= RUNTIME_JOB_POLL_CEILING_MS) {
        return yield* Effect.fail(
          new Error(
            `The ${job.backend} ${job.type} is still running on the controller after ` +
              `${Math.round(RUNTIME_JOB_POLL_CEILING_MS / 60_000)} minutes. It keeps running ` +
              "server-side — watch it under Settings → Engines or in the controller logs, then " +
              "reload this page once it finishes.",
          ),
        );
      }
      const intervalMs =
        elapsedMs < RUNTIME_JOB_FAST_POLL_WINDOW_MS
          ? RUNTIME_JOB_FAST_POLL_MS
          : RUNTIME_JOB_SLOW_POLL_MS;
      yield* Effect.sleep(intervalMs);
      const next = yield* fetchRuntimeJobEffect(jobId);
      job = next;
      setRuntimeJobs((current) => [
        next,
        ...current.filter((candidate) => candidate.id !== next.id),
      ]);
    }
    return job;
  });
}

function fetchRuntimeJobEffect(jobId: string): Effect.Effect<EngineJob, unknown> {
  return requestEffect(() => api.getRuntimeJob(jobId)).pipe(
    Effect.map((payload) => payload.job),
    Effect.catch((err) => {
      if (isMissingRuntimeJobError(err)) {
        return Effect.fail(
          new Error("The controller restarted and lost this install job. Re-run the install."),
        );
      }
      return Effect.fail(err);
    }),
  );
}

function isMissingRuntimeJobError(err: unknown): boolean {
  return err instanceof Error && (err as Error & { status?: number }).status === 404;
}

export function withSetupTimeoutEffect<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 8_000,
): Effect.Effect<T, Error> {
  return requestEffect(() => promise).pipe(
    Effect.timeout(timeoutMs),
    Effect.catch(() => Effect.fail(new Error(`${label} timed out`))),
  );
}

export function formatLoadWarning(warnings: string[]): string | null {
  return warnings.length ? `Some setup data could not load: ${warnings.join("; ")}` : null;
}

export function setupErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "unavailable";
}
