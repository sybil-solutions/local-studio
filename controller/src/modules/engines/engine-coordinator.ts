import { Effect, Fiber, Semaphore } from "effect";
import type { Config } from "../../config/env";
import { primaryLogPathFor, readFileTailBytes } from "../../core/log-files";
import { fetchLocal } from "../../http/local-fetch";
import type { RecipeStore } from "../models/recipes/recipe-store";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import type { GpuInfo, ProcessInfo, Recipe } from "../models/types";
import type { EventManager } from "../system/event-manager";
import {
  GpuLeaseConflict,
  type GpuLeaseRegistry,
  resolveRecipeGpuUuids,
} from "../system/gpu-leases";
import { resolveNvidiaSmiBinary } from "../system/platform/smi-tools";
import { LIFECYCLE_READY_TIMEOUT_MS } from "./configs";
import { EngineOperationError, getEngineSpec } from "./engine-spec";
import {
  formatLaunchFailureBudgetMessage,
  type LaunchFailureBudget,
} from "./process/launch-failure-budget";
import type { LaunchModelOptions, ProcessManager } from "./process/process-manager";
import { pidExists } from "./process/process-utilities";

export type SetActiveRecipeResult = { ok: true } | { ok: false; error: string };

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
  gpuInfo: () => Effect.Effect<GpuInfo[], unknown>;
  processExists?: (pid: number) => boolean;
  healthProbe?: (path: string) => Effect.Effect<boolean, EngineOperationError>;
  livenessPollIntervalMs?: number;
  requiresNvidiaGpuLeases?: () => boolean;
}

type RecipeGpuLeaseResult =
  | { readonly ok: true; readonly launchOptions: LaunchModelOptions }
  | { readonly ok: false; readonly error: string };

type ReadyResult = { ready: true } | { ready: false; message: string };

const operationError = (operation: string, cause: unknown): EngineOperationError =>
  new EngineOperationError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });

const lifecycleSuccess = (): SetActiveRecipeResult => ({ ok: true });
const lifecycleFailure = (error: string): SetActiveRecipeResult => ({ ok: false, error });

export class EngineCoordinator {
  private readonly switchLock = Semaphore.makeUnsafe(1);
  private activeLifecycleAbort: AbortController | null = null;
  private activeLaunchPid: number | null = null;
  private lifecycleIntentSerial = 0;
  private livenessFiber: Fiber.Fiber<void, never> | null = null;
  private livenessSerial = 0;
  private leaseState: "unknown" | "held" | "released" = "unknown";

  constructor(private readonly deps: CoordinatorDeps) {}

  setActiveRecipe(
    recipe: Recipe | null,
    options: SetActiveRecipeOptions = {},
  ): Effect.Effect<SetActiveRecipeResult, EngineOperationError> {
    return Effect.suspend(() => {
      const intentSerial = ++this.lifecycleIntentSerial;
      this.activeLifecycleAbort?.abort();
      const preempt =
        !recipe && this.activeLaunchPid
          ? this.deps.processManager.killProcess(this.activeLaunchPid, true).pipe(Effect.asVoid)
          : Effect.void;
      return preempt.pipe(
        Effect.flatMap(() =>
          this.switchLock.withPermit(this.runLifecycle(recipe, options, intentSerial)),
        ),
      );
    });
  }

