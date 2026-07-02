import type { RouteRegistrar } from "../../http/route-registrar";
import { HttpStatus, badRequest, notFound, serviceUnavailable } from "../../core/errors";
import { optionalEnum, parseJsonObjectBody } from "../../core/validation";
import { observeControllerFunction } from "../../core/function-observability";
import { parseRecipe } from "../models/recipes/recipe-serializer";
import { Event } from "../system/event-manager";
import { CONTROLLER_EVENTS } from "../../../../shared/contracts/controller-events";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import type { ProcessInfo } from "../models/types";
import { getVllmConfigHelp, getVllmRuntimeInfo } from "./runtimes/vllm-runtime";
import { getCudaInfo } from "./runtimes/runtime-info";
import { getRocmInfo, resolveRocmSmiTool } from "../system/platform/rocm-info";
import { getEngineSpec } from "./engine-spec";
import {
  getDefaultRuntimeTarget,
  getRuntimeTarget,
  getRuntimeTargets,
  runtimeTargetToBackendInfo,
  selectRuntimeTarget,
} from "./runtimes/runtime-targets";
import {
  cancelEngineJob,
  createEngineJob,
  getEngineJob,
  listEngineJobs,
} from "./runtimes/engine-jobs";

const resolveHfToken = (
  ctx: { req: { header: (name: string) => string | undefined } },
  body?: Record<string, unknown>
): string | null => {
  const bodyToken = typeof body?.["hf_token"] === "string" ? String(body?.["hf_token"]) : null;
  const headerToken = ctx.req.header("x-hf-token") ?? ctx.req.header("x-huggingface-token") ?? null;
  const envToken =
    process.env["LOCAL_STUDIO_HF_TOKEN"] ??
    process.env["HF_TOKEN"] ??
    process.env["HUGGINGFACE_TOKEN"] ??
    null;
  return bodyToken || headerToken || envToken;
};

const RUNTIME_JOB_BACKENDS = ["vllm", "sglang", "llamacpp", "mlx", "exllamav3", "cuda", "rocm"] as const;
const RUNTIME_JOB_TYPES = ["install", "update", "download", "inspect"] as const;

const parseRuntimeJobBody = async (ctx: {
  req: { json: () => Promise<unknown> };
}): Promise<{
  backend?: (typeof RUNTIME_JOB_BACKENDS)[number];
  targetId?: string;
  type?: (typeof RUNTIME_JOB_TYPES)[number];
  version?: string;
  preferBundled?: boolean;
}> => {
  const record = await parseJsonObjectBody(ctx);
  const backend = optionalEnum(record, "backend", RUNTIME_JOB_BACKENDS);
  const type = optionalEnum(record, "type", RUNTIME_JOB_TYPES, "job type");
  if ("command" in record || "args" in record) {
    throw badRequest("Request-controlled command or args are not allowed for runtime jobs");
  }
  return {
    ...(backend ? { backend } : {}),
    ...(typeof record["targetId"] === "string" ? { targetId: record["targetId"] } : {}),
    ...(type ? { type } : {}),
    ...(typeof record["version"] === "string" ? { version: record["version"] } : {}),
    ...(typeof record["prefer_bundled"] === "boolean"
      ? { preferBundled: record["prefer_bundled"] }
      : {}),
  };
};

