import type { UsageStats } from "@local-studio/contracts/usage";
import { modelBasename } from "../../core/paths";
import { observeControllerFunction } from "../../core/function-observability";
import type { RouteRegistrar } from "../../http/route-registrar";
import type { AppContext } from "../../app-context";
import { getUsageFromPiSessions } from "./usage/pi-sessions";
import { emptyResponse } from "./usage/usage-utilities";

// Enrich the model filter set with the currently-running model. This used to
// scan the full process table via `ps` (findInferenceProcess) on every /usage
// request — an event-loop-blocking spawn just to learn the active model name.
// The metrics collector already refreshes `model_id`/`model_path`/
// `served_model_name` into the event manager's in-memory latest-metrics snapshot
// every few seconds, so read that instead (zero syscalls).
const collectKnownModels = (context: AppContext): Set<string> => {
  const knownModels = new Set<string>();
  for (const recipe of context.stores.recipeStore.list()) {
    if (recipe.served_model_name) knownModels.add(recipe.served_model_name);
    knownModels.add(recipe.id);
    if (recipe.name) knownModels.add(recipe.name);
  }
  const latest = context.eventManager.getLatestMetrics();
  const servedModelName = latest["served_model_name"];
  if (typeof servedModelName === "string" && servedModelName) knownModels.add(servedModelName);
  const modelId = latest["model_id"];
  if (typeof modelId === "string" && modelId) knownModels.add(modelId);
  const modelPath = latest["model_path"];
  if (typeof modelPath === "string" && modelPath) {
    knownModels.add(modelPath);
    knownModels.add(modelBasename(modelPath) ?? modelPath);
  }
  return knownModels;
};

// Analytics endpoints are not real-time; a short TTL collapses bursty
// dashboard polling (and repeated aggregation passes) into one computation.
const USAGE_CACHE_TTL_MS = 15_000;

const withControllerUsage = (
  context: AppContext,
  body: UsageStats,
  includeController: boolean,
): UsageStats =>
  includeController
    ? { ...body, controller: context.stores.controllerRequestStore.aggregate() }
    : body;

export const registerUsageRoutes: RouteRegistrar = (app, context) => {
  let usageCache: { at: number; body: UsageStats } | null = null;

  app.get("/usage", async (ctx) => {
    const includeController = ctx.req.query("include_controller") === "true";
    try {
      if (usageCache && Date.now() - usageCache.at < USAGE_CACHE_TTL_MS) {
        return ctx.json(withControllerUsage(context, usageCache.body, includeController));
      }
      const knownModels = await observeControllerFunction(context, "usage.collectKnownModels", () =>
        collectKnownModels(context),
      );
      const usage = await observeControllerFunction(
        context,
        "usage.aggregateInferenceRequests",
        () => context.stores.inferenceRequestStore.aggregate(knownModels),
      );
      const body: UsageStats = usage ?? emptyResponse();
      usageCache = { at: Date.now(), body };
      return ctx.json(withControllerUsage(context, body, includeController));
    } catch (error) {
      context.logger.error(`[Usage] Error fetching usage stats: ${(error as Error).message}`);
      return ctx.json(withControllerUsage(context, emptyResponse(), includeController));
    }
  });

  app.get("/usage/pi-sessions", async (ctx) => {
    try {
      // pi-sessions tab shows ALL pi coding-agent activity, regardless of
      // whether the model is one of our recipes (so users can see their
      // external model usage too).
      const usage = await observeControllerFunction(context, "usage.aggregatePiSessions", () =>
        getUsageFromPiSessions(),
      );
      const body: UsageStats = usage ?? emptyResponse();
      return ctx.json(body);
    } catch (error) {
      context.logger.error(`[Usage] Error fetching pi-sessions usage: ${(error as Error).message}`);
      return ctx.json(emptyResponse());
    }
  });
};
