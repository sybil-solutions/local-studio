import { defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { registerPassthroughRoutes } from "./passthrough-routes";
import { registerTokenizationRoutes } from "./tokenization-routes";

export const registerAllProxyRoutes = defineRoutes((app, context) => {
  return mergeRoutes(
    registerPassthroughRoutes(app, context),
    registerTokenizationRoutes(app, context),
  );
});