  private runLifecycle(
    recipe: Recipe | null,
    options: SetActiveRecipeOptions,
    intentSerial: number,
  ): Effect.Effect<SetActiveRecipeResult, EngineOperationError> {
    let spawnedPid: number | null = null;
    let cancelled = false;
    let leaseOwned = false;
    let retainLease = false;
    const lifecycleAbort = recipe ? new AbortController() : null;
    const abortLifecycle = (): void => lifecycleAbort?.abort();
    if (lifecycleAbort) {
      if (options.signal?.aborted) lifecycleAbort.abort();
      options.signal?.addEventListener("abort", abortLifecycle, { once: true });
      this.activeLifecycleAbort = lifecycleAbort;
    }
    const isAborted = (): boolean =>
      Boolean(lifecycleAbort?.signal.aborted || intentSerial !== this.lifecycleIntentSerial);
    const coordinator = this;
    const relinquishLease = (): Effect.Effect<void, EngineOperationError> =>
      leaseOwned
        ? Effect.gen(function* () {
            if (spawnedPid) yield* coordinator.deps.processManager.killProcess(spawnedPid, true);
            yield* coordinator.releaseLlmGpuLeaseAfterStop(spawnedPid);
            leaseOwned = false;
          })
        : Effect.void;
    const publishCancelled = (
      targetRecipe: Recipe,
    ): Effect.Effect<SetActiveRecipeResult, EngineOperationError> =>
      Effect.gen(function* () {
        if (cancelled) return lifecycleFailure("Launch cancelled");
        cancelled = true;
        yield* relinquishLease();
        yield* coordinator.publishLaunchProgress(
          targetRecipe.id,
          "cancelled",
          "Launch cancelled",
          0,
        );
        return lifecycleFailure("Launch cancelled");
      });
    const abortIfNeeded = (
      targetRecipe: Recipe | null,
    ): Effect.Effect<SetActiveRecipeResult | null, EngineOperationError> =>
      isAborted() && targetRecipe ? publishCancelled(targetRecipe) : Effect.succeed(null);

    return Effect.gen(function* () {
      if (recipe && intentSerial !== coordinator.lifecycleIntentSerial) {
        return lifecycleFailure("Launch cancelled");
      }
      yield* coordinator.stopLivenessMonitor();
      const current = yield* coordinator.deps.processManager.findInferenceProcess(
        coordinator.deps.config.inference_port,
      );
      const initialAbort = yield* abortIfNeeded(recipe);
      if (initialAbort) return initialAbort;
      if (!recipe && !current) {
        return (yield* coordinator.releaseLlmGpuLeaseAfterStop(null))
          ? lifecycleSuccess()
          : lifecycleFailure("Inference workers are still stopping");
      }
      if (recipe && current && isRecipeRunning(recipe, current)) {
        const lease = yield* coordinator.prepareRecipeGpuLease(recipe);
        if (!lease.ok) return lease;
        leaseOwned = true;
        retainLease = true;
        yield* coordinator.startLivenessMonitor(current.pid);
        return lifecycleSuccess();
      }
      if (current && (!recipe || !isRecipeRunning(recipe, current))) {
        const stopped = yield* coordinator.killCurrent(current);
        if (!stopped) {
          yield* coordinator.startLivenessMonitor(current.pid);
          return lifecycleFailure(`Failed to stop process ${current.pid}`);
        }
        if (!(yield* coordinator.releaseLlmGpuLeaseAfterStop(current.pid))) {
          return lifecycleFailure("Inference workers are still stopping");
        }
        yield* Effect.sleep(500);
      }
      const postEvictAbort = yield* abortIfNeeded(recipe);
      if (postEvictAbort) return postEvictAbort;
      if (!recipe) {
        yield* coordinator.releaseLlmGpuLease();
        return lifecycleSuccess();
      }
      const lease = yield* coordinator.prepareRecipeGpuLease(recipe);
      if (!lease.ok) return lease;
      leaseOwned = true;
      const blocked = coordinator.deps.launchFailureBudget.isBlocked(recipe.id);
      if (blocked) {
        yield* relinquishLease();
        const message = formatLaunchFailureBudgetMessage(blocked);
        yield* coordinator.publishLaunchProgress(recipe.id, "error", message, 0);
        return lifecycleFailure(message);
      }
      yield* coordinator.publishLaunchProgress(
        recipe.id,
        "launching",
        `Starting ${recipe.name}...`,
        0.25,
      );
      const launch = yield* coordinator.deps.processManager.launchModel(
        recipe,
        lease.launchOptions,
      );
      spawnedPid = launch.pid;
      coordinator.activeLaunchPid = launch.pid;
      if (!launch.success) {
        yield* relinquishLease();
        const failure = coordinator.deps.launchFailureBudget.recordFailure(recipe.id);
        yield* coordinator.publishLaunchProgress(
          recipe.id,
          "error",
          `${launch.message} (${failure.failure_count}/${failure.limit} launch failures in the current window)`,
          0,
        );
        return lifecycleFailure(launch.message);
      }
      const postLaunchAbort = yield* abortIfNeeded(recipe);
      if (postLaunchAbort) return postLaunchAbort;
      yield* coordinator.publishLaunchProgress(recipe.id, "waiting", "Loading model... (0s)", 0.5);
      const ready = yield* coordinator.waitForReady({
        recipe,
        pid: launch.pid,
        logFilePath:
          launch.log_file ?? primaryLogPathFor(coordinator.deps.config.data_dir, recipe.id),
        ...(lifecycleAbort ? { cancel: lifecycleAbort.signal } : {}),
        timeoutMs: LIFECYCLE_READY_TIMEOUT_MS,
      });
      if (isAborted()) return yield* publishCancelled(recipe);
      if (ready.ready) {
        coordinator.deps.launchFailureBudget.reset(recipe.id);
        yield* coordinator.publishLaunchProgress(recipe.id, "ready", "Model is ready!", 1);
        if (launch.pid) yield* coordinator.startLivenessMonitor(launch.pid);
        retainLease = true;
        return lifecycleSuccess();
      }
      yield* relinquishLease();
      const failure = coordinator.deps.launchFailureBudget.recordFailure(recipe.id);
      yield* coordinator.publishLaunchProgress(
        recipe.id,
        "error",
        `${ready.message} (${failure.failure_count}/${failure.limit} launch failures in the current window)`,
        0,
      );
      return lifecycleFailure(ready.message);
    }).pipe(
      Effect.onExit(() => (!retainLease && leaseOwned ? relinquishLease() : Effect.void)),
      Effect.ensuring(
        Effect.sync(() => {
          if (this.activeLifecycleAbort === lifecycleAbort) this.activeLifecycleAbort = null;
          if (this.activeLaunchPid === spawnedPid) this.activeLaunchPid = null;
          options.signal?.removeEventListener("abort", abortLifecycle);
        }),
      ),
    );
  }

