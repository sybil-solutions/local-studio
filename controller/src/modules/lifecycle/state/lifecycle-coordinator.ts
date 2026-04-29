// CRITICAL
import { AsyncLock, delay } from "../../../core/async";

import { parseProviderModel } from "../../../services/provider-routing";
import { primaryLogPathFor, readFileTailBytes, sanitizeLogSessionId } from "../../../core/log-files";
import { fetchLocal } from "../../../http/local-fetch";
import { Event, type EventManager } from "../../monitoring/event-manager";
import { CONTROLLER_EVENTS } from "../../../contracts/controller-events";
import { pidExists } from "../process/process-utilities";
import { isRecipeRunning } from "../recipes/recipe-matching";
import type { LaunchResult, ProcessInfo, Recipe } from "../types";
import type { Config } from "../../../config/env";
import type { Logger } from "../../../core/logger";
import type { LaunchState } from "./launch-state";
import type { ControllerMetrics } from "../../monitoring/metrics";
import type { ProcessManager } from "../process/process-manager";
import type { RecipeStore } from "../recipes/recipe-store";
import { LIFECYCLE_READY_TIMEOUT_MS } from "../configs";

export interface EnsureActiveResult {
  switched: boolean;
  error: string | null;
}

export interface EnsureActiveOptions {
  force_evict?: boolean;
  publish_events?: boolean;
}

export interface LifecycleCoordinator {
  ensureActive: (recipe: Recipe, options?: EnsureActiveOptions) => Promise<EnsureActiveResult>;
  launchRecipe: (recipe: Recipe) => Promise<LaunchResult>;
  cancelLaunch: (recipeId: string) => Promise<{ success: boolean; message: string }>;
  evict: (force: boolean) => Promise<{ success: boolean; evicted_pid: number | null }>;
}

const readLogTail = (path: string, limit: number): string => {
  return readFileTailBytes(path, limit);
};

const buildLogFilePath = (dataDirectory: string, recipeId: string): string | null => {
  const safeRecipeId = sanitizeLogSessionId(recipeId);
  if (!safeRecipeId) {
    return null;
  }
  return primaryLogPathFor(dataDirectory, safeRecipeId);
};

