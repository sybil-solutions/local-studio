import { Deferred, Effect } from "effect";
import { HttpStatus, badRequest, notFound, serviceUnavailable } from "../../core/errors";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { isRecipeRunning } from "../models/recipes/recipe-matching";

interface LaunchRouteAttempt {
  readonly completion: Deferred.Deferred<void, never>;
  readonly controller: AbortController;
  cancelling: boolean;
  coordinatorStarted: boolean;
}

export const registerLifecycleRoutes = defineRoutes((app, context) => {
  const launchAttempts = new Map<string, LaunchRouteAttempt>();
  const releaseLaunchAttempt = (attemptId: string): void => {
    launchAttempts.delete(attemptId);
    context.launchState.release(attemptId);
  };

  return mergeRoutes(
    app.post(
      "/launch/:recipeId",
      documentRoute,
      effectHandler((ctx) => {
        const recipeId = ctx.req.param("recipeId") ?? "";
        let ownedAttemptId: string | null = null;
        let ownedLaunchAttempt: LaunchRouteAttempt | null = null;
        const lifecycle = Effect.gen(function* () {
          const recipe = yield* context.stores.recipeStore.get(recipeId);
          if (!recipe) return yield* Effect.fail(notFound("Recipe not found"));
          const source =
            ctx.req.header("x-vllm-source") ??
            ctx.req.header("x-source") ??
            ctx.req.header("user-agent") ??
            null;
          const acquisition = context.launchState.tryAcquire(recipeId);
          if (!acquisition.acquired) {
            const activeRecipeId = acquisition.activeAttempt.recipeId;
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
          const attemptId = acquisition.attempt.attemptId;
          const launchAttempt: LaunchRouteAttempt = {
            completion: Deferred.makeUnsafe<void, never>(),
            controller: new AbortController(),
            cancelling: false,
            coordinatorStarted: false,
          };
          ownedAttemptId = attemptId;
          ownedLaunchAttempt = launchAttempt;
          launchAttempts.set(attemptId, launchAttempt);
          const current = yield* context.processManager.findInferenceProcess(
            context.config.inference_port,
          );
          if (launchAttempt.controller.signal.aborted) {
            return yield* Effect.fail(badRequest("Launch cancelled"));
          }
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
          launchAttempt.coordinatorStarted = true;
          const result = yield* context.engineService.setActiveRecipe(recipe, {
            attemptId,
            signal: launchAttempt.controller.signal,
          });
          if (!result.ok) {
            return yield* Effect.fail(
              result.error.toLowerCase().includes("cancelled")
                ? badRequest(result.error)
                : serviceUnavailable(result.error),
            );
          }
          return ctx.json({ success: true, message: "Launch started", attempt_id: attemptId });
        });
        return lifecycle.pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              if (!ownedAttemptId || !ownedLaunchAttempt) return;
              yield* Deferred.succeed(ownedLaunchAttempt.completion, undefined);
              if (!ownedLaunchAttempt.cancelling) releaseLaunchAttempt(ownedAttemptId);
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
          const activeAttempt = context.launchState.getActiveAttempt();
          if (!activeAttempt || activeAttempt.recipeId !== recipeId) {
            return yield* Effect.fail(notFound(`No launch in progress for ${recipeId}`));
          }
          const attemptId = ctx.req.query("attempt_id")?.trim();
          if (!attemptId) return yield* Effect.fail(badRequest("attempt_id is required"));
          if (activeAttempt.attemptId !== attemptId) {
            return yield* Effect.fail(
              new HttpStatus({ status: 409, detail: "Launch attempt is no longer active" }),
            );
          }
          const launchAttempt = launchAttempts.get(attemptId);
          if (!launchAttempt) {
            return yield* Effect.fail(notFound(`No launch in progress for ${recipeId}`));
          }
          if (launchAttempt.cancelling) {
            return yield* Effect.fail(
              new HttpStatus({
                status: 409,
                detail: `Cancellation already in progress for ${recipeId}`,
              }),
            );
          }
          launchAttempt.cancelling = true;
          launchAttempt.controller.abort();
          const coordinatorStarted = launchAttempt.coordinatorStarted;
          const cancellation = coordinatorStarted
            ? context.engineService.cancelLaunch(attemptId)
            : Effect.succeed({ ok: true, matched: false } as const);
          const result = yield* cancellation.pipe(
            Effect.onError(() =>
              Effect.sync(() => {
                launchAttempt.cancelling = false;
              }),
            ),
          );
          yield* Deferred.await(launchAttempt.completion);
          if (!result.ok) {
            launchAttempt.cancelling = false;
            return yield* Effect.fail(serviceUnavailable(result.error));
          }
          if (!result.matched && coordinatorStarted) {
            releaseLaunchAttempt(attemptId);
            return yield* Effect.fail(
              new HttpStatus({ status: 409, detail: "Launch attempt is no longer cancellable" }),
            );
          }
          releaseLaunchAttempt(attemptId);
          return ctx.json({
            success: true,
            message: `Launch of ${recipeId} cancelled`,
            attempt_id: attemptId,
          });
        }),
      ),
    ),

    app.post(
      "/evict",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const activeAttempt = context.launchState.getActiveAttempt();
          if (activeAttempt) {
            return yield* Effect.fail(
              new HttpStatus({
                status: 409,
                detail: `Launch already in progress for ${activeAttempt.recipeId}`,
              }),
            );
          }
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
