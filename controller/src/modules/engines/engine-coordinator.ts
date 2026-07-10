import { AsyncLock, delay } from "../../core/async";
import { primaryLogPathFor, readFileTailBytes } from "../../core/log-files";
import { fetchLocal } from "../../http/local-fetch";
import type { EventManager } from "../system/event-manager";
import { pidExists } from "./process/process-utilities";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import type { ProcessInfo, Recipe } from "../models/types";
import type { Config } from "../../config/env";
import type { ProcessManager } from "./process/process-manager";
import type { RecipeStore } from "../models/recipes/recipe-store";
import { LIFECYCLE_READY_TIMEOUT_MS } from "./configs";
import type { LaunchFailureBudget } from "./process/launch-failure-budget";
import { formatLaunchFailureBudgetMessage } from "./process/launch-failure-budget";
import { getEngineSpec } from "./engine-spec";
import { Effect } from "effect";
import {
  GpuLeaseConflict,
  type GpuLeaseRegistry,
  resolveRecipeGpuUuids,
} from "../system/gpu-leases";
import type { GpuInfo } from "../models/types";

export type SetActiveRecipeResult = { ok: true } | { ok: false; error: string };

/** Options for setting the active recipe. */
export interface SetActiveRecipeOptions {
  signal?: AbortSignal;
}

interface CoordinatorDeps {
  config: Config;
  eventManager: EventManager;
  processManager: ProcessManager;
  recipeStore: RecipeStore;
  launchFailureBudget: LaunchFailureBudget;
  gpuLeaseRegistry: GpuLeaseRegistry;
  gpuInfo: () => GpuInfo[];
}
export class EngineCoordinator {
  private readonly switchLock = new AsyncLock();
  private activeLifecycleAbort: AbortController | null = null;
  private activeLaunchPid: number | null = null;
  private lifecycleIntentSerial = 0;
  constructor(private readonly deps: CoordinatorDeps) {}

