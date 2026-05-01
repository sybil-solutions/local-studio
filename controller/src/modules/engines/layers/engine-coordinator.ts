import { AsyncLock, delay } from "../../../core/async";
import { primaryLogPathFor, readFileTailBytes } from "../../../core/log-files";
import { Event, type EventManager } from "../../system/event-manager";
import { CONTROLLER_EVENTS } from "../../../contracts/controller-events";
import { pidExists } from "./process-utilities";
import { isRecipeRunning } from "../../models/recipes/recipe-matching";
import type { ProcessInfo, Recipe } from "../../models/types";
import type { Config } from "../../../config/env";
import type { Logger } from "../../../core/logger";
import type { ProcessManager } from "./process-manager";
import type { RecipeStore } from "../../models/recipes/recipe-store";
import { LIFECYCLE_READY_TIMEOUT_MS } from "../configs";
import type { EngineService, RuntimeType, UpgradeResult, RuntimeInfo, DownloadRequest, HfModel, SetActiveRecipeResult, SetActiveRecipeOptions } from "../services/engine-service";
import type { ModelDownload } from "../../shared/recipe-types";

import type { DownloadManager } from "./download-manager";
import { getVllmRuntimeInfo, upgradeVllmRuntime, getVllmConfigHelp } from "./vllm-runtime";
import { getLlamacppConfigHelp } from "./llamacpp-runtime";
import { getLlamacppRuntimeInfo, getSglangRuntimeInfo, getExllamav3RuntimeInfo } from "./runtime-info";
import { upgradeSglangRuntime, upgradeLlamacppRuntime, runPlatformUpgrade } from "./runtime-upgrade";
import { fetchHuggingFaceModelInfo } from "./huggingface-api";

interface CoordinatorDeps {
  config: Config;
  logger: Logger;
  eventManager: EventManager;
  processManager: ProcessManager;
  recipeStore: RecipeStore;
  downloadManager: DownloadManager;
  abortRunsForModel?: (modelName: string) => number;
}

export class EngineCoordinator implements EngineService {
  private readonly switchLock = new AsyncLock();
  private currentRecipe: Recipe | null = null;

  constructor(private readonly deps: CoordinatorDeps) {}

  // ── Lifecycle ──

  /**
   * Set the authoritative active recipe.
   * @param recipe - Recipe to activate, or null to evict the active process.
   * @param options - Optional cancellation controls.
   * @returns Operation result.
   */
  async setActiveRecipe(
    recipe: Recipe | null,
    options: SetActiveRecipeOptions = {}
  ): Promise<SetActiveRecipeResult> {
    const release = await this.switchLock.acquire();
    let spawnedPid: number | null = null;
    let cancelled = false;
    const publishCancelled = async (targetRecipe: Recipe): Promise<SetActiveRecipeResult> => {
      if (cancelled) return { ok: false, error: "Launch cancelled" };
      cancelled = true;
      if (spawnedPid) {
        await this.deps.processManager.killProcess(spawnedPid, true);
      }
      await this.deps.eventManager.publishLaunchProgress(
        targetRecipe.id,
        "cancelled",
        "Launch cancelled",
        0
      );
      return { ok: false, error: "Launch cancelled" };
    };
    const abortIfNeeded = async (targetRecipe: Recipe | null): Promise<SetActiveRecipeResult | null> => {
      if (!options.signal?.aborted) return null;
      if (!targetRecipe) return null;
      return publishCancelled(targetRecipe);
    };

    try {
      const current = await this.deps.processManager.findInferenceProcess(
        this.deps.config.inference_port
      );
      const initialAbort = await abortIfNeeded(recipe);
      if (initialAbort) return initialAbort;

      if (!recipe && !current) {
        this.currentRecipe = null;
        return { ok: true };
      }

      if (recipe && current && isRecipeRunning(recipe, current)) {
        this.currentRecipe = recipe;
        return { ok: true };
      }

      const killCurrent = async (process: ProcessInfo): Promise<void> => {
        const evictedRecipe = this.findRecipeForProcess(process);
        await this.deps.processManager.killProcess(process.pid, true);
        if (evictedRecipe) {
          this.abortRunsForRecipe(evictedRecipe);
        }
      };

      if (current && (!recipe || !isRecipeRunning(recipe, current))) {
        await killCurrent(current);
        await delay(500);
      }

      const postEvictAbort = await abortIfNeeded(recipe);
      if (postEvictAbort) return postEvictAbort;

      if (!recipe) {
        this.currentRecipe = null;
        return { ok: true };
      }

      await this.deps.eventManager.publishLaunchProgress(
        recipe.id,
        "launching",
        `Starting ${recipe.name}...`,
        0.25
      );
      const launch = await this.deps.processManager.launchModel(recipe);
      spawnedPid = launch.pid;
      if (!launch.success) {
        await this.deps.eventManager.publishLaunchProgress(recipe.id, "error", launch.message, 0);
        return { ok: false, error: launch.message };
      }

      const postLaunchAbort = await abortIfNeeded(recipe);
      if (postLaunchAbort) return postLaunchAbort;

      await this.deps.eventManager.publishLaunchProgress(
        recipe.id,
        "waiting",
        "Loading model... (0s)",
        0.5
      );
      const waitOptions: Parameters<typeof this.waitForReady>[0] = {
        recipe,
        pid: launch.pid,
        logFilePath: launch.log_file ?? primaryLogPathFor(this.deps.config.data_dir, recipe.id),
        timeoutMs: LIFECYCLE_READY_TIMEOUT_MS,
      };
      if (options.signal) {
        waitOptions.cancel = options.signal;
      }
      const ready = await this.waitForReady(waitOptions);

      if (options.signal?.aborted) {
        return publishCancelled(recipe);
      }

      if (ready.ready) {
        this.currentRecipe = recipe;
        await this.deps.eventManager.publishLaunchProgress(
          recipe.id,
          "ready",
          "Model is ready!",
          1
        );
        return { ok: true };
      }

      if (launch.pid) {
        await this.deps.processManager.killProcess(launch.pid, true);
      }
      await this.deps.eventManager.publishLaunchProgress(recipe.id, "error", ready.message, 0);
      return { ok: false, error: ready.message };
    } finally {
      release();
    }
  }