  private killCurrent(current: ProcessInfo): Effect.Effect<boolean, EngineOperationError> {
    const coordinator = this;
    return Effect.gen(function* () {
      const evictedRecipe = yield* coordinator.findRecipeForProcess(current);
      if (evictedRecipe) {
        yield* coordinator.publishLaunchProgress(
          evictedRecipe.id,
          "stopping",
          `Stopping ${evictedRecipe.name}...`,
          0.1,
        );
      }
      const stopped = yield* coordinator.deps.processManager.killProcess(current.pid, true);
      if (evictedRecipe) {
        yield* coordinator.publishLaunchProgress(
          evictedRecipe.id,
          stopped ? "stopped" : "error",
          stopped ? "Model stopped" : "Model did not stop cleanly",
          stopped ? 1 : 0,
        );
      }
      return stopped;
    });
  }

  private probeHealth(path: string): Effect.Effect<boolean, EngineOperationError> {
    if (this.deps.healthProbe) return this.deps.healthProbe(path);
    return fetchLocal(this.deps.config.inference_port, path, {
      host: this.deps.config.inference_host,
      timeoutMs: 5000,
    }).pipe(
      Effect.mapError((cause) => operationError("probe-engine-health", cause)),
      Effect.map((response) => response.status === 200),
      Effect.catch(() => Effect.succeed(false)),
    );
  }

  private pollHealthy(options: {
    healthPath: string;
    timeoutMs: number;
    failure?: () => string | null;
  }): Effect.Effect<{ ready: boolean; message: string | null }, EngineOperationError> {
    const coordinator = this;
    return Effect.gen(function* () {
      const start = Date.now();
      while (Date.now() - start < options.timeoutMs) {
        const failed = options.failure?.();
        if (failed) return { ready: false, message: failed };
        if (yield* coordinator.probeHealth(options.healthPath))
          return { ready: true, message: null };
        yield* Effect.sleep(2000);
      }
      return { ready: false, message: null };
    });
  }

  waitForHealthy(timeoutMs: number): Effect.Effect<boolean, EngineOperationError> {
    return this.pollHealthy({ healthPath: "/health", timeoutMs }).pipe(
      Effect.map((result) => result.ready),
    );
  }

