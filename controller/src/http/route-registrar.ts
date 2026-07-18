import type { Hono, Schema as HonoSchema } from "hono";
import { describeRoute } from "hono-openapi";
import type { AppContext } from "../app-context";
import type { ControllerEnvironment } from "./effect-handler";

export type ControllerRouteApp = Hono<ControllerEnvironment, HonoSchema, string>;

export const documentRoute = describeRoute({
  responses: { 200: { description: "Successful response" } },
});

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
