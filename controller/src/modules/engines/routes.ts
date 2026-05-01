// CRITICAL — Engines module routes
import type { Hono } from "hono";
import type { AppContext } from "../../types/context";
import { delay } from "../../core/async";
import { badRequest, notFound, serviceUnavailable } from "../../core/errors";
import { parseRecipe } from "../models/recipes/recipe-serializer";
import { Event } from "../system/event-manager";
import { CONTROLLER_EVENTS } from "../../contracts/controller-events";
import { fetchInference } from "../../services/inference/inference-client";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import {
  getVllmRuntimeInfo,
  upgradeVllmRuntime,
  getVllmConfigHelp,
} from "./layers/vllm-runtime";
import { getLlamacppConfigHelp } from "./layers/llamacpp-runtime";
import {
  getLlamacppRuntimeInfo,
  getSglangRuntimeInfo,
  getExllamav3RuntimeInfo,
  getCudaInfo,
} from "./layers/runtime-info";
import { getRocmInfo, resolveRocmSmiTool } from "../system/platform/rocm-info";
import {
  upgradeSglangRuntime,
  upgradeLlamacppRuntime,
  runPlatformUpgrade,
} from "./layers/runtime-upgrade";

const resolveHfToken = (
  ctx: { req: { header: (name: string) => string | undefined } },
  body?: Record<string, unknown>
): string | null => {
  const bodyToken = typeof body?.["hf_token"] === "string" ? String(body?.["hf_token"]) : null;
  const headerToken = ctx.req.header("x-hf-token") ?? ctx.req.header("x-huggingface-token") ?? null;
  const envToken =
    process.env["VLLM_STUDIO_HF_TOKEN"] ??
    process.env["HF_TOKEN"] ??
    process.env["HUGGINGFACE_TOKEN"] ??
    null;
  return bodyToken || headerToken || envToken;
};

/**
 * Register engines module routes.
 * @param app - Hono application to register routes on.
 * @param context - Application dependency container.
 */
