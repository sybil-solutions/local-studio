import { Cause, Effect, Exit } from "effect";
import type { AppContext } from "../app-context";

/** Whole milliseconds since a `performance.now()` mark. */
export const elapsedMs = (start: number): number => Math.round(performance.now() - start);

/** The telemetry label for a thrown value: its constructor name, or "Error". */
export const errorClass = (error: unknown): string =>
  (error as { name?: string } | null)?.name || "Error";

/** The telemetry detail for a thrown value. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const observeControllerFunction = <A, E, R>(
  context: AppContext,
  functionName: string,
  call: () => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  const start = performance.now();
  return Effect.suspend(call).pipe(
    Effect.onExit((exit) => {
      if (Exit.isSuccess(exit)) {
        return context.stores.controllerRequestStore
          .recordFunctionCallEffect({
            function_name: functionName,
            duration_ms: elapsedMs(start),
            success: true,
          })
          .pipe(Effect.ignore);
      }
      const error = Cause.prettyErrors(exit.cause)[0] ?? Cause.pretty(exit.cause);
      return context.stores.controllerRequestStore
        .recordFunctionCallEffect({
          function_name: functionName,
          duration_ms: elapsedMs(start),
          success: false,
          error_class: errorClass(error),
          error_message: errorMessage(error),
        })
        .pipe(Effect.ignore);
    }),
  );
};

export const findObservedInferenceProcess = (
  context: AppContext,
  label: string,
): ReturnType<AppContext["bridge"]["findInferenceProcess"]> =>
  observeControllerFunction(context, `${label}.findInferenceProcess`, () =>
    context.bridge.findInferenceProcess(),
  );
