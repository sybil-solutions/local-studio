// CRITICAL
import { afterEach, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../../config/env";
import type { Logger } from "../../../core/logger";
import type { Recipe, ProcessInfo, LaunchResult } from "../../models/types";
import { EngineCoordinator } from "./engine-coordinator";
import type { ProcessManager } from "./process-manager";

const servers: Array<ReturnType<typeof Bun.serve>> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

const recipe = (id: string, modelPath: string): Recipe =>
  ({
    id,
    name: id,
    backend: "vllm",
    model_path: modelPath,
    served_model_name: id,
  }) as Recipe;

const processFor = (activeRecipe: Recipe, port: number): ProcessInfo => ({
  pid: process.pid,
  backend: activeRecipe.backend,
  model_path: activeRecipe.model_path,
  port,
  served_model_name: activeRecipe.served_model_name ?? null,
});

const createCoordinator = (initialRecipe: Recipe | null = null, healthStatus: number = 200): {
  coordinator: EngineCoordinator;
  recipes: [Recipe, Recipe];
  launched: Recipe[];
  killed: number[];
  events: Array<{ recipeId: string; stage: string; message: string; progress?: number }>;
  abortedModels: string[];
} => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response("ok", { status: healthStatus }),
  });
  servers.push(server);

  const port = server.port;
  if (port === undefined) {
    throw new Error("Test server did not bind a port");
  }
  const recipes: [Recipe, Recipe] = [recipe("alpha", "/models/alpha"), recipe("beta", "/models/beta")];
  let current = initialRecipe ? processFor(initialRecipe, port) : null;
  const launched: Recipe[] = [];
  const killed: number[] = [];
  const events: Array<{ recipeId: string; stage: string; message: string; progress?: number }> = [];
  const abortedModels: string[] = [];

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
      publishLaunchProgress: async (recipeId: string, stage: string, message: string, progress?: number) => {
        events.push({
          recipeId,
          stage,
          message,
          ...(progress === undefined ? {} : { progress }),
        });
      },
      publish: async () => {},
    } as never,
    processManager,
    recipeStore: {
      list: () => recipes,
    } as never,
    downloadManager: {} as never,
    abortRunsForModel: (modelName: string): number => {
      abortedModels.push(modelName);
      return 1;
    },
  });

  return { coordinator, recipes, launched, killed, events, abortedModels };
};

describe("EngineCoordinator.setActiveRecipe", () => {
  it("treats null to null as a no-op", async () => {
    const { coordinator, launched, killed } = createCoordinator();

    await expect(coordinator.setActiveRecipe(null)).resolves.toEqual({ ok: true });

    expect(launched).toHaveLength(0);
    expect(killed).toHaveLength(0);
    expect(coordinator.getCurrentRecipe()).toBeNull();
  });

  it("launches a recipe when no process is running", async () => {
    const { coordinator, recipes, launched, killed, events } = createCoordinator();

    await expect(coordinator.setActiveRecipe(recipes[0])).resolves.toEqual({ ok: true });

    expect(launched).toEqual([recipes[0]]);
    expect(killed).toHaveLength(0);
    expect(coordinator.getCurrentRecipe()).toBe(recipes[0]);
    expect(events.map((event) => event.stage)).toEqual(["launching", "waiting", "ready"]);
  });

  it("evicts the current recipe when setting null", async () => {
    const active = recipe("alpha", "/models/alpha");
    const { coordinator, launched, killed, abortedModels } = createCoordinator(active);

    await expect(coordinator.setActiveRecipe(null)).resolves.toEqual({ ok: true });

    expect(launched).toHaveLength(0);
    expect(killed).toEqual([process.pid]);
    expect(abortedModels).toEqual(["alpha"]);
    expect(coordinator.getCurrentRecipe()).toBeNull();
  });

  it("swaps from one recipe to another", async () => {
    const active = recipe("alpha", "/models/alpha");
    const target = recipe("beta", "/models/beta");
    const { coordinator, launched, killed, events, abortedModels } = createCoordinator(active);

    await expect(coordinator.setActiveRecipe(target)).resolves.toEqual({ ok: true });

    expect(killed).toEqual([process.pid]);
    expect(abortedModels).toEqual(["alpha"]);
    expect(launched).toEqual([target]);
    expect(coordinator.getCurrentRecipe()).toBe(target);
    expect(events.map((event) => event.stage)).toEqual(["launching", "waiting", "ready"]);
  });


});