  async setActiveRecipe(
    recipe: Recipe | null,
    options: SetActiveRecipeOptions = {},
  ): Promise<SetActiveRecipeResult> {
    const intentSerial = ++this.lifecycleIntentSerial;
    this.activeLifecycleAbort?.abort();
    if (!recipe) {
      if (this.activeLaunchPid) {
        await this.deps.processManager.killProcess(this.activeLaunchPid, true);
      }
    }
    const release = await this.switchLock.acquire();
    let spawnedPid: number | null = null;
    let cancelled = false;
    let releaseLeaseOnCancel = false;
    const lifecycleAbort = recipe ? new AbortController() : null;
    const abortLifecycle = (): void => lifecycleAbort?.abort();
    if (lifecycleAbort) {
      if (options.signal?.aborted) lifecycleAbort.abort();
      options.signal?.addEventListener("abort", abortLifecycle, { once: true });
      this.activeLifecycleAbort = lifecycleAbort;
    }
    const isAborted = (): boolean =>
      Boolean(lifecycleAbort?.signal.aborted || intentSerial !== this.lifecycleIntentSerial);
    const publishCancelled = async (targetRecipe: Recipe): Promise<SetActiveRecipeResult> => {
      if (cancelled) return { ok: false, error: "Launch cancelled" };
      cancelled = true;
      if (spawnedPid) {
        await this.deps.processManager.killProcess(spawnedPid, true);
      }
      if (spawnedPid || releaseLeaseOnCancel) await this.releaseLlmGpuLease();
      await this.deps.eventManager.publishLaunchProgress(
        targetRecipe.id,
        "cancelled",
        "Launch cancelled",
        0,
      );
      return { ok: false, error: "Launch cancelled" };
    };
    const abortIfNeeded = async (
      targetRecipe: Recipe | null,
    ): Promise<SetActiveRecipeResult | null> => {
      if (!isAborted()) return null;
      if (!targetRecipe) return null;
      return publishCancelled(targetRecipe);
    };
    try {
      if (recipe && intentSerial !== this.lifecycleIntentSerial) {
        return { ok: false, error: "Launch cancelled" };
      }
      const current = await this.deps.processManager.findInferenceProcess(
        this.deps.config.inference_port,
      );
      const initialAbort = await abortIfNeeded(recipe);
      if (initialAbort) return initialAbort;
      if (!recipe && !current) {
        await this.releaseLlmGpuLease();
        return { ok: true };
      }
      if (recipe && current && isRecipeRunning(recipe, current)) {
        const leaseFailure = await this.prepareRecipeGpuLease(recipe, true);
        if (leaseFailure) return leaseFailure;
        return { ok: true };
      }
      const killCurrent = async (process: ProcessInfo): Promise<boolean> => {
        const evictedRecipe = this.findRecipeForProcess(process);
        if (evictedRecipe) {
          await this.deps.eventManager.publishLaunchProgress(
            evictedRecipe.id,
            "stopping",
            `Stopping ${evictedRecipe.name}...`,
            0.1,
          );
        }
        const stopped = await this.deps.processManager.killProcess(process.pid, true);
        if (evictedRecipe) {
          await this.deps.eventManager.publishLaunchProgress(
            evictedRecipe.id,
            stopped ? "stopped" : "error",
            stopped ? "Model stopped" : "Model did not stop cleanly",
            stopped ? 1 : 0,
          );
        }
        return stopped;
      };
      if (current && (!recipe || !isRecipeRunning(recipe, current))) {
        const stopped = await killCurrent(current);
        if (!stopped) {
          return { ok: false, error: `Failed to stop process ${current.pid}` };
        }
        releaseLeaseOnCancel = true;
        await delay(500);
      }
      const postEvictAbort = await abortIfNeeded(recipe);
      if (postEvictAbort) return postEvictAbort;
      if (!recipe) {
        await this.releaseLlmGpuLease();
        return { ok: true };
      }
      const leaseFailure = await this.prepareRecipeGpuLease(recipe, true);
      if (leaseFailure) return leaseFailure;
      const blocked = this.deps.launchFailureBudget.isBlocked(recipe.id);
      if (blocked) {
        await this.releaseLlmGpuLease();
        const message = formatLaunchFailureBudgetMessage(blocked);
        await this.deps.eventManager.publishLaunchProgress(recipe.id, "error", message, 0);
        return { ok: false, error: message };
      }
      await this.deps.eventManager.publishLaunchProgress(
        recipe.id,
        "launching",
        `Starting ${recipe.name}...`,
        0.25,
      );
      const launch = await this.deps.processManager.launchModel(recipe).catch(async (error) => {
        await this.releaseLlmGpuLease();
        throw error;
      });
      spawnedPid = launch.pid;
      this.activeLaunchPid = launch.pid;
      if (!launch.success) {
        await this.releaseLlmGpuLease();
        const failure = this.deps.launchFailureBudget.recordFailure(recipe.id);
        await this.deps.eventManager.publishLaunchProgress(
          recipe.id,
          "error",
          `${launch.message} (${failure.failure_count}/${failure.limit} launch failures in the current window)`,
          0,
        );
        return { ok: false, error: launch.message };
      }
      const postLaunchAbort = await abortIfNeeded(recipe);
      if (postLaunchAbort) return postLaunchAbort;
      await this.deps.eventManager.publishLaunchProgress(
        recipe.id,
        "waiting",
        "Loading model... (0s)",
        0.5,
      );
      const waitOptions: Parameters<typeof this.waitForReady>[0] = {
        recipe,
        pid: launch.pid,
        logFilePath: launch.log_file ?? primaryLogPathFor(this.deps.config.data_dir, recipe.id),
        timeoutMs: LIFECYCLE_READY_TIMEOUT_MS,
      };
      if (lifecycleAbort) {
        waitOptions.cancel = lifecycleAbort.signal;
      }
      const ready = await this.waitForReady(waitOptions);
      if (isAborted()) {
        return publishCancelled(recipe);
      }
      if (ready.ready) {
        this.deps.launchFailureBudget.reset(recipe.id);
        await this.deps.eventManager.publishLaunchProgress(
          recipe.id,
          "ready",
          "Model is ready!",
          1,
        );
        return { ok: true };
      }
      if (launch.pid) {
        await this.deps.processManager.killProcess(launch.pid, true);
      }
      await this.releaseLlmGpuLease();
      const failure = this.deps.launchFailureBudget.recordFailure(recipe.id);
      await this.deps.eventManager.publishLaunchProgress(
        recipe.id,
        "error",
        `${ready.message} (${failure.failure_count}/${failure.limit} launch failures in the current window)`,
        0,
      );
      return { ok: false, error: ready.message };
    } finally {
      if (this.activeLifecycleAbort === lifecycleAbort) {
        this.activeLifecycleAbort = null;
      }
      if (this.activeLaunchPid === spawnedPid) {
        this.activeLaunchPid = null;
      }
      options.signal?.removeEventListener("abort", abortLifecycle);
      release();
    }
  }
  private probeHealth(path: string): Promise<boolean> {
    return fetchLocal(this.deps.config.inference_port, path, {
      host: this.deps.config.inference_host,
      timeoutMs: 5000,
    })
      .then((response) => response.status === 200)
      .catch(() => false);
  }