export const registerEngineRoutes: RouteRegistrar = (app, context) => {
  const launchAbortControllers = new Map<string, AbortController>();
  const getObservedProcess = (label: string): Promise<ProcessInfo | null> =>
    observeControllerFunction(context, `${label}.getCurrentProcess`, () =>
      context.engineService.getCurrentProcess()
    );

  app.get("/recipes", async (ctx) => {
    const recipes = context.stores.recipeStore.list();
    const current = await getObservedProcess("recipes.list");
    // launchState is the transitional truth: it marks the recipe between
    // /launch acceptance and readiness. The process scan is the running truth.
    // (The old getCurrentRecipe() cache showed a crashed model as "starting"
    // forever and a launching one as "stopped".)
    const launchingId = context.launchState.getLaunchingRecipeId();
    const result = recipes.map((recipe) => {
      const crashLoop = context.launchFailureBudget.get(recipe.id);
      let status = crashLoop?.blocked ? "error" : "stopped";
      if (launchingId === recipe.id) status = "starting";
      if (current && isRecipeRunning(recipe, current)) status = "running";
      return { ...recipe, status, crash_loop: crashLoop };
    });
    return ctx.json(result);
  });

  app.get("/recipes/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const recipe = context.stores.recipeStore.get(recipeId);
    if (!recipe) throw notFound("Recipe not found");
    return ctx.json(recipe);
  });

  app.post("/recipes", async (ctx) => {
    const body = await ctx.req.json();
    try {
      const recipe = parseRecipe(body);
      context.stores.recipeStore.save(recipe);
      context.engineService.resetLaunchFailureBudget(recipe.id);
      await context.eventManager.publish(new Event(CONTROLLER_EVENTS.RECIPE_CREATED, { recipe }));
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
      context.engineService.resetLaunchFailureBudget(recipe.id);
      await context.eventManager.publish(new Event(CONTROLLER_EVENTS.RECIPE_UPDATED, { recipe }));
      return ctx.json({ success: true, id: recipe.id });
    } catch (error) {
      throw badRequest(String(error));
    }
  });

  app.delete("/recipes/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const deleted = context.stores.recipeStore.delete(recipeId);
    if (!deleted) throw notFound("Recipe not found");
    context.engineService.resetLaunchFailureBudget(recipeId);
    await context.eventManager.publish(
      new Event(CONTROLLER_EVENTS.RECIPE_DELETED, { recipe_id: recipeId })
    );
    return ctx.json({ success: true });
  });

  app.post("/launch/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const recipe = context.stores.recipeStore.get(recipeId);
    if (!recipe) throw notFound("Recipe not found");
    const source =
      ctx.req.header("x-vllm-source") ??
      ctx.req.header("x-source") ??
      ctx.req.header("user-agent") ??
      null;
    const launchState = context.launchState.getState();
    if (launchState.phase !== "idle") {
      const activeRecipeId = launchState.recipeId ?? "unknown";
      context.logger.warn("Rejected queued launch request", {
        active_recipe_id: activeRecipeId,
        requested_recipe_id: recipeId,
        source,
      });
      throw new HttpStatus({
        status: 409,
        detail:
          activeRecipeId === recipeId
            ? `Launch already in progress for ${recipeId}`
            : `Launch already in progress for ${activeRecipeId}; refusing to queue ${recipeId}`,
      });
    }
    const current = await context.processManager.findInferenceProcess(
      context.config.inference_port
    );
    if (current && !isRecipeRunning(recipe, current, { allowEitherPathContains: true })) {
      context.logger.warn("Rejected launch request while another model is running", {
        running_model: current.served_model_name ?? current.model_path,
        running_backend: current.backend,
        requested_recipe_id: recipeId,
        source,
      });
      throw new HttpStatus({
        status: 409,
        detail: `Model ${current.served_model_name ?? current.model_path} is already running; evict it before launching ${recipeId}`,
      });
    }
    context.logger.info("Accepted launch request", { recipe_id: recipeId, source });
    const controller = new AbortController();
    launchAbortControllers.set(recipeId, controller);
    context.launchState.markLaunching(recipeId);
    try {
      const result = await context.engineService.setActiveRecipe(recipe, {
        signal: controller.signal,
      });
      if (!result.ok) {
        if (result.error.toLowerCase().includes("cancelled")) throw badRequest(result.error);
        throw serviceUnavailable(result.error);
      }
      return ctx.json({ success: true, message: "Launch started" });
    } finally {
      if (launchAbortControllers.get(recipeId) === controller) {
        launchAbortControllers.delete(recipeId);
      }
      if (context.launchState.getLaunchingRecipeId() === recipeId) {
        context.launchState.markIdle();
      }
    }
  });

  app.post("/launch/:recipeId/cancel", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const controller = launchAbortControllers.get(recipeId);
    if (!controller) throw notFound(`No launch in progress for ${recipeId}`);
    controller.abort();
    const result = await context.engineService.setActiveRecipe(null, { signal: controller.signal });
    if (!result.ok) throw serviceUnavailable(result.error);
    return ctx.json({ success: true, message: `Launch of ${recipeId} cancelled` });
  });

  app.post("/evict", async (ctx) => {
    const result = await context.engineService.setActiveRecipe(null);
    if (!result.ok) throw serviceUnavailable(result.error);
    return ctx.json({ success: true, evicted_pid: null });
  });

  app.get("/wait-ready", async (ctx) => {
    const timeout = Number(ctx.req.query("timeout") ?? 300);
    const start = Date.now();
    if (await context.engineService.waitForHealthy(timeout * 1000)) {
      return ctx.json({ ready: true, elapsed: Math.floor((Date.now() - start) / 1000) });
    }
    return ctx.json({ ready: false, elapsed: timeout, error: "Timeout waiting for backend" });
  });

  app.get("/studio/downloads", async (ctx) => {
    const downloads = context.downloadManager.list();
    return ctx.json({ downloads });
  });

  app.get("/studio/downloads/:downloadId", async (ctx) => {
    const id = ctx.req.param("downloadId");
    const download = context.downloadManager.get(id);
    if (!download) throw notFound("Download not found");
    return ctx.json({ download });
  });

  app.post("/studio/downloads", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    if (body && typeof body !== "object") throw badRequest("Invalid payload");
    const modelId = typeof body?.model_id === "string" ? body.model_id : null;
    if (!modelId) throw badRequest("model_id is required");
    const download = await context.downloadManager.start({
      model_id: modelId,
      revision: typeof body?.revision === "string" ? body.revision : null,
      destination_dir: typeof body?.destination_dir === "string" ? body.destination_dir : null,
      allow_patterns: Array.isArray(body?.allow_patterns) ? body.allow_patterns.map(String) : null,
      ignore_patterns: Array.isArray(body?.ignore_patterns)
        ? body.ignore_patterns.map(String)
        : null,
      hf_token: resolveHfToken(ctx, body),
    });
    return ctx.json({ download });
  });

  app.post("/studio/downloads/:downloadId/pause", async (ctx) => {
    const id = ctx.req.param("downloadId");
    if (!context.downloadManager.get(id)) throw notFound("Download not found");
    const download = context.downloadManager.pause(id);
    return ctx.json({ download });
  });

  app.post("/studio/downloads/:downloadId/resume", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const token = resolveHfToken(ctx, body);
    const id = ctx.req.param("downloadId");
    if (!context.downloadManager.get(id)) throw notFound("Download not found");
    const download = context.downloadManager.resume(id, token ?? null);
    return ctx.json({ download });
  });

  app.post("/studio/downloads/:downloadId/cancel", async (ctx) => {
    const id = ctx.req.param("downloadId");
    if (!context.downloadManager.get(id)) throw notFound("Download not found");
    const download = context.downloadManager.cancel(id);
    return ctx.json({ download });
  });

  app.get("/runtime/targets", async (ctx) => {
    const current = await getObservedProcess("runtime.targets");
    const targets = await getRuntimeTargets(context.config, current);
    return ctx.json({ targets });
  });

  app.get("/runtime/targets/:targetId", async (ctx) => {
    const current = await getObservedProcess("runtime.target");
    const target = await getRuntimeTarget(context.config, ctx.req.param("targetId"), current);
    if (!target) throw notFound("Runtime target not found");
    return ctx.json({ target });
  });

  app.post("/runtime/targets/:targetId/select", async (ctx) => {
    const current = await getObservedProcess("runtime.target.select");
    const target = await selectRuntimeTarget(context.config, ctx.req.param("targetId"), current);
    if (!target) throw notFound("Runtime target not found");
    return ctx.json({ target });
  });

  app.get("/runtime/targets/:targetId/health", async (ctx) => {
    const current = await getObservedProcess("runtime.target.health");
    const target = await getRuntimeTarget(context.config, ctx.req.param("targetId"), current);
    if (!target) throw notFound("Runtime target not found");
    return ctx.json({ health: target.health });
  });

  app.post("/runtime/jobs", async (ctx) => {
    const body = await parseRuntimeJobBody(ctx);
    if (!body.backend) throw badRequest("backend is required");
    const current = await getObservedProcess("runtime.jobs");
    const job = createEngineJob(context.config, {
      backend: body.backend,
      type: body.type ?? "update",
      ...(body.targetId ? { targetId: body.targetId } : {}),
      ...(body.version ? { version: body.version } : {}),
      ...(body.preferBundled !== undefined ? { preferBundled: body.preferBundled } : {}),
      runningProcess: current,
    });
    return ctx.json({ job });
  });

  app.get("/runtime/jobs", async (ctx) => {
    return ctx.json({ jobs: listEngineJobs() });
  });

  app.get("/runtime/jobs/:jobId", async (ctx) => {
    const job = getEngineJob(ctx.req.param("jobId"));
    if (!job) throw notFound("Runtime job not found");
    return ctx.json({ job });
  });

  app.post("/runtime/jobs/:jobId/cancel", async (ctx) => {
    const job = cancelEngineJob(ctx.req.param("jobId"));
    if (!job) throw notFound("Runtime job not found");
    return ctx.json({ job });
  });

  app.get("/runtime/vllm", async (ctx) => {
    return ctx.json(await getVllmRuntimeInfo());
  });

  app.get("/runtime/vllm/config", async (ctx) => {
    const config = await getVllmConfigHelp();
    return ctx.json(config);
  });

  app.get("/runtime/llamacpp/config", async (ctx) => {
    const spec = getEngineSpec("llamacpp");
    if (!spec.getConfigHelp) throw notFound("llama.cpp config help not available");
    const config = await spec.getConfigHelp(context.config);
    return ctx.json(config);
  });

  app.get("/runtime/sglang/config", async (ctx) => {
    const spec = getEngineSpec("sglang");
    if (!spec.getConfigHelp) throw notFound("SGLang config help not available");
    const config = await spec.getConfigHelp(context.config);
    return ctx.json(config);
  });

  app.get("/runtime/sglang", async (ctx) => {
    const current = await getObservedProcess("runtime.backend.sglang");
    const target = await getDefaultRuntimeTarget(context.config, "sglang", current);
    return ctx.json(runtimeTargetToBackendInfo(target));
  });

  app.get("/runtime/llamacpp", async (ctx) => {
    const current = await getObservedProcess("runtime.backend.llamacpp");
    const target = await getDefaultRuntimeTarget(context.config, "llamacpp", current);
    return ctx.json(runtimeTargetToBackendInfo(target));
  });

  app.get("/runtime/mlx", async (ctx) => {
    const current = await getObservedProcess("runtime.backend.mlx");
    return ctx.json(await getEngineSpec("mlx").getRuntimeInfo!(context.config, current));
  });

  app.get("/runtime/cuda", async (ctx) => {
    return ctx.json(getCudaInfo());
  });

  app.get("/runtime/rocm", async (ctx) => {
    const smiTool = resolveRocmSmiTool();
    return ctx.json(getRocmInfo(smiTool));
  });

  app.post("/runtime/vllm/upgrade", async (ctx) => {
    const body = await parseRuntimeJobBody(ctx);
    const current = await context.engineService.getCurrentProcess();
    const job = createEngineJob(context.config, {
      backend: "vllm",
      type: "update",
      ...(body.targetId ? { targetId: body.targetId } : {}),
      ...(body.version ? { version: body.version.trim() } : {}),
      ...(body.preferBundled !== undefined ? { preferBundled: body.preferBundled } : {}),
      runningProcess: current,
    });
    return ctx.json({ job_id: job.id, job });
  });

  app.post("/runtime/sglang/upgrade", async (ctx) => {
    await parseRuntimeJobBody(ctx);
    const job = createEngineJob(context.config, {
      backend: "sglang",
      type: "update",
    });
    return ctx.json({ job_id: job.id, job });
  });

  app.post("/runtime/llamacpp/upgrade", async (ctx) => {
    await parseRuntimeJobBody(ctx);
    const job = createEngineJob(context.config, {
      backend: "llamacpp",
      type: "update",
    });
    return ctx.json({ job_id: job.id, job });
  });

  app.post("/runtime/cuda/upgrade", async (ctx) => {
    await parseRuntimeJobBody(ctx);
    const job = createEngineJob(context.config, {
      backend: "cuda",
      type: "update",
    });
    return ctx.json({ job_id: job.id, job });
  });

  app.post("/runtime/rocm/upgrade", async (ctx) => {
    await parseRuntimeJobBody(ctx);
    const job = createEngineJob(context.config, {
      backend: "rocm",
      type: "update",
    });
    return ctx.json({ job_id: job.id, job });
  });
};
