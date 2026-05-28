import type { AppContext } from "../types/context";

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

export async function observeControllerFunction<T>(
  context: AppContext,
  functionName: string,
  call: () => T | Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await call();
    context.stores.controllerRequestStore.recordFunctionCall({
      function_name: functionName,
      duration_ms: elapsedMs(start),
      success: true,
    });
    return result;
  } catch (error) {
    context.stores.controllerRequestStore.recordFunctionCall({
      function_name: functionName,
      duration_ms: elapsedMs(start),
      success: false,
      error_class: errorClass(error),
      error_message: errorMessage(error),
    });
    throw error;
  }
}
