import type { Hono } from "hono";
import type { AppContext } from "../app-context";
import type { ControllerEnvironment } from "./effect-handler";

export type RouteRegistrar = (app: Hono<ControllerEnvironment>, context: AppContext) => void;
