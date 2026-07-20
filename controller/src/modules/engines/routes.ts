import { defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { registerRecipeRoutes } from "./recipe-routes";
import { registerLifecycleRoutes } from "./lifecycle-routes";
import { registerDownloadRoutes } from "./download-routes";
import { registerRuntimeRoutes } from "./runtime-routes";

export const registerEngineRoutes = defineRoutes((app, context) => {
  return mergeRoutes(
    registerRecipeRoutes(app, context),
    registerLifecycleRoutes(app, context),
    registerDownloadRoutes(app, context),
    registerRuntimeRoutes(app, context),
  );
});
