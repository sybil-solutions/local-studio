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

  const app = new Hono();
  withHttpStatusErrorHandler(app);
  registerEngineRoutes(app, {
    config: { inference_port: port } as Config,
    logger: {} as Logger,
    eventManager: {} as never,
    launchState: {} as never,
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

  return { app, recipes, killed, launched };
};

describe("engine routes", () => {
  it("does not double-evict when evict is immediately followed by launch", async () => {
    const { app, recipes, killed, launched } = createEngineRoutesHarness();

    const evict = app.request("/evict", { method: "POST" });
    const launch = app.request(`/launch/${recipes[1].id}`, { method: "POST" });
    const [evictResponse, launchResponse] = await Promise.all([evict, launch]);

    expect(evictResponse.status).toBe(200);
    expect(await evictResponse.json()).toEqual({ success: true, evicted_pid: null });
    expect(launchResponse.status).toBe(200);
    expect(await launchResponse.json()).toEqual({ success: true, message: "Launch started" });
    expect(killed).toEqual([process.pid]);
    expect(launched).toEqual([recipes[1]]);
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

  it("rejects request-controlled runtime job commands", async () => {
    const { app } = createEngineRoutesHarness();

    const createResponse = await app.request("/runtime/jobs", {
      method: "POST",
      body: JSON.stringify({
        backend: "sglang",
        type: "update",
        command: "/bin/sh",
        args: ["-c", "id"],
      }),
    });

    expect(createResponse.status).toBe(400);
    const payload = (await createResponse.json()) as { error: string };
    expect(payload.error).toContain(
      "Runtime job commands and arguments must be configured server-side"
    );

    const jobsResponse = await app.request("/runtime/jobs");
    const jobsPayload = (await jobsResponse.json()) as { jobs: unknown[] };
    expect(jobsPayload.jobs).toEqual([]);
  });

  it("rejects command overrides on upgrade wrapper routes", async () => {
    const { app } = createEngineRoutesHarness();

    const createResponse = await app.request("/runtime/sglang/upgrade", {
      method: "POST",
      body: JSON.stringify({ command: "/bin/sh" }),
    });

    expect(createResponse.status).toBe(400);
    const payload = (await createResponse.json()) as { error: string };
    expect(payload.error).toContain(
      "Runtime job commands and arguments must be configured server-side"
    );
  });
});
