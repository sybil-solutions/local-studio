import { Effect } from "effect";
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

export const observeControllerFunctionEffect = <T>(
  context: AppContext,
  functionName: string,
  call: () => T | Promise<T>,
): Effect.Effect<Awaited<T>, unknown> => {
  const start = performance.now();
  return Effect.tryPromise({
    try: () => Promise.resolve(call()),
    catch: (error) => error as unknown,
  }).pipe(
    Effect.tap(() =>
      Effect.sync(() =>
        context.stores.controllerRequestStore.recordFunctionCall({
          function_name: functionName,
          duration_ms: elapsedMs(start),
          success: true,
        }),
      ),
    ),
    Effect.tapError((error) =>
      Effect.sync(() =>
        context.stores.controllerRequestStore.recordFunctionCall({
          function_name: functionName,
          duration_ms: elapsedMs(start),
          success: false,
          error_class: errorClass(error),
          error_message: errorMessage(error),
        }),
      ),
    ),
  );
};

export async function observeControllerFunction<T>(
  context: AppContext,
  functionName: string,
  call: () => T | Promise<T>,
): Promise<T> {
  return Effect.runPromise(observeControllerFunctionEffect(context, functionName, call));
}
