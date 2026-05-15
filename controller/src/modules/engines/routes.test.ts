// CRITICAL
import { afterEach, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "../../config/env";
import { HttpStatus } from "../../core/errors";
import type { Logger } from "../../core/logger";
import type { AppContext } from "../../types/context";
import type { ProcessInfo, Recipe, LaunchResult } from "../models/types";
import { EngineCoordinator } from "./engine-coordinator";
import { clearEngineJobsForTests } from "./runtimes/engine-jobs";
import type { ProcessManager } from "./process/process-manager";
import { createLaunchState } from "./process/launch-state";
import { registerEngineRoutes } from "./routes";

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
  clearEngineJobsForTests();
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

const withHttpStatusErrorHandler = (app: Hono): void => {
  app.onError((error, ctx: Context) => {
    if (error instanceof HttpStatus) {
      return ctx.json({ error: String(error) }, { status: error.status });
    }
    return ctx.json({ error: String(error) }, { status: 500 });
  });
};

const recipe = (id: string): Recipe =>
  ({
    id,
    name: id,
    backend: "vllm",
    model_path: `/models/${id}`,
    served_model_name: id,
  }) as Recipe;

const processFor = (activeRecipe: Recipe, port: number): ProcessInfo => ({
  pid: process.pid,
  backend: activeRecipe.backend,
  model_path: activeRecipe.model_path,
  port,
  served_model_name: activeRecipe.served_model_name ?? null,
});

const createEngineRoutesHarness = (): {
  app: Hono;
  recipes: [Recipe, Recipe];
  killed: number[];
  launched: Recipe[];
  launchState: ReturnType<typeof createLaunchState>;
} => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("ok", { status: 200 }),
  });
  servers.push(server);

  const port = server.port;
  if (port === undefined) {
    throw new Error("Test server did not bind a port");
  }

  const recipes: [Recipe, Recipe] = [recipe("alpha"), recipe("beta")];
  let current: ProcessInfo | null = processFor(recipes[0], port);
  const killed: number[] = [];
  const launched: Recipe[] = [];

  const processManager: ProcessManager = {
    findInferenceProcess: async () => current,
    launchModel: async (targetRecipe): Promise<LaunchResult> => {
      launched.push(targetRecipe);
      current = processFor(targetRecipe, port);
      return {
        success: true,
        pid: current.pid,
        message: "Process started",
        log_file: join(tmpdir(), `${targetRecipe.id}.log`),
      };
    },
    evictModel: async () => {
      const pid = current?.pid ?? null;
      if (pid !== null) killed.push(pid);
      current = null;
      return pid;
    },
    killProcess: async (pid) => {
      killed.push(pid);
      current = null;
      return true;
    },
  };

  const coordinator = new EngineCoordinator({
    config: {
      inference_port: port,
      data_dir: tmpdir(),
    } as Config,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as Logger,
    eventManager: {
      publishLaunchProgress: async () => {},
      publish: async () => {},
    } as never,
    processManager,
    recipeStore: {
      list: () => recipes,
      get: (id: string) => recipes.find((candidate) => candidate.id === id) ?? null,
    } as never,
    downloadManager: {
      listDownloads: (): unknown[] => [],
    } as never,
    abortRunsForModel: (): number => 0,
  });

  const launchState = createLaunchState();
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as Logger;
  const app = new Hono();
  withHttpStatusErrorHandler(app);
  registerEngineRoutes(app, {
    config: { inference_port: port } as Config,
    logger,
    eventManager: {} as never,
    launchState,
    metrics: {} as never,
    metricsRegistry: {} as never,
    processManager,
    downloadManager: {} as never,
    engineService: coordinator,
    stores: {
      recipeStore: {
        list: () => recipes,
        get: (id: string) => recipes.find((candidate) => candidate.id === id) ?? null,
      } as never,
      downloadStore: {} as never,
      peakMetricsStore: {} as never,
      lifetimeMetricsStore: {} as never,
      inferenceRequestStore: {} as never,
    },
  } as AppContext);

  return { app, recipes, killed, launched, launchState };
};

describe("engine routes", () => {
  it("launches after an explicit evict completes", async () => {
    const { app, recipes, killed, launched } = createEngineRoutesHarness();

    const evictResponse = await app.request("/evict", { method: "POST" });
    const launchResponse = await app.request(`/launch/${recipes[1].id}`, { method: "POST" });

    expect(evictResponse.status).toBe(200);
    expect(await evictResponse.json()).toEqual({ success: true, evicted_pid: null });
    expect(launchResponse.status).toBe(200);
    expect(await launchResponse.json()).toEqual({ success: true, message: "Launch started" });
    expect(killed).toEqual([process.pid]);
    expect(launched).toEqual([recipes[1]]);
  });

  it("rejects launching a different recipe while a launch is already in progress", async () => {
    const { app, recipes, launched, launchState } = createEngineRoutesHarness();
    launchState.markLaunching(recipes[0].id);

    const response = await app.request(`/launch/${recipes[1].id}`, { method: "POST" });

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain(`refusing to queue ${recipes[1].id}`);
    expect(launched).toEqual([]);
    expect(launchState.getLaunchingRecipeId()).toBe(recipes[0].id);
  });

  it("rejects launching a different recipe while another model is already running", async () => {
    const { app, recipes, launched, killed } = createEngineRoutesHarness();

    const response = await app.request(`/launch/${recipes[1].id}`, { method: "POST" });

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("is already running");
    expect(payload.error).toContain(`before launching ${recipes[1].id}`);
    expect(launched).toEqual([]);
    expect(killed).toEqual([]);
  });

  it("creates and exposes runtime jobs from upgrade wrappers", async () => {
    const { app } = createEngineRoutesHarness();

    const createResponse = await app.request("/runtime/llamacpp/upgrade", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(createResponse.status).toBe(200);
    const createPayload = (await createResponse.json()) as { job_id: string };
    expect(createPayload.job_id).toBeTruthy();

    const jobResponse = await app.request(`/runtime/jobs/${createPayload.job_id}`);
    expect(jobResponse.status).toBe(200);
    const jobPayload = (await jobResponse.json()) as {
      job: { id: string; type: string; message: string };
    };
    expect(jobPayload.job.id).toBe(createPayload.job_id);
    expect(jobPayload.job.type).toBe("update");
    expect(jobPayload.job.message.length).toBeGreaterThan(0);
  });

  it("rejects request-controlled commands for runtime jobs", async () => {
    const { app } = createEngineRoutesHarness();

    const response = await app.request("/runtime/jobs", {
      method: "POST",
      body: JSON.stringify({
        backend: "sglang",
        type: "update",
        command: "/bin/sh",
        args: ["-c", "id"],
      }),
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("Runtime job command and args are server-controlled");
  });

  it("rejects request-controlled args for runtime upgrade wrappers", async () => {
    const { app } = createEngineRoutesHarness();

    const response = await app.request("/runtime/llamacpp/upgrade", {
      method: "POST",
      body: JSON.stringify({ args: ["--post-install-hook=/bin/sh"] }),
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain("Runtime job command and args are server-controlled");
  });
});
