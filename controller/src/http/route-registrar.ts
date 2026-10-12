import type { Context, Hono, Schema, ToSchema, TypedResponse } from "hono";
import type { HonoBase } from "hono/hono-base";
import type { HandlerInterface } from "hono/types";
import { describeRoute } from "hono-openapi";
import type { AppContext } from "../app-context";
import { effectHandler, type ControllerEffect, type ControllerEnvironment } from "./effect-handler";

export type ControllerRouteApp = Hono<ControllerEnvironment, Schema, string>;

const documentRoute = describeRoute({
  responses: { 200: { description: "Successful response" } },
});

type EffectRouteHandler = (context: Context<ControllerEnvironment>) => unknown;

type EffectRouteHandlerResult<Handler extends EffectRouteHandler> =
  ReturnType<Handler> extends ControllerEffect<infer Result, unknown>
    ? Extract<Result, Response | TypedResponse<unknown>>
    : never;

type CheckedEffectRouteHandler<Handler extends EffectRouteHandler> = ((
  context: Context<ControllerEnvironment>,
) => ControllerEffect<NoInfer<EffectRouteHandlerResult<Handler>>, unknown>) &
  Handler;

type EffectRouteResponse<Result> = Result extends TypedResponse ? Result : TypedResponse;

type RegisteredEffectRoute<
  M extends HandlerInterface<ControllerEnvironment>,
  Path extends string,
  Result,
  Name extends string = M extends HandlerInterface<ControllerEnvironment, infer N> ? N : never,
> = HonoBase<
  ControllerEnvironment,
  ToSchema<Name, Path, {}, EffectRouteResponse<Result>>,
  "/",
  Path
>;

type EffectRouteRegistrar<
  Method extends HandlerInterface<ControllerEnvironment>,
  Path extends string,
  Result extends Response | TypedResponse<unknown>,
> = (
  path: Path,
  document: typeof documentRoute,
  handler: ReturnType<typeof effectHandler<Result>>,
) => RegisteredEffectRoute<Method, Path, Result>;

export const effectRoute = <
  Method extends HandlerInterface<ControllerEnvironment>,
  const Path extends string,
  const Handler extends EffectRouteHandler,
>(
  method: Method &
    EffectRouteRegistrar<Method, NoInfer<Path>, NoInfer<EffectRouteHandlerResult<Handler>>>,
  path: Path,
  handler: CheckedEffectRouteHandler<Handler>,
): RegisteredEffectRoute<Method, Path, EffectRouteHandlerResult<Handler>> =>
  method(path, documentRoute, effectHandler(handler));

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

export const defineRoutes = <Routes extends ControllerRouteApp>(
  registrar: (app: Hono<ControllerEnvironment>, context: AppContext) => Routes,
): typeof registrar => registrar;

export const mergeRoutes = <
  const Routes extends readonly [ControllerRouteApp, ...ControllerRouteApp[]],
>(
  ...routes: Routes
): UnionToIntersection<Routes[number]> => routes[0] as UnionToIntersection<Routes[number]>;
