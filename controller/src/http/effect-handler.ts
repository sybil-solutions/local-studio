import type { Context, Handler, TypedResponse } from "hono";
import type { Effect } from "effect";
import type { AppContextService } from "../app-context";
import type { ControllerRuntime } from "../core/effect-runtime";

export type ControllerEffect<A, E = never> = Effect.Effect<A, E, AppContextService>;

export const effectHandler = (
  runtime: ControllerRuntime,
  handler: (
    context: Context,
  ) => ControllerEffect<Response | TypedResponse<unknown>, unknown>,
): Handler => (context) => runtime.runPromise(handler(context));
