// CRITICAL
import type { Hono } from "hono";
import type { AppContext } from "../types/context";
import type { LaunchResult, Recipe } from "../types/models";
import { AsyncLock, delay } from "../core/async";
import { badRequest, notFound } from "../core/errors";
import { primaryLogPathFor, readFileTailBytes, sanitizeLogSessionId } from "../core/log-files";
import { parseRecipe } from "../stores/recipe-serializer";
import { Event } from "../services/event-manager";
import { pidExists } from "../services/process-utilities";
import { fetchInference } from "../services/inference/inference-client";
import { isRecipeRunning } from "../services/recipe-matching";

const switchLock = new AsyncLock();
const launchCancelControllers = new Map<string, AbortController>();

/**
 * Register lifecycle routes.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerLifecycleRoutes = (app: Hono, context: AppContext): void => {
  /**
   * Read last N characters from a log file.
   * @param path - Log file path.
   * @param limit - Max chars.
   * @returns Log tail string.
   */
  const readLogTail = (path: string, limit: number): string => {
    // Byte-based tail to avoid reading large logs into memory.
    return readFileTailBytes(path, limit);
  };

  const serializeRecipeDetail = (recipe: Recipe): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      ...recipe,
      tp: recipe.tensor_parallel_size,
      pp: recipe.pipeline_parallel_size,
    };
    delete payload["tensor_parallel_size"];
    delete payload["pipeline_parallel_size"];
    return payload;
  };

  app.get("/recipes", async (ctx) => {
    const recipes = context.stores.recipeStore.list();
    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
    const launchingId = context.launchState.getLaunchingRecipeId();
    const result = recipes.map((recipe) => {
      let status = "stopped";
      if (launchingId === recipe.id) {
        status = "starting";
      }
      if (current && isRecipeRunning(recipe, current)) {
        status = "running";
      }
      return { ...recipe, status };
    });
    return ctx.json(result);
  });

  app.get("/recipes/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const recipe = context.stores.recipeStore.get(recipeId);
    if (!recipe) {
      throw notFound("Recipe not found");
    }
    return ctx.json(serializeRecipeDetail(recipe));
  });

  app.post("/recipes", async (ctx) => {
    const body = await ctx.req.json();
    try {
      const recipe = parseRecipe(body);
      context.stores.recipeStore.save(recipe);
      await context.eventManager.publish(new Event("recipe_created", { recipe }));
      return ctx.json({ success: true, id: recipe.id });
    } catch (error) {
      throw badRequest(String(error));
    }
  });

  app.put("/recipes/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const body = await ctx.req.json();
    try {
      const recipe = parseRecipe({ ...body, id: recipeId });
      context.stores.recipeStore.save(recipe);
      await context.eventManager.publish(new Event("recipe_updated", { recipe }));
      return ctx.json({ success: true, id: recipe.id });
    } catch (error) {
      throw badRequest(String(error));
    }
  });

  app.delete("/recipes/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const deleted = context.stores.recipeStore.delete(recipeId);
    if (!deleted) {
      throw notFound("Recipe not found");
    }
    await context.eventManager.publish(new Event("recipe_deleted", { recipe_id: recipeId }));
    return ctx.json({ success: true });
  });

  app.post("/launch/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const recipe = context.stores.recipeStore.get(recipeId);
    if (!recipe) {
      throw notFound("Recipe not found");
    }

    const currentLaunching = context.launchState.getLaunchingRecipeId();
    if (currentLaunching && currentLaunching !== recipeId) {
      await context.eventManager.publishLaunchProgress(recipeId, "preempting", `Cancelling ${currentLaunching}...`, 0);
      await context.eventManager.publishLaunchProgress(currentLaunching, "cancelled", `Preempted by ${recipeId}`, 0);
      const cancel = launchCancelControllers.get(currentLaunching);
      if (cancel) {
        cancel.abort();
      }
      await context.processManager.evictModel(true);
      await delay(1000);
    }

    const cancelController = new AbortController();
    launchCancelControllers.set(recipeId, cancelController);
    context.launchState.setLaunchingRecipeId(recipeId);

    let releaseLock: (() => void) | null = null;
    try {
      releaseLock = await switchLock.acquireWithTimeout(2000);
      if (!releaseLock) {
        await context.processManager.evictModel(true);
        await delay(1000);
        releaseLock = await switchLock.acquire();
      }

      await context.eventManager.publishLaunchProgress(recipeId, "evicting", "Clearing VRAM...", 0);
      await context.processManager.evictModel(true);
      await delay(1000);

      if (cancelController.signal.aborted) {
        await context.eventManager.publishLaunchProgress(recipeId, "cancelled", "Preempted by another launch", 0);
        return ctx.json({ success: false, pid: null, message: "Launch cancelled", log_file: null } as LaunchResult);
      }

      await context.eventManager.publishLaunchProgress(recipeId, "launching", `Starting ${recipe.name}...`, 0.25);
      const launch = await context.processManager.launchModel(recipe);
      if (!launch.success) {
        await context.eventManager.publishLaunchProgress(recipeId, "error", launch.message, 0);
        return ctx.json({ success: false, pid: null, message: launch.message, log_file: null } as LaunchResult);
      }

      await context.eventManager.publishLaunchProgress(recipeId, "waiting", "Waiting for model to load...", 0.5);

      const start = Date.now();
      const timeout = 300_000;
      let ready = false;
      let fatalError: string | null = null;
      const fatalPatterns = [
        "raise ValueError",
        "raise RuntimeError",
        "CUDA out of memory",
        "OutOfMemoryError",
        "torch.OutOfMemoryError",
        "not enough memory",
        "Cannot allocate",
        "larger than the available KV cache memory",
        "EngineCore failed to start",
      ];

      const safeRecipeId = sanitizeLogSessionId(recipeId);
      if (!safeRecipeId) {
        throw badRequest("Invalid recipe id");
      }
      const logFilePath = primaryLogPathFor(context.config.data_dir, safeRecipeId);

      while (Date.now() - start < timeout) {
        if (cancelController.signal.aborted) {
          await context.eventManager.publishLaunchProgress(recipeId, "cancelled", "Preempted by another launch", 0);
          if (launch.pid && pidExists(launch.pid)) {
            await context.processManager.killProcess(launch.pid, true);
          }
          return ctx.json({ success: false, pid: null, message: "Launch cancelled", log_file: null } as LaunchResult);
        }

        const logTail = readLogTail(logFilePath, 3000);
        if (logTail) {
          for (const pattern of fatalPatterns) {
            if (logTail.includes(pattern)) {
              const lines = logTail.split("\n");
              const index = lines.findIndex((line) => line.includes(pattern));
              if (index >= 0) {
                fatalError = lines.slice(Math.max(0, index - 1), index + 3).join("\n");
              }
              break;
            }
          }
        }
        if (fatalError) {
          break;
        }

        try {
          const response = await fetchInference(context, "/health", { timeoutMs: 5000 });
          if (response.status === 200) {
            ready = true;
            break;
          }
        } catch {
          ready = false;
        }

        const elapsed = Math.floor((Date.now() - start) / 1000);
        await context.eventManager.publishLaunchProgress(
          recipeId,
          "waiting",
          `Loading model... (${elapsed}s)`,
          0.5 + (elapsed / (timeout / 1000)) * 0.5,
        );
        await delay(2000);
      }

      if (fatalError) {
        if (launch.pid) {
          await context.processManager.killProcess(launch.pid, true);
        }
        await context.eventManager.publishLaunchProgress(recipeId, "error", `Fatal error detected: ${fatalError.slice(0, 100)}`, 0);
        return ctx.json({
          success: false,
          pid: null,
          message: `Fatal error: ${fatalError.slice(0, 300)}`,
          log_file: logFilePath,
        } as LaunchResult);
      }

      if (ready) {
        await context.eventManager.publishLaunchProgress(recipeId, "ready", "Model is ready!", 1.0);
        return ctx.json({
          success: true,
          pid: launch.pid ?? null,
          message: "Model is ready",
          log_file: logFilePath,
        } as LaunchResult);
      }

      if (launch.pid) {
        await context.processManager.killProcess(launch.pid, true);
      }
      const errorTail = readLogTail(logFilePath, 1000);
      await context.eventManager.publishLaunchProgress(recipeId, "error", "Model failed to become ready (timeout)", 0);
      return ctx.json({
        success: false,
        pid: null,
        message: `Model failed to become ready (timeout): ${errorTail.slice(-200)}`,
        log_file: logFilePath,
      } as LaunchResult);
    } finally {
      if (releaseLock) {
        releaseLock();
      }
      if (context.launchState.getLaunchingRecipeId() === recipeId) {
        context.launchState.setLaunchingRecipeId(null);
      }
      const controller = launchCancelControllers.get(recipeId);
      if (controller === cancelController) {
        launchCancelControllers.delete(recipeId);
      }
    }
  });

  app.post("/launch/:recipeId/cancel", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const cancel = launchCancelControllers.get(recipeId);
    if (!cancel) {
      const current = context.launchState.getLaunchingRecipeId();
      if (current !== recipeId) {
        throw notFound(`No launch in progress for ${recipeId}`);
      }
      await context.processManager.evictModel(true);
      return ctx.json({ success: true, message: "Launch aborted via eviction" });
    }
    cancel.abort();
    await context.processManager.evictModel(true);
    return ctx.json({ success: true, message: `Launch of ${recipeId} cancelled` });
  });

  app.post("/evict", async (ctx) => {
    const release = await switchLock.acquire();
    try {
      const pid = await context.processManager.evictModel(Boolean(ctx.req.query("force")));
      return ctx.json({ success: true, evicted_pid: pid });
    } finally {
      release();
    }
  });

  app.get("/wait-ready", async (ctx) => {
    const timeout = Number(ctx.req.query("timeout") ?? 300);
    const start = Date.now();
    while (Date.now() - start < timeout * 1000) {
      try {
        const response = await fetchInference(context, "/health", { timeoutMs: 5000 });
        if (response.status === 200) {
          return ctx.json({ ready: true, elapsed: Math.floor((Date.now() - start) / 1000) });
        }
      } catch {
        // Ignore fetch errors, retry after delay
      }
      await delay(2000);
    }
    return ctx.json({ ready: false, elapsed: timeout, error: "Timeout waiting for backend" });
  });
};
