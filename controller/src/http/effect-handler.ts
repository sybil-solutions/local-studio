import type { Context, Handler, MiddlewareHandler, Next, TypedResponse } from "hono";
import { Cause, Exit, type Effect } from "effect";
import type { AppContextService } from "../app-context";
import type { ControllerRuntime } from "../core/effect-runtime";

export type ControllerEffect<A, E = never> = Effect.Effect<A, E, AppContextService>;
export type ControllerEnvironment = {
  Variables: {
    controllerRuntime: ControllerRuntime;
  };
};

export const controllerRuntimeMiddleware =
  (runtime: ControllerRuntime): MiddlewareHandler<ControllerEnvironment> =>
  (context, next) => {
    context.set("controllerRuntime", runtime);
    return next();
  };

const runControllerEffect = <A, E>(
  runtime: ControllerRuntime,
  effect: ControllerEffect<A, E>,
): Promise<A> =>
  runtime.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.findErrorOption(exit.cause);
    if (failure._tag === "Some") throw failure.value;
    throw Cause.squash(exit.cause);
  });

export const effectHandler =
  (
    handler: (
      context: Context<ControllerEnvironment>,
    ) => ControllerEffect<Response | TypedResponse<unknown>, unknown>,
  ): Handler<ControllerEnvironment> =>
  (context) =>
    runControllerEffect(context.get("controllerRuntime"), handler(context));

export const effectMiddleware =
  (
    handler: (
      context: Context<ControllerEnvironment>,
      next: Next,
    ) => ControllerEffect<Response | void, unknown>,
  ): MiddlewareHandler<ControllerEnvironment> =>
  (context, next) =>
    runControllerEffect(context.get("controllerRuntime"), handler(context, next));
