import { Effect } from "effect";
import { safeJson } from "@/features/agent/safe-json";
import type { AggregatedSession } from "@shared/agent/session-summary";

export function loadAggregatedSessions(): Promise<AggregatedSession[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => fetch("/api/agent/sessions/all?since=30d", { cache: "no-store" }),
        catch: (error) => error,
      });
      const payload = yield* Effect.tryPromise({
        try: () => safeJson<{ sessions?: AggregatedSession[] }>(response),
        catch: (error) => error,
      });
      return payload.sessions ?? [];
    }).pipe(Effect.catch(() => Effect.succeed([]))),
  );
}