  private async waitForReady(options: {
    recipe: Recipe;
    pid: number | null;
    logFilePath: string | null;
    cancel?: AbortSignal;
    timeoutMs?: number;
    fatalPatterns?: string[];
    onProgress?: (elapsedSeconds: number) => Promise<void>;
  }): Promise<{ ready: true } | { ready: false; message: string }> {
    const timeout = options.timeoutMs ?? LIFECYCLE_READY_TIMEOUT_MS;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (options.cancel?.aborted) {
        return { ready: false, message: "Launch cancelled" };
      }

      if (options.pid && !pidExists(options.pid)) {
        const errorTail = options.logFilePath
          ? readFileTailBytes(options.logFilePath, 500)
          : "";
        return {
          ready: false,
          message: `Model ${options.recipe.id} crashed during startup: ${errorTail.slice(-200)}`,
        };
      }

      if (options.logFilePath && options.fatalPatterns && options.fatalPatterns.length > 0) {
        const logTail = readFileTailBytes(options.logFilePath, 3000);
        for (const pattern of options.fatalPatterns) {
          if (!logTail.includes(pattern)) continue;
          const lines = logTail.split("\n");
          const index = lines.findIndex((line) => line.includes(pattern));
          const snippet =
            index >= 0
              ? lines.slice(Math.max(0, index - 1), index + 3).join("\n")
              : pattern;
          return { ready: false, message: `Fatal error: ${snippet.slice(0, 300)}` };
        }
      }

      try {
        const { fetchLocal } = await import("../../../http/local-fetch");
        const response = await fetchLocal(this.deps.config.inference_port, "/health", {
          timeoutMs: 5000,
        });
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

    return {
      ready: false,
      message: `Model ${options.recipe.id} failed to become ready (timeout)`,
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

  private abortRunsForRecipe(recipe: Recipe): void {
    if (!this.deps.abortRunsForModel) return;
    const modelCandidates = [recipe.served_model_name, recipe.id].filter(
      (value): value is string => Boolean(value && value.trim())
    );

    let totalAborted = 0;
    const abortedCandidates = new Set<string>();
    for (const candidate of modelCandidates) {
      const normalized = candidate.trim();
      const canonical = normalized.toLowerCase();
      if (abortedCandidates.has(canonical)) continue;
      abortedCandidates.add(canonical);
      totalAborted += this.deps.abortRunsForModel(normalized);
    }

    if (totalAborted > 0) {
      this.deps.logger.info("Aborted active chat runs for evicted model", {
        recipe_id: recipe.id,
        aborted_runs: totalAborted,
      });
    }
  }

  async ensureActive(
    recipe: Recipe,
    options: { force_evict?: boolean; publish_events?: boolean } = {}
  ): Promise<{ switched: boolean; error: string | null }> {
    const existing = await this.deps.processManager.findInferenceProcess(this.deps.config.inference_port);
    if (existing && isRecipeRunning(recipe, existing)) {
      return { switched: false, error: null };
    }

    const release = await this.switchLock.acquire();
    try {
      const latest = await this.deps.processManager.findInferenceProcess(this.deps.config.inference_port);
      if (latest && isRecipeRunning(recipe, latest)) {
        return { switched: false, error: null };
      }

      const publishEvents = options.publish_events !== false;
      const observedProcess = latest ?? existing;
      const fromRecipe = observedProcess ? this.findRecipeForProcess(observedProcess) : null;
      const fromModel = fromRecipe
        ? fromRecipe.served_model_name ?? fromRecipe.id
        : observedProcess
          ? observedProcess.model_path
          : null;
      const fromBackend = observedProcess?.backend ?? fromRecipe?.backend ?? "unknown";

      if (publishEvents) {
        await this.deps.eventManager.publish(
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

      const evictedRecipe = observedProcess ? this.findRecipeForProcess(observedProcess) : null;
      await this.deps.processManager.evictModel(true);
      if (evictedRecipe) {
        this.abortRunsForRecipe(evictedRecipe);
      }
      await delay(2000);
      const launch = await this.deps.processManager.launchModel(recipe);
      if (!launch.success) {
        const message = `Failed to launch model ${recipe.id}: ${launch.message}`;
        if (publishEvents) {
          await this.deps.eventManager.publish(
            new Event(CONTROLLER_EVENTS.MODEL_SWITCH, {
              status: "error",
              to_recipe_id: recipe.id,
              to_model: recipe.served_model_name ?? recipe.id,
              to_backend: recipe.backend,
              reason: message,
            })
          );
        }
        return { switched: true, error: message };
      }

      const logFilePath = primaryLogPathFor(this.deps.config.data_dir, recipe.id);
      const ready = await this.waitForReady({
        recipe,
        pid: launch.pid,
        logFilePath,
        timeoutMs: LIFECYCLE_READY_TIMEOUT_MS,
      });
      if (ready.ready) {
        if (publishEvents) {
          await this.deps.eventManager.publish(
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
        this.currentRecipe = recipe;
        return { switched: true, error: null };
      }

      if (launch.pid) {
        await this.deps.processManager.killProcess(launch.pid, true);
      }
      if (publishEvents) {
        await this.deps.eventManager.publish(
          new Event(CONTROLLER_EVENTS.MODEL_SWITCH, {
            status: "error",
            to_recipe_id: recipe.id,
            to_model: recipe.served_model_name ?? recipe.id,
            to_backend: recipe.backend,
            reason: ready.message,
          })
        );
      }
      return { switched: true, error: ready.message };
    } finally {
      release();
    }
  }

  getCurrentRecipe(): Recipe | null {
    return this.currentRecipe;
  }

  async getCurrentProcess(): Promise<ProcessInfo | null> {
    return this.deps.processManager.findInferenceProcess(this.deps.config.inference_port);
  }

  // ── Downloads ──

  async startDownload(request: DownloadRequest): Promise<ModelDownload> {
    return await this.deps.downloadManager.start(request);
  }

  pauseDownload(downloadId: string): ModelDownload {
    return this.deps.downloadManager.pause(downloadId);
  }

  resumeDownload(downloadId: string, hfToken?: string | null): ModelDownload {
    return this.deps.downloadManager.resume(downloadId, hfToken ?? null);
  }

  cancelDownload(downloadId: string): ModelDownload {
    return this.deps.downloadManager.cancel(downloadId);
  }

  listDownloads(): ModelDownload[] {
    return this.deps.downloadManager.list();
  }

  getDownload(downloadId: string): ModelDownload | null {
    return this.deps.downloadManager.get(downloadId);
  }

  // ── HuggingFace ──

  async searchHuggingFace(query: string, hfToken?: string | null): Promise<HfModel[]> {
    const info = await fetchHuggingFaceModelInfo(query, undefined, hfToken ?? undefined);
    return [
      {
        id: info.modelId ?? query,
        name: info.modelId ?? query,
      },
    ];
  }

  // ── Runtimes ──

  listRuntimes(): Record<string, RuntimeInfo> {
    const llamacppInfo = getLlamacppRuntimeInfo(this.deps.config);
    const exllamav3Info = getExllamav3RuntimeInfo(this.deps.config);
    return {
      vllm: {
        installed: false,
        version: null,
        python_path: null,
        upgrade_command_available: true,
      },
      sglang: {
        installed: false,
        version: null,
        python_path: this.deps.config.sglang_python ?? null,
        upgrade_command_available: true,
      },
      llamacpp: {
        installed: llamacppInfo.installed,
        version: llamacppInfo.version,
        binary_path: llamacppInfo.binary_path ?? null,
        upgrade_command_available: llamacppInfo.upgrade_command_available ?? false,
      },
      exllamav3: {
        installed: exllamav3Info.installed,
        version: exllamav3Info.version,
        binary_path: exllamav3Info.binary_path ?? null,
        upgrade_command_available: exllamav3Info.upgrade_command_available ?? false,
      },
    };
  }

  async getVllmRuntimeInfoAsync(): Promise<RuntimeInfo> {
    const info = await getVllmRuntimeInfo();
    return {
      installed: info.installed,
      version: info.version,
      python_path: info.python_path,
      binary_path: info.vllm_bin,
      upgrade_command_available: info.upgrade_command_available ?? false,
    };
  }

  async getSglangRuntimeInfoAsync(): Promise<RuntimeInfo> {
    const current = await this.deps.processManager.findInferenceProcess(
      this.deps.config.inference_port
    );
    const info = await getSglangRuntimeInfo(this.deps.config, current);
    return {
      installed: info.installed,
      version: info.version,
      python_path: info.python_path,
      upgrade_command_available: info.upgrade_command_available ?? false,
    };
  }

  async upgradeRuntime(
    runtime: RuntimeType,
    options?: { version?: string; args?: string[] }
  ): Promise<UpgradeResult> {
    switch (runtime) {
      case "vllm": {
        const result = await upgradeVllmRuntime({
          preferBundled: true,
          ...(options?.version ? { version: options.version } : {}),
          ...(options?.args ? { args: options.args as string[] } : {}),
        });
        await this.deps.eventManager.publish(
          new Event(CONTROLLER_EVENTS.RUNTIME_VLLM_UPGRADED, {
            success: result.success,
            version: result.version,
            used_wheel: result.used_wheel,
          })
        );
        return {
          success: result.success,
          version: result.version,
          output: result.output,
          error: result.error,
          used_command: null,
        };
      }
      case "sglang": {
        const result = await upgradeSglangRuntime(this.deps.config, {
          ...(options?.args ? { args: options.args as string[] } : {}),
        });
        await this.deps.eventManager.publish(
          new Event(CONTROLLER_EVENTS.RUNTIME_SGLANG_UPGRADED, {
            success: result.success,
            version: result.version,
            used_command: result.used_command,
          })
        );
        return result;
      }
      case "llamacpp": {
        const result = await upgradeLlamacppRuntime(this.deps.config, {
          ...(options?.args ? { args: options.args as string[] } : {}),
        });
        await this.deps.eventManager.publish(
          new Event(CONTROLLER_EVENTS.RUNTIME_LLAMACPP_UPGRADED, {
            success: result.success,
            version: result.version,
            used_command: result.used_command,
          })
        );
        return result;
      }
      case "cuda": {
        const result = runPlatformUpgrade("cuda", {
          ...(options?.args ? { args: options.args as string[] } : {}),
        });
        await this.deps.eventManager.publish(
          new Event(CONTROLLER_EVENTS.RUNTIME_CUDA_UPGRADED, {
            success: result.success,
            version: result.version,
            used_command: result.used_command,
          })
        );
        return result;
      }
      case "rocm": {
        const result = runPlatformUpgrade("rocm", {
          ...(options?.args ? { args: options.args as string[] } : {}),
        });
        await this.deps.eventManager.publish(
          new Event(CONTROLLER_EVENTS.RUNTIME_ROCM_UPGRADED, {
            success: result.success,
            version: result.version,
            used_command: result.used_command,
          })
        );
        return result;
      }
      default:
        return {
          success: false,
          version: null,
          output: null,
          error: `Unknown runtime: ${runtime}`,
          used_command: null,
        };
    }
  }

  async getRuntimeHelp(
    runtime: "vllm" | "llamacpp"
  ): Promise<{ config: string | null; error: string | null }> {
    if (runtime === "vllm") {
      return getVllmConfigHelp();
    }
    return getLlamacppConfigHelp(this.deps.config);
  }
}

export const createEngineCoordinator = (deps: CoordinatorDeps): EngineCoordinator => {
  return new EngineCoordinator(deps);
};