import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { AppContext } from "../src/app-context";
import type { ControllerRuntime } from "../src/core/effect-runtime";
import type { createApp } from "../src/http/app";
import { EngineCoordinator } from "../src/modules/engines/engine-coordinator";
import { parseRecipe } from "../src/modules/models/recipes/recipe-serializer";

const environmentKeys = [
  "LOCAL_STUDIO_API_KEY",
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_DB_PATH",
  "LOCAL_STUDIO_HOST",
  "LOCAL_STUDIO_INFERENCE_PORT",
  "LOCAL_STUDIO_LOG_LEVEL",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_PORT",
  "LOCAL_STUDIO_SPEECH_DATA_DIR",
] as const;

interface Barrier {
  readonly release: () => void;
  readonly wait: () => Promise<void>;
}

interface Harness {
  readonly app: ReturnType<typeof createApp>;
  readonly context: AppContext;
  readonly runtime: ControllerRuntime;
}

let directory = "";
let environmentSnapshot = new Map<string, string | undefined>();
const runtimes: ControllerRuntime[] = [];

const barrier = (): Barrier => {
  let releaseBarrier: () => void = () => undefined;
  const completion = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  return { release: releaseBarrier, wait: () => completion };
};

const recipe = (id: string): ReturnType<typeof parseRecipe> =>
  parseRecipe({
    id,
    name: id,
    model_path: join(directory, "models", id),
    env_vars: { CUDA_VISIBLE_DEVICES: "" },
  });

const harness = async (): Promise<Harness> => {
  const [{ AppContextService }, { createControllerRuntime }, { createApp }] = await Promise.all([
    import("../src/app-context"),
    import("../src/core/effect-runtime"),
    import("../src/http/app"),
  ]);
  const runtime = createControllerRuntime();
  runtimes.push(runtime);
  const context = await runtime.runPromise(AppContextService);
  return { app: createApp(context, runtime), context, runtime };
};

beforeEach(() => {
  environmentSnapshot = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  directory = mkdtempSync(join(tmpdir(), "local-studio-launch-acceptance-"));
  Object.assign(process.env, {
    LOCAL_STUDIO_DATA_DIR: directory,
    LOCAL_STUDIO_DB_PATH: join(directory, "controller.db"),
    LOCAL_STUDIO_HOST: "127.0.0.1",
    LOCAL_STUDIO_INFERENCE_PORT: "65534",
    LOCAL_STUDIO_LOG_LEVEL: "error",
    LOCAL_STUDIO_MODELS_DIR: join(directory, "models"),
    LOCAL_STUDIO_PORT: "18080",
    LOCAL_STUDIO_SPEECH_DATA_DIR: join(directory, "speech"),
  });
  delete process.env["LOCAL_STUDIO_API_KEY"];
});

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
  for (const key of environmentKeys) {
    const value = environmentSnapshot.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Effect.runPromise(Effect.sleep(25));
  rmSync(directory, { recursive: true, force: true });
});

test("admits one launch before process discovery can race", async () => {
  const { app, context, runtime } = await harness();
  const firstRecipe = recipe("atomic-launch-a");
  const secondRecipe = recipe("atomic-launch-b");
  await runtime.runPromise(
    Effect.all([
      context.stores.recipeStore.save(firstRecipe),
      context.stores.recipeStore.save(secondRecipe),
    ]),
  );
  const discoveryEntered = barrier();
  const discoveryRelease = barrier();
  const coordinatorAttempts: string[] = [];
  let discoveryCalls = 0;
  context.processManager.findInferenceProcess = () =>
    Effect.promise(async () => {
      discoveryCalls += 1;
      discoveryEntered.release();
      await discoveryRelease.wait();
      return null;
    });
  context.engineService.setActiveRecipe = (target, options) =>
    Effect.sync(() => {
      if (!target || !options.attemptId) throw new Error("Expected an attempt-owned launch");
      coordinatorAttempts.push(options.attemptId);
      return { ok: true } as const;
    });

  const acceptedPromise = app.request(`/launch/${firstRecipe.id}`, { method: "POST" });
  await discoveryEntered.wait();
  const attempt = context.launchState.getActiveAttempt();
  if (!attempt) throw new Error("Expected an active launch attempt");
  const sameConflict = await app.request(`/launch/${firstRecipe.id}`, { method: "POST" });
  const differentConflict = await app.request(`/launch/${secondRecipe.id}`, { method: "POST" });
  discoveryRelease.release();
  const accepted = await acceptedPromise;

  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({
    success: true,
    message: "Launch started",
    attempt_id: attempt.attemptId,
  });
  expect(sameConflict.status).toBe(409);
  expect(await sameConflict.json()).toEqual({
    detail: `Launch already in progress for ${firstRecipe.id}`,
  });
  expect(differentConflict.status).toBe(409);
  expect(await differentConflict.json()).toEqual({
    detail: `Launch already in progress for ${firstRecipe.id}; refusing to queue ${secondRecipe.id}`,
  });
  expect(discoveryCalls).toBe(1);
  expect(coordinatorAttempts).toEqual([attempt.attemptId]);
  expect(context.launchState.getState()).toEqual({ phase: "idle", recipeId: null });
});