  private waitForReady(options: {
    recipe: Recipe;
    pid: number | null;
    logFilePath: string | null;
    cancel?: AbortSignal;
    timeoutMs?: number;
  }): Effect.Effect<ReadyResult, EngineOperationError> {
    return this.pollHealthy({
      healthPath: getEngineSpec(options.recipe.backend).healthPath,
      timeoutMs: options.timeoutMs ?? LIFECYCLE_READY_TIMEOUT_MS,
      failure: () => {
        if (options.cancel?.aborted) return "Launch cancelled";
        if (options.pid && !this.processExists(options.pid)) {
          const tail = options.logFilePath ? readFileTailBytes(options.logFilePath, 500) : "";
          return `Model ${options.recipe.id} crashed during startup: ${tail.slice(-200)}`;
        }
        return null;
      },
    }).pipe(
      Effect.map((result) =>
        result.ready
          ? { ready: true }
          : {
              ready: false,
              message:
                result.message ?? `Model ${options.recipe.id} failed to become ready (timeout)`,
            },
      ),
    );
  }

  private findRecipeForProcess(
    current: ProcessInfo,
  ): Effect.Effect<Recipe | null, EngineOperationError> {
    return this.deps.recipeStore.list().pipe(
      Effect.mapError((cause) => operationError("list-recipes", cause)),
      Effect.map(
        (recipes) =>
          recipes.find((candidate) =>
            isRecipeRunning(candidate, current, { allowEitherPathContains: true }),
          ) ?? null,
      ),
    );
  }

  resetLaunchFailureBudget(recipeId: string): void {
    this.deps.launchFailureBudget.reset(recipeId);
  }

  getCurrentProcess(): Effect.Effect<ProcessInfo | null> {
    return this.deps.processManager.findInferenceProcess(this.deps.config.inference_port);
  }

  getCurrentRecipe(): Effect.Effect<Recipe | null> {
    return this.getCurrentProcess().pipe(
      Effect.flatMap((current) =>
        current ? this.findRecipeForProcess(current) : Effect.succeed(null),
      ),
      Effect.catch(() => Effect.succeed(null)),
    );
  }

  shutdown(): Effect.Effect<void, EngineOperationError> {
    return Effect.suspend(() => {
      this.lifecycleIntentSerial += 1;
      this.activeLifecycleAbort?.abort();
      const launchPid = this.activeLaunchPid;
      const preempt = launchPid
        ? this.deps.processManager.killProcess(launchPid, true).pipe(Effect.asVoid)
        : Effect.void;
      const coordinator = this;
      return preempt.pipe(
        Effect.flatMap(() =>
          coordinator.switchLock.withPermit(
            Effect.gen(function* () {
              yield* coordinator.stopLivenessMonitor();
              const current = yield* coordinator.deps.processManager.findInferenceProcess(
                coordinator.deps.config.inference_port,
              );
              if (current) yield* coordinator.deps.processManager.killProcess(current.pid, true);
              yield* coordinator.deps.processManager.shutdown();
              const stopped = yield* coordinator.confirmInferenceStopped();
              if (!stopped) {
                return yield* Effect.fail(
                  operationError("shutdown-engine", "Inference workers are still running"),
                );
              }
              yield* coordinator.releaseLlmGpuLease();
              coordinator.activeLifecycleAbort = null;
              coordinator.activeLaunchPid = null;
            }),
          ),
        ),
      );
    });
  }

  private releaseLlmGpuLease(): Effect.Effect<void, EngineOperationError> {
    if (this.leaseState === "released") return Effect.void;
    return this.deps.gpuLeaseRegistry.release("llm").pipe(
      Effect.asVoid,
      Effect.mapError((cause) => operationError("release-llm-gpu-lease", cause)),
      Effect.tap(() =>
        Effect.sync(() => {
          this.leaseState = "released";
        }),
      ),
    );
  }

