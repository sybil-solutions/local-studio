import { Effect, Schema } from "effect";

export class EngineOperationError extends Schema.TaggedErrorClass<EngineOperationError>()(
  "EngineOperationError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export const operationError = (operation: string, cause: unknown): EngineOperationError =>
  new EngineOperationError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });

export const attempt = <A>(
  operation: string,
  evaluate: () => A,
): Effect.Effect<A, EngineOperationError> =>
  Effect.try({
    try: evaluate,
    catch: (cause) => operationError(operation, cause),
  });
