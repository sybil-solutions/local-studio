import type { Hono } from "hono";
import type { AppContext } from "../../types/context";

export type ProxyRouteRegistrar = (app: Hono, context: AppContext) => void;