  private async pollHealthy(options: {
    healthPath: string;
    timeoutMs: number;
    failure?: () => string | null;
  }): Promise<{ ready: boolean; message: string | null }> {
    const start = Date.now();
    while (Date.now() - start < options.timeoutMs) {
      const failed = options.failure?.();
      if (failed) return { ready: false, message: failed };
      if (await this.probeHealth(options.healthPath)) return { ready: true, message: null };
      await delay(2000);
    }
    return { ready: false, message: null };
  }

  async waitForHealthy(timeoutMs: number): Promise<boolean> {
    const result = await this.pollHealthy({ healthPath: "/health", timeoutMs });
    return result.ready;
  }

  private async waitForReady(options: {
    recipe: Recipe;
    pid: number | null;
    logFilePath: string | null;
    cancel?: AbortSignal;
    timeoutMs?: number;
  }): Promise<{ ready: true } | { ready: false; message: string }> {
    const result = await this.pollHealthy({
      healthPath: getEngineSpec(options.recipe.backend).healthPath,
      timeoutMs: options.timeoutMs ?? LIFECYCLE_READY_TIMEOUT_MS,
      failure: () => {
        if (options.cancel?.aborted) return "Launch cancelled";
        if (options.pid && !pidExists(options.pid)) {
          const errorTail = options.logFilePath ? readFileTailBytes(options.logFilePath, 500) : "";
          return `Model ${options.recipe.id} crashed during startup: ${errorTail.slice(-200)}`;
        }
        return null;
      },
    });
    if (result.ready) return { ready: true };
    return {
      ready: false,
      message: result.message ?? `Model ${options.recipe.id} failed to become ready (timeout)`,
    };
  }
  private findRecipeForProcess(current: ProcessInfo): Recipe | null {
    for (const candidate of this.deps.recipeStore.list()) {
      if (isRecipeRunning(candidate, current, { allowEitherPathContains: true })) {
        return candidate;
      }
    }
    return null;
  }
  resetLaunchFailureBudget(recipeId: string): void {
    this.deps.launchFailureBudget.reset(recipeId);
  }

  async getCurrentProcess(): Promise<ProcessInfo | null> {
    return this.deps.processManager.findInferenceProcess(this.deps.config.inference_port);
  }

  async getCurrentRecipe(): Promise<Recipe | null> {
    const process = await this.getCurrentProcess();
    return process ? this.findRecipeForProcess(process) : null;
  }

  private async releaseLlmGpuLease(): Promise<void> {
    await Effect.runPromise(this.deps.gpuLeaseRegistry.release("llm"));
  }

  private async prepareRecipeGpuLease(
    recipe: Recipe,
    replace: boolean,
  ): Promise<SetActiveRecipeResult | null> {
    const resolution = resolveRecipeGpuUuids(recipe, this.deps.gpuInfo());
    const leases = await Effect.runPromise(this.deps.gpuLeaseRegistry.snapshot());
    const speechActive = leases.some((lease) => lease.owner === "speech");
    if (resolution.unresolvedTokens.length > 0 && speechActive) {
      return {
        ok: false,
        error: `Cannot resolve GPU selectors while speech owns a device: ${resolution.unresolvedTokens.join(", ")}`,
      };
    }
    if (resolution.source === "all" && resolution.uuids.length === 0 && speechActive) {
      return { ok: false, error: "Cannot verify model GPU isolation while speech is active" };
    }
    if (resolution.uuids.length === 0) return null;
    try {
      const effect = replace
        ? this.deps.gpuLeaseRegistry.replace("llm", resolution.uuids)
        : this.deps.gpuLeaseRegistry.claim("llm", resolution.uuids);
      await Effect.runPromise(effect);
      return null;
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof GpuLeaseConflict
            ? "The selected model GPU is reserved by local speech"
            : error instanceof Error
              ? error.message
              : String(error),
      };
    }
  }
}
