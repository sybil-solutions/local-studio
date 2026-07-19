import { defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { registerOpenAIRoutes } from "./openai-routes";
import { registerTokenizationRoutes } from "./tokenization-routes";

export const registerAllProxyRoutes = defineRoutes((app, context) => {
  return mergeRoutes(registerOpenAIRoutes(app, context), registerTokenizationRoutes(app, context));
});
