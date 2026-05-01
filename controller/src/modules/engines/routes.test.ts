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
import { EngineCoordinator } from "./layers/engine-coordinator";
import type { ProcessManager } from "./layers/process-manager";
import { registerEngineRoutes } from "./routes";

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
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
    jobManager: {} as never,
    stores: {
      recipeStore: {
        list: () => recipes,
        get: (id: string) => recipes.find((candidate) => candidate.id === id) ?? null,
      } as never,
      downloadStore: {} as never,
      peakMetricsStore: {} as never,
      lifetimeMetricsStore: {} as never,
      jobStore: {} as never,
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
});