export const registerEngineRoutes = (app: Hono, context: AppContext): void => {
  const launchAbortControllers = new Map<string, AbortController>();

  // ── Recipe CRUD (from lifecycle-routes) ──

  app.get("/recipes", async (ctx) => {
    const recipes = context.stores.recipeStore.list();
    const current = await context.engineService.getCurrentProcess();
    const launchingRecipe = context.engineService.getCurrentRecipe();
    const launchingId = launchingRecipe?.id ?? null;
    const result = recipes.map((recipe) => {
      let status = "stopped";
      if (launchingId === recipe.id) status = "starting";
      if (current && isRecipeRunning(recipe, current)) status = "running";
      return { ...recipe, status };
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
    await context.eventManager.publish(
      new Event(CONTROLLER_EVENTS.RECIPE_DELETED, { recipe_id: recipeId })
    );
    return ctx.json({ success: true });
  });

  // ── Launch / Evict / Cancel (from lifecycle-routes) ──

  app.post("/launch/:recipeId", async (ctx) => {
    const recipeId = ctx.req.param("recipeId");
    const recipe = context.stores.recipeStore.get(recipeId);
    if (!recipe) throw notFound("Recipe not found");
    const controller = new AbortController();
    launchAbortControllers.set(recipeId, controller);
    try {
      const result = await context.engineService.setActiveRecipe(recipe, { signal: controller.signal });
      if (!result.ok) {
        if (result.error.toLowerCase().includes("cancelled")) throw badRequest(result.error);
        throw serviceUnavailable(result.error);
      }
      return ctx.json({ success: true, message: "Launch started" });
    } finally {
      if (launchAbortControllers.get(recipeId) === controller) {
        launchAbortControllers.delete(recipeId);
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
    while (Date.now() - start < timeout * 1000) {
      try {
        const response = await fetchInference(context, "/health", { timeoutMs: 5000 });
        if (response.status === 200) {
          return ctx.json({ ready: true, elapsed: Math.floor((Date.now() - start) / 1000) });
        }
      } catch {
        // Ignore
      }
      await delay(2000);
    }
    return ctx.json({ ready: false, elapsed: timeout, error: "Timeout waiting for backend" });
  });

  // ── Downloads (from downloads/routes) ──

  app.get("/studio/downloads", async (ctx) => {
    const downloads = context.engineService.listDownloads();
    return ctx.json({ downloads });
  });

  app.get("/studio/downloads/:downloadId", async (ctx) => {
    const id = ctx.req.param("downloadId");
    const download = context.engineService.getDownload(id);
    if (!download) throw notFound("Download not found");
    return ctx.json({ download });
  });

  app.post("/studio/downloads", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    if (body && typeof body !== "object") throw badRequest("Invalid payload");
    const modelId = typeof body?.model_id === "string" ? body.model_id : null;
    if (!modelId) throw badRequest("model_id is required");
    const download = await context.engineService.startDownload({
      model_id: modelId,
      revision: typeof body?.revision === "string" ? body.revision : null,
      destination_dir: typeof body?.destination_dir === "string" ? body.destination_dir : null,
      allow_patterns: Array.isArray(body?.allow_patterns) ? body.allow_patterns.map(String) : null,
      ignore_patterns: Array.isArray(body?.ignore_patterns) ? body.ignore_patterns.map(String) : null,
      hf_token: resolveHfToken(ctx, body),
    });
    return ctx.json({ download });
  });

  app.post("/studio/downloads/:downloadId/pause", async (ctx) => {
    const id = ctx.req.param("downloadId");
    const download = context.engineService.pauseDownload(id);
    return ctx.json({ download });
  });

  app.post("/studio/downloads/:downloadId/resume", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const token = resolveHfToken(ctx, body);
    const id = ctx.req.param("downloadId");
    const download = context.engineService.resumeDownload(id, token);
    return ctx.json({ download });
  });

  app.post("/studio/downloads/:downloadId/cancel", async (ctx) => {
    const id = ctx.req.param("downloadId");
    const download = context.engineService.cancelDownload(id);
    return ctx.json({ download });
  });

  // ── Runtime info (from runtime-routes) ──

  app.get("/runtime/vllm", async (ctx) => {
    const info = await getVllmRuntimeInfo();
    return ctx.json(info);
  });

  app.get("/runtime/vllm/config", async (ctx) => {
    const config = await getVllmConfigHelp();
    return ctx.json(config);
  });

  app.get("/runtime/llamacpp/config", async (ctx) => {
    const config = await getLlamacppConfigHelp(context.config);
    return ctx.json(config);
  });

  app.get("/runtime/sglang", async (ctx) => {
    const current = await context.engineService.getCurrentProcess();
    const info = await getSglangRuntimeInfo(context.config, current);
    return ctx.json(info);
  });

  app.get("/runtime/llamacpp", async (ctx) => {
    const info = getLlamacppRuntimeInfo(context.config);
    return ctx.json(info);
  });

  app.get("/runtime/exllamav3", async (ctx) => {
    const info = getExllamav3RuntimeInfo(context.config);
    return ctx.json(info);
  });

  app.get("/runtime/cuda", async (ctx) => {
    return ctx.json(getCudaInfo());
  });

  app.get("/runtime/rocm", async (ctx) => {
    const smiTool = resolveRocmSmiTool();
    return ctx.json(getRocmInfo(smiTool));
  });

  // ── Runtime upgrade ──

  app.post("/runtime/vllm/upgrade", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    if (body && typeof body !== "object") throw badRequest("Invalid payload");
    const preferBundled = body?.prefer_bundled !== false;
    const parsedArguments = Array.isArray(body?.args) ? body.args : [];
    const requestedVersion = typeof body?.version === "string" ? body.version.trim() : undefined;
    if (parsedArguments.some((value: unknown) => typeof value !== "string")) throw badRequest("args must be an array of strings");
    const result = await upgradeVllmRuntime({
      preferBundled,
      ...(parsedArguments.length > 0 ? { args: parsedArguments as string[] } : {}),
      ...(requestedVersion ? { version: requestedVersion } : {}),
    });
    await context.eventManager.publish(
      new Event(CONTROLLER_EVENTS.RUNTIME_VLLM_UPGRADED, { success: result.success, version: result.version, used_wheel: result.used_wheel })
    );
    return ctx.json(result);
  });

  app.post("/runtime/sglang/upgrade", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const parsedArguments = Array.isArray(body?.args) ? body.args : [];
    if (parsedArguments.some((value: unknown) => typeof value !== "string")) throw badRequest("args must be an array of strings");
    const finalResult = await upgradeSglangRuntime(context.config, {
      ...(parsedArguments.length > 0 ? { args: parsedArguments as string[] } : {}),
    });
    await context.eventManager.publish(
      new Event(CONTROLLER_EVENTS.RUNTIME_SGLANG_UPGRADED, { success: finalResult.success, version: finalResult.version, used_command: finalResult.used_command })
    );
    return ctx.json(finalResult);
  });

  app.post("/runtime/llamacpp/upgrade", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const parsedArguments = Array.isArray(body?.args) ? body.args : [];
    if (parsedArguments.some((value: unknown) => typeof value !== "string")) throw badRequest("args must be an array of strings");
    const result = await upgradeLlamacppRuntime(context.config, {
      ...(parsedArguments.length > 0 ? { args: parsedArguments as string[] } : {}),
    });
    await context.eventManager.publish(
      new Event(CONTROLLER_EVENTS.RUNTIME_LLAMACPP_UPGRADED, { success: result.success, version: result.version, used_command: result.used_command })
    );
    return ctx.json(result);
  });

  app.post("/runtime/cuda/upgrade", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const parsedArguments = Array.isArray(body?.args) ? body.args : [];
    if (parsedArguments.some((value: unknown) => typeof value !== "string")) throw badRequest("args must be an array of strings");
    const result = runPlatformUpgrade("cuda", {
      ...(parsedArguments.length > 0 ? { args: parsedArguments as string[] } : {}),
    });
    await context.eventManager.publish(
      new Event(CONTROLLER_EVENTS.RUNTIME_CUDA_UPGRADED, { success: result.success, version: result.version, used_command: result.used_command })
    );
    return ctx.json(result);
  });

  app.post("/runtime/rocm/upgrade", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const parsedArguments = Array.isArray(body?.args) ? body.args : [];
    if (parsedArguments.some((value: unknown) => typeof value !== "string")) throw badRequest("args must be an array of strings");
    const result = runPlatformUpgrade("rocm", {
      ...(parsedArguments.length > 0 ? { args: parsedArguments as string[] } : {}),
    });
    await context.eventManager.publish(
      new Event(CONTROLLER_EVENTS.RUNTIME_ROCM_UPGRADED, { success: result.success, version: result.version, used_command: result.used_command })
    );
    return ctx.json(result);
  });
};