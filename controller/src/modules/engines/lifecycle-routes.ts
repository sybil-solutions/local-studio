import { Effect } from "effect";
import { HttpStatus, badRequest, notFound, serviceUnavailable } from "../../core/errors";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { isRecipeRunning } from "../models/recipes/recipe-matching";

export const registerLifecycleRoutes = defineRoutes((app, context) => {
  const launchAbortControllers = new Map<string, AbortController>();

  return mergeRoutes(
    app.post(
      "/launch/:recipeId",
      documentRoute,
      effectHandler((ctx) => {
        const recipeId = ctx.req.param("recipeId") ?? "";
        const controller = new AbortController();
        let ownsLaunch = false;
        const lifecycle = Effect.gen(function* () {
          const recipe = yield* context.stores.recipeStore.get(recipeId);
          if (!recipe) return yield* Effect.fail(notFound("Recipe not found"));
          const source =
            ctx.req.header("x-vllm-source") ??
            ctx.req.header("x-source") ??
            ctx.req.header("user-agent") ??
            null;
          const launchState = context.launchState.getState();
          if (launchState.phase !== "idle") {
            const activeRecipeId = launchState.recipeId ?? "unknown";
            context.logger.warn("Rejected queued launch request", {
              active_recipe_id: activeRecipeId,
              requested_recipe_id: recipeId,
              source,
            });
            return yield* Effect.fail(
              new HttpStatus({
                status: 409,
                detail:
                  activeRecipeId === recipeId
                    ? `Launch already in progress for ${recipeId}`
                    : `Launch already in progress for ${activeRecipeId}; refusing to queue ${recipeId}`,
              }),
            );
          }
          const current = yield* context.processManager.findInferenceProcess(
            context.config.inference_port,
          );
          if (current && !isRecipeRunning(recipe, current, { allowEitherPathContains: true })) {
            context.logger.warn("Rejected launch request while another model is running", {
              running_model: current.served_model_name ?? current.model_path,
              running_backend: current.backend,
              requested_recipe_id: recipeId,
              source,
            });
            return yield* Effect.fail(
              new HttpStatus({
                status: 409,
                detail: `Model ${current.served_model_name ?? current.model_path} is already running; evict it before launching ${recipeId}`,
              }),
            );
          }
          context.logger.info("Accepted launch request", { recipe_id: recipeId, source });
          launchAbortControllers.set(recipeId, controller);
          context.launchState.markLaunching(recipeId);
          ownsLaunch = true;
          const result = yield* context.engineService.setActiveRecipe(recipe, {
            signal: controller.signal,
          });
          if (!result.ok) {
            return yield* Effect.fail(
              result.error.toLowerCase().includes("cancelled")
                ? badRequest(result.error)
                : serviceUnavailable(result.error),
            );
          }
          return ctx.json({ success: true, message: "Launch started" });
        });
        return lifecycle.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (!ownsLaunch) return;
              if (launchAbortControllers.get(recipeId) === controller) {
                launchAbortControllers.delete(recipeId);
              }
              if (context.launchState.getLaunchingRecipeId() === recipeId) {
                context.launchState.markIdle();
              }
            }),
          ),
        );
      }),
    ),

    app.post(
      "/launch/:recipeId/cancel",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const recipeId = ctx.req.param("recipeId") ?? "";
          const controller = launchAbortControllers.get(recipeId);
          if (!controller) {
            return yield* Effect.fail(notFound(`No launch in progress for ${recipeId}`));
          }
          controller.abort();
          yield* context.engineService.cancelActiveLaunch();
          return ctx.json({ success: true, message: `Launch of ${recipeId} cancelled` });
        }),
      ),
    ),

    app.post(
      "/evict",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const result = yield* context.engineService.setActiveRecipe(null);
          if (!result.ok) return yield* Effect.fail(serviceUnavailable(result.error));
          return ctx.json({ success: true, evicted_pid: null });
        }),
      ),
    ),

    app.get(
      "/wait-ready",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const timeout = Number(ctx.req.query("timeout") ?? 300);
          const start = Date.now();
          if (yield* context.engineService.waitForHealthy(timeout * 1000)) {
            return ctx.json({ ready: true, elapsed: Math.floor((Date.now() - start) / 1000) });
          }
          return ctx.json({ ready: false, elapsed: timeout, error: "Timeout waiting for backend" });
        }),
      ),
    ),
  );
});