  private prepareRecipeGpuLease(
    recipe: Recipe,
  ): Effect.Effect<RecipeGpuLeaseResult, EngineOperationError> {
    const coordinator = this;
    return Effect.gen(function* () {
      const gpuInfo = yield* coordinator.deps
        .gpuInfo()
        .pipe(Effect.mapError((cause) => operationError("get-gpu-info", cause)));
      const resolution = resolveRecipeGpuUuids(recipe, gpuInfo);
      if (resolution.unresolvedTokens.length > 0) {
        return {
          ok: false,
          error: `Cannot resolve GPU selectors: ${resolution.unresolvedTokens.join(", ")}`,
        } as const;
      }
      if (
        resolution.source === "all" &&
        resolution.uuids.length === 0 &&
        coordinator.requiresNvidiaGpuLeases()
      ) {
        return {
          ok: false,
          error: "Cannot verify GPU isolation for an implicit all-GPU launch",
        } as const;
      }
      const claimedUuids = resolution.uuids;
      const launchOptions: LaunchModelOptions =
        resolution.source === "recipe" || claimedUuids.length > 0 ? { gpuUuids: claimedUuids } : {};
      const claimed = yield* coordinator.deps.gpuLeaseRegistry.replace("llm", claimedUuids).pipe(
        Effect.as({ ok: true, launchOptions } as const),
        Effect.catch((error) =>
          Effect.succeed({
            ok: false,
            error:
              error instanceof GpuLeaseConflict
                ? "The selected model GPU is reserved by local speech"
                : error instanceof Error
                  ? error.message
                  : String(error),
          } as const),
        ),
      );
      if (claimed.ok) coordinator.leaseState = "held";
      return claimed;
    });
  }

  private stopLivenessMonitor(): Effect.Effect<void> {
    this.livenessSerial += 1;
    const fiber = this.livenessFiber;
    this.livenessFiber = null;
    return fiber ? Fiber.interrupt(fiber).pipe(Effect.asVoid) : Effect.void;
  }

  private confirmInferenceStopped(): Effect.Effect<boolean> {
    return this.deps.processManager
      .confirmInferenceStopped(this.deps.config.inference_port)
      .pipe(Effect.catch(() => Effect.succeed(false)));
  }

  private releaseLlmGpuLeaseAfterStop(
    pid: number | null,
  ): Effect.Effect<boolean, EngineOperationError> {
    const coordinator = this;
    return Effect.gen(function* () {
      if (!(yield* coordinator.confirmInferenceStopped())) {
        yield* coordinator.startLivenessMonitor(pid);
        return false;
      }
      yield* coordinator.releaseLlmGpuLease();
      return true;
    });
  }

  private startLivenessMonitor(pid: number | null): Effect.Effect<void> {
    const serial = ++this.livenessSerial;
    const interval = this.deps.livenessPollIntervalMs ?? 1_000;
    const coordinator = this;
    const monitor = Effect.gen(function* () {
      while (true) {
        yield* Effect.sleep(interval);
        if (pid && coordinator.processExists(pid)) continue;
        if (yield* coordinator.confirmInferenceStopped()) break;
      }
      if (serial !== coordinator.livenessSerial) return;
      yield* coordinator.deps.gpuLeaseRegistry.release("llm");
      coordinator.leaseState = "released";
    }).pipe(
      Effect.catch(() => Effect.void),
      Effect.ensuring(
        Effect.sync(() => {
          if (serial === coordinator.livenessSerial) coordinator.livenessFiber = null;
        }),
      ),
    );
    return monitor.pipe(
      Effect.forkDetach({ startImmediately: true }),
      Effect.tap((fiber) =>
        Effect.sync(() => {
          this.livenessFiber = fiber;
        }),
      ),
      Effect.asVoid,
    );
  }

  private publishLaunchProgress(
    recipeId: string,
    stage: string,
    message: string,
    progress?: number,
  ): Effect.Effect<void, EngineOperationError> {
    return this.deps.eventManager.publishLaunchProgress(recipeId, stage, message, progress);
  }

  private processExists(pid: number): boolean {
    return (this.deps.processExists ?? pidExists)(pid);
  }

  private requiresNvidiaGpuLeases(): boolean {
    if (this.deps.requiresNvidiaGpuLeases) return this.deps.requiresNvidiaGpuLeases();
    return Boolean(resolveNvidiaSmiBinary() || process.env["LOCAL_STUDIO_SPEECH_GPU_UUID"]?.trim());
  }
}