test("cancels the exact attempt and rejects its token after a successor starts", async () => {
  const { app, context, runtime } = await harness();
  const targetRecipe = recipe("same-recipe-successor");
  await runtime.runPromise(context.stores.recipeStore.save(targetRecipe));
  context.processManager.findInferenceProcess = () => Effect.succeed(null);
  const firstEntered = barrier();
  const firstAborted = barrier();
  const firstCompletion = barrier();
  const successorEntered = barrier();
  const successorCompletion = barrier();
  const cancelledAttempts: string[] = [];
  let launchCalls = 0;
  let successorSignal: AbortSignal | undefined;
  context.engineService.setActiveRecipe = (target, options) =>
    Effect.promise(async () => {
      if (!target || !options.attemptId || !options.signal) {
        throw new Error("Expected an attempt-owned cancellable launch");
      }
      launchCalls += 1;
      if (launchCalls === 1) {
        options.signal.addEventListener("abort", firstAborted.release, { once: true });
        if (options.signal.aborted) firstAborted.release();
        firstEntered.release();
        await firstAborted.wait();
        await firstCompletion.wait();
        return { ok: false, error: "Launch cancelled" } as const;
      }
      successorSignal = options.signal;
      successorEntered.release();
      await successorCompletion.wait();
      return { ok: true } as const;
    });
  context.engineService.cancelLaunch = (attemptId) =>
    Effect.sync(() => {
      cancelledAttempts.push(attemptId);
      return { ok: true, matched: true } as const;
    });

  const firstLaunchPromise = app.request(`/launch/${targetRecipe.id}`, { method: "POST" });
  await firstEntered.wait();
  const firstAttempt = context.launchState.getActiveAttempt();
  if (!firstAttempt) throw new Error("Expected the first launch attempt");
  const cancellationPromise = app.request(
    `/launch/${targetRecipe.id}/cancel?attempt_id=${firstAttempt.attemptId}`,
    { method: "POST" },
  );
  await firstAborted.wait();
  expect(context.launchState.getActiveAttempt()).toEqual(firstAttempt);
  firstCompletion.release();
  const [firstLaunch, cancellation] = await Promise.all([
    firstLaunchPromise,
    cancellationPromise,
  ]);
  expect(firstLaunch.status).toBe(400);
  expect(cancellation.status).toBe(200);

  const successorPromise = app.request(`/launch/${targetRecipe.id}`, { method: "POST" });
  await successorEntered.wait();
  const successorAttempt = context.launchState.getActiveAttempt();
  if (!successorAttempt) throw new Error("Expected a successor launch attempt");
  expect(successorAttempt.attemptId).not.toBe(firstAttempt.attemptId);
  const staleCancellation = await app.request(
    `/launch/${targetRecipe.id}/cancel?attempt_id=${firstAttempt.attemptId}`,
    { method: "POST" },
  );
  expect(staleCancellation.status).toBe(409);
  expect(await staleCancellation.json()).toEqual({ detail: "Launch attempt is no longer active" });
  expect(cancelledAttempts).toEqual([firstAttempt.attemptId]);
  expect(successorSignal?.aborted).toBe(false);
  successorCompletion.release();
  expect((await successorPromise).status).toBe(200);
  expect(context.launchState.getState()).toEqual({ phase: "idle", recipeId: null });
});

test("coordinator cancellation ignores a foreign attempt token", async () => {
  const { context, runtime } = await harness();
  const targetRecipe = recipe("coordinator-owner");
  const healthEntered = barrier();
  const healthRelease = barrier();
  let killCalls = 0;
  context.processManager.findInferenceProcess = () => Effect.succeed(null);
  context.processManager.launchModel = () =>
    Effect.succeed({ success: true, pid: 9301, message: "started", log_file: null });
  context.processManager.killOwnedProcess = () =>
    Effect.sync(() => {
      killCalls += 1;
      return true;
    });
  context.processManager.confirmInferenceStopped = () => Effect.succeed(true);
  const engine = new EngineCoordinator({
    config: context.config,
    eventManager: context.eventManager,
    processManager: context.processManager,
    recipeStore: context.stores.recipeStore,
    launchFailureBudget: context.launchFailureBudget,
    gpuLeaseRegistry: context.gpuLeaseRegistry,
    gpuInfo: () => Effect.succeed([]),
    processExists: () => true,
    healthProbe: () =>
      Effect.promise(async () => {
        healthEntered.release();
        await healthRelease.wait();
        return true;
      }),
    requiresNvidiaGpuLeases: () => false,
  });

  const launchPromise = runtime.runPromise(
    engine.setActiveRecipe(targetRecipe, { attemptId: "attempt-a" }),
  );
  await healthEntered.wait();
  expect(await runtime.runPromise(engine.cancelLaunch("attempt-b"))).toEqual({
    ok: true,
    matched: false,
  });
  expect(killCalls).toBe(0);
  const cancellationPromise = runtime.runPromise(engine.cancelLaunch("attempt-a"));
  healthRelease.release();
  const [launchResult, cancellationResult] = await Promise.all([
    launchPromise,
    cancellationPromise,
  ]);
  expect(launchResult).toEqual({ ok: false, error: "Launch cancelled" });
  expect(cancellationResult).toEqual({ ok: true, matched: true });
  expect(killCalls).toBeGreaterThan(0);
  expect(await runtime.runPromise(engine.cancelLaunch("attempt-a"))).toEqual({
    ok: true,
    matched: false,
  });
});
