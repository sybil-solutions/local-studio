// Node-runtime half of instrumentation.ts. Lives in its own module (loaded
// dynamically behind the NEXT_RUNTIME gate) so the edge-runtime compile of
// instrumentation.ts never sees the `node:net` import.
import { Effect } from "effect";

export function register(): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const net = yield* Effect.tryPromise({
        try: () => import("node:net"),
        catch: (error) => error,
      });
      const setTimeoutFn = (
        net as unknown as {
          setDefaultAutoSelectFamilyAttemptTimeout?: (value: number) => void;
        }
      ).setDefaultAutoSelectFamilyAttemptTimeout;
      if (typeof setTimeoutFn !== "function") return;
      const configured = Number(process.env.LOCAL_STUDIO_AUTOSELECT_FAMILY_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 2000;
      setTimeoutFn(Math.max(timeoutMs, 250));
    }),
  );
}
