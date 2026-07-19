import { Cause, Effect, Exit } from "effect";
import type { AppContext } from "../app-context";

function elapsedMs(start: number): number {
  return Math.round(performance.now() - start);
}

function errorClass(error: unknown): string {
  return (error as { name?: string } | null)?.name || "Error";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

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
): ReturnType<AppContext["processManager"]["findInferenceProcess"]> =>
  observeControllerFunction(context, `${label}.findInferenceProcess`, () =>
    context.processManager.findInferenceProcess(context.config.inference_port),
  );
