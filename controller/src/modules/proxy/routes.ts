import type { Hono } from "hono";
import type { AppContext } from "../../types/context";
import { registerOpenAIRoutes } from "./openai-routes";
import { registerTokenizationRoutes } from "./tokenization-routes";

export const registerAllProxyRoutes = (app: Hono, context: AppContext): void => {
  registerOpenAIRoutes(app, context);
  registerTokenizationRoutes(app, context);
};