export const createLifecycleCoordinator = (args: {
  config: Config;
  logger: Logger;
  eventManager: EventManager;
  launchState: LaunchState;
  metrics: ControllerMetrics;
  processManager: ProcessManager;
  recipeStore: RecipeStore;
  abortRunsForModel?: (modelName: string) => number;
}): LifecycleCoordinator => {
  const deps = args;
  const switchLock = new AsyncLock();
  const launchCancelControllers = new Map<string, AbortController>();

  const findRecipeForProcess = (current: ProcessInfo): Recipe | null => {
    for (const candidate of deps.recipeStore.list()) {
      if (isRecipeRunning(candidate, current, { allowEitherPathContains: true })) {
        return candidate;
      }
    }
    return null;
  };

  const abortRunsForRecipe = (recipe: Recipe): void => {
    if (!deps.abortRunsForModel) return;
    const modelCandidates = [recipe.served_model_name, recipe.id].filter(
      (value): value is string => Boolean(value && value.trim())
    );

    let totalAborted = 0;
    const abortedByCanonical = new Set<string>();
    for (const candidate of modelCandidates) {
      const parsed = parseProviderModel(candidate);
      if (!parsed.modelId) {
        continue;
      }
      const canonical = `${parsed.provider}/${parsed.modelId}`.toLowerCase();
      if (abortedByCanonical.has(canonical)) {
        continue;
      }
      abortedByCanonical.add(canonical);
      totalAborted += deps.abortRunsForModel(`${parsed.provider}/${parsed.modelId}`);
    }

    if (totalAborted > 0) {
      deps.logger.info("Aborted active chat runs for evicted model", {
        recipe_id: recipe.id,
        aborted_runs: totalAborted,
      });
    }
  };

  const evictCurrentModel = async (force: boolean): Promise<number | null> => {
    const currentProcess = await deps.processManager.findInferenceProcess(deps.config.inference_port);
    const currentRecipe = currentProcess ? findRecipeForProcess(currentProcess) : null;
    const evictedPid = await deps.processManager.evictModel(force);
    if (currentRecipe) {
      abortRunsForRecipe(currentRecipe);
    }
    return evictedPid;
  };

  const waitForReady = async (options: {
    recipe: Recipe;
    pid: number | null;
    logFilePath: string | null;
    cancel?: AbortSignal;
    timeoutMs?: number;
    fatalPatterns?: string[];
    onProgress?: (elapsedSeconds: number) => Promise<void>;
  }): Promise<{ ready: true } | { ready: false; message: string }> => {
    const timeout = options.timeoutMs ?? LIFECYCLE_READY_TIMEOUT_MS;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (options.cancel?.aborted) {
        return { ready: false, message: "Launch cancelled" };
      }

      if (options.pid && !pidExists(options.pid)) {
        const errorTail = options.logFilePath ? readLogTail(options.logFilePath, 500) : "";
        return {
          ready: false,
          message: `Model ${options.recipe.id} crashed during startup: ${errorTail.slice(-200)}`,
        };
      }

      if (options.logFilePath && options.fatalPatterns && options.fatalPatterns.length > 0) {
        const logTail = readLogTail(options.logFilePath, 3000);
        for (const pattern of options.fatalPatterns) {
          if (!logTail.includes(pattern)) continue;
          const lines = logTail.split("\n");
          const index = lines.findIndex((line) => line.includes(pattern));
          const snippet =
            index >= 0 ? lines.slice(Math.max(0, index - 1), index + 3).join("\n") : pattern;
          return { ready: false, message: `Fatal error: ${snippet.slice(0, 300)}` };
        }
      }

      try {
        const response = await fetchLocal(deps.config.inference_port, "/health", { timeoutMs: 5000 });
        if (response.status === 200) {
          return { ready: true };
        }
      } catch {
        // ignore
      }

      const elapsedSeconds = Math.floor((Date.now() - start) / 1000);
      if (options.onProgress) {
        await options.onProgress(elapsedSeconds);
      }
      await delay(2000);
    }

    return { ready: false, message: `Model ${options.recipe.id} failed to become ready (timeout)` };
  };

  const ensureActive = async (
    recipe: Recipe,
    options: EnsureActiveOptions = {}
  ): Promise<EnsureActiveResult> => {
    const startTs = Date.now();
    const existing = await deps.processManager.findInferenceProcess(deps.config.inference_port);
    if (existing && isRecipeRunning(recipe, existing)) {
      return { switched: false, error: null };
    }

    const release = await switchLock.acquire();
    deps.launchState.markLaunching(recipe.id);
    try {
      const latest = await deps.processManager.findInferenceProcess(deps.config.inference_port);
      if (latest && isRecipeRunning(recipe, latest)) {
        return { switched: false, error: null };
      }

      const publishEvents = options.publish_events !== false;
      const observedProcess = latest ?? existing;
      const fromRecipe = observedProcess ? findRecipeForProcess(observedProcess) : null;
      const fromModel = fromRecipe
        ? fromRecipe.served_model_name ?? fromRecipe.id
        : latest
          ? latest.model_path
          : null;
      const fromBackend = latest?.backend ?? fromRecipe?.backend ?? "unknown";

      if (publishEvents) {
        await deps.eventManager.publish(
          new Event(CONTROLLER_EVENTS.MODEL_SWITCH, {
            status: "started",
            from_model: fromModel,
            from_backend: fromBackend,
            to_recipe_id: recipe.id,
            to_model: recipe.served_model_name ?? recipe.id,
            to_backend: recipe.backend,
          })
        );
      }

      await evictCurrentModel(options.force_evict === true);
      await delay(2000);
      const launch = await deps.processManager.launchModel(recipe);
      if (!launch.success) {
        const message = `Failed to launch model ${recipe.id}: ${launch.message}`;
        if (publishEvents) {
          await deps.eventManager.publish(
            new Event(CONTROLLER_EVENTS.MODEL_SWITCH, {
              status: "error",
              to_recipe_id: recipe.id,
              to_model: recipe.served_model_name ?? recipe.id,
              to_backend: recipe.backend,
              reason: message,
            })
          );
        }
        deps.metrics.recordModelSwitch(
          recipe.id,
          recipe.backend,
          (Date.now() - startTs) / 1000,
          false
        );
        return { switched: true, error: message };
      }

      const logFilePath = buildLogFilePath(deps.config.data_dir, recipe.id);
      const ready = await waitForReady({
        recipe,
        pid: launch.pid,
        logFilePath,
        timeoutMs: LIFECYCLE_READY_TIMEOUT_MS,
      });
      if (ready.ready) {
        if (publishEvents) {
          await deps.eventManager.publish(
            new Event(CONTROLLER_EVENTS.MODEL_SWITCH, {
              status: "ready",
              to_recipe_id: recipe.id,
              to_model: recipe.served_model_name ?? recipe.id,
              to_backend: recipe.backend,
              from_model: fromModel,
              from_backend: fromBackend,
            })
          );
        }
        deps.metrics.recordModelSwitch(
          recipe.id,
          recipe.backend,
          (Date.now() - startTs) / 1000,
          true
        );
        return { switched: true, error: null };
      }

      if (launch.pid) {
        await deps.processManager.killProcess(launch.pid, true);
      }
      if (publishEvents) {
        await deps.eventManager.publish(
          new Event(CONTROLLER_EVENTS.MODEL_SWITCH, {
            status: "error",
            to_recipe_id: recipe.id,
            to_model: recipe.served_model_name ?? recipe.id,
            to_backend: recipe.backend,
            reason: ready.message,
          })
        );
      }
      deps.metrics.recordModelSwitch(
        recipe.id,
        recipe.backend,
        (Date.now() - startTs) / 1000,
        false
      );
      return { switched: true, error: ready.message };
    } finally {
      release();
      if (deps.launchState.getLaunchingRecipeId() === recipe.id) {
        deps.launchState.markIdle();
      }
    }
  };

  const runLaunchInBackground = async (
    recipe: Recipe,
    logFilePath: string | null,
    cancelController: AbortController
  ): Promise<{ pid: number | null; ready: boolean; error: string | null }> => {
    const startTs = Date.now();
    const release = await switchLock.acquire();
    try {
      await deps.eventManager.publishLaunchProgress(recipe.id, "evicting", "Clearing VRAM...", 0);
      await evictCurrentModel(true);
      await delay(1000);

      if (cancelController.signal.aborted) {
        await deps.eventManager.publishLaunchProgress(
          recipe.id,
          "cancelled",
          "Preempted by another launch",
          0
        );
        return { pid: null, ready: false, error: "Launch preempted by another recipe" };
      }

      await deps.eventManager.publishLaunchProgress(
        recipe.id,
        "launching",
        `Starting ${recipe.name}...`,
        0.25
      );
      const launch = await deps.processManager.launchModel(recipe);
      if (!launch.success) {
        await deps.eventManager.publishLaunchProgress(recipe.id, "error", launch.message, 0);
        return { pid: null, ready: false, error: launch.message };
      }

      await deps.eventManager.publishLaunchProgress(
        recipe.id,
        "waiting",
        "Waiting for model to load...",
        0.5
      );

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

      if (!logFilePath) {
        await deps.eventManager.publishLaunchProgress(recipe.id, "error", "Invalid recipe id", 0);
        return { pid: launch.pid, ready: false, error: "Invalid recipe id" };
      }

      const ready = await waitForReady({
        recipe,
        pid: launch.pid,
        logFilePath,
        cancel: cancelController.signal,
        timeoutMs: LIFECYCLE_READY_TIMEOUT_MS,
        fatalPatterns,
        onProgress: async (elapsedSeconds) => {
          await deps.eventManager.publishLaunchProgress(
            recipe.id,
            "waiting",
            `Loading model... (${elapsedSeconds}s)`,
            0.5 + (elapsedSeconds / (LIFECYCLE_READY_TIMEOUT_MS / 1000)) * 0.5
          );
        },
      });

      if (ready.ready) {
        await deps.eventManager.publishLaunchProgress(recipe.id, "ready", "Model is ready!", 1.0);
        deps.metrics.recordModelSwitch(
          recipe.id,
          recipe.backend,
          (Date.now() - startTs) / 1000,
          true
        );
        return { pid: launch.pid, ready: true, error: null };
      }

      if (launch.pid) {
        await deps.processManager.killProcess(launch.pid, true);
      }
      await deps.eventManager.publishLaunchProgress(recipe.id, "error", ready.message, 0);
      const errorTail = readLogTail(logFilePath, 1000);
      deps.metrics.recordModelSwitch(
        recipe.id,
        recipe.backend,
        (Date.now() - startTs) / 1000,
        false
      );
      deps.logger.error(`Launch failed for ${recipe.id}: ${ready.message}: ${errorTail.slice(-200)}`);
      return { pid: launch.pid, ready: false, error: ready.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.eventManager.publishLaunchProgress(recipe.id, "error", message, 0);
      deps.logger.error(`Launch background error for ${recipe.id}: ${message}`);
      return { pid: null, ready: false, error: message };
    } finally {
      release();
      if (deps.launchState.getLaunchingRecipeId() === recipe.id) {
        deps.launchState.markIdle();
      }
      const controller = launchCancelControllers.get(recipe.id);
      if (controller === cancelController) {
        launchCancelControllers.delete(recipe.id);
      }
    }
  };

  const launchRecipe = async (recipe: Recipe): Promise<LaunchResult> => {
    const current = await deps.processManager.findInferenceProcess(deps.config.inference_port);
    const logFilePath = buildLogFilePath(deps.config.data_dir, recipe.id);
    if (current && isRecipeRunning(recipe, current)) {
      return {
        success: true,
        pid: current.pid,
        message: "Model is already running",
        log_file: logFilePath,
      };
    }

    const currentLaunching = deps.launchState.getLaunchingRecipeId();
    if (currentLaunching && currentLaunching !== recipe.id) {
      deps.launchState.markPreempting(currentLaunching);
      await deps.eventManager.publishLaunchProgress(
        recipe.id,
        "preempting",
        `Cancelling ${currentLaunching}...`,
        0
      );
      await deps.eventManager.publishLaunchProgress(
        currentLaunching,
        "cancelled",
        `Preempted by ${recipe.id}`,
        0
      );
      const cancel = launchCancelControllers.get(currentLaunching);
      if (cancel) {
        cancel.abort();
      }
      await evictCurrentModel(true);
      await delay(1000);
    }

    const cancelController = new AbortController();
    launchCancelControllers.set(recipe.id, cancelController);
    deps.launchState.markLaunching(recipe.id);

    // Fire-and-forget: run the long launch process in background.
    // But now we capture the result to report actual success/failure to API caller.
    const backgroundResult = await runLaunchInBackground(recipe, logFilePath, cancelController);

    // Return actual result based on background launch outcome
    if (backgroundResult.error) {
      deps.launchState.markIdle();
      return {
        success: false,
        pid: null,
        message: backgroundResult.error,
        log_file: logFilePath,
      };
    }

    return {
      success: true,
      pid: backgroundResult.pid,
      message: backgroundResult.ready ? "Model is ready" : "Launch started",
      log_file: logFilePath,
    };
  };

  const cancelLaunch = async (
    recipeId: string
  ): Promise<{ success: boolean; message: string }> => {
    const cancel = launchCancelControllers.get(recipeId);
    if (!cancel) {
      const current = deps.launchState.getLaunchingRecipeId();
      if (current !== recipeId) {
        return { success: false, message: `No launch in progress for ${recipeId}` };
      }
      await evictCurrentModel(true);
      return { success: true, message: "Launch aborted via eviction" };
    }
    cancel.abort();
    await evictCurrentModel(true);
    return { success: true, message: `Launch of ${recipeId} cancelled` };
  };

  const evict = async (force: boolean): Promise<{ success: boolean; evicted_pid: number | null }> => {
    const release = await switchLock.acquire();
    try {
      const evictedPid = await evictCurrentModel(force);
      return { success: true, evicted_pid: evictedPid };
    } finally {
      release();
    }
  };

  return {
    ensureActive,
    launchRecipe,
    cancelLaunch,
    evict,
  };
};
