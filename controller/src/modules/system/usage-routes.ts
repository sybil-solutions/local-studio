import type { Hono } from "hono";
import { observeControllerFunction } from "../../core/function-observability";
import type { AppContext } from "../../types/context";
import { getUsageFromPiSessions } from "./usage/pi-sessions";
import { emptyResponse } from "./usage/usage-utilities";

const collectKnownModels = async (context: AppContext): Promise<Set<string>> => {
  const knownModels = new Set<string>();
  for (const recipe of context.stores.recipeStore.list()) {
    if (recipe.served_model_name) knownModels.add(recipe.served_model_name);
    knownModels.add(recipe.id);
    if (recipe.name) knownModels.add(recipe.name);
  }
  const current = await context.processManager.findInferenceProcess(context.config.inference_port);
  if (current?.served_model_name) knownModels.add(current.served_model_name);
  if (current?.model_path) {
    knownModels.add(current.model_path);
    knownModels.add(current.model_path.split("/").pop() ?? current.model_path);
  }
  return knownModels;
};

export const registerUsageRoutes = (app: Hono, context: AppContext): void => {
  app.get("/usage", async (ctx) => {
    try {
      const knownModels = await observeControllerFunction(context, "usage.collectKnownModels", () =>
        collectKnownModels(context)
      );
      const usage = await observeControllerFunction(
        context,
        "usage.aggregateInferenceRequests",
        () => context.stores.inferenceRequestStore.aggregate(knownModels)
      );
      const response = usage ?? emptyResponse();
      return ctx.json({
        ...response,
        controller: context.stores.controllerRequestStore.aggregate(),
      });
    } catch (error) {
      context.logger.error(`[Usage] Error fetching usage stats: ${(error as Error).message}`);
      return ctx.json({
        ...emptyResponse(),
        controller: context.stores.controllerRequestStore.aggregate(),
      });
    }
  });

  app.get("/usage/pi-sessions", async (ctx) => {
    try {
      // pi-sessions tab shows ALL pi coding-agent activity, regardless of
      // whether the model is one of our recipes (so users can see their
      // external model usage too).
      const usage = await observeControllerFunction(context, "usage.aggregatePiSessions", () =>
        getUsageFromPiSessions(undefined, undefined, undefined)
      );
      if (usage) return ctx.json(usage);
      return ctx.json(emptyResponse());
    } catch (error) {
      context.logger.error(`[Usage] Error fetching pi-sessions usage: ${(error as Error).message}`);
      return ctx.json(emptyResponse());
    }
  });
};
