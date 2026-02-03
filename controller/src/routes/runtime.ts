// CRITICAL
import type { Hono } from "hono";
import type { AppContext } from "../types/context";
import { badRequest } from "../core/errors";
import { getLlamacppConfigHelp } from "../services/llamacpp-runtime";
import { getVllmConfigHelp, getVllmRuntimeInfo, upgradeVllmRuntime } from "../services/vllm-runtime";
import { Event } from "../services/event-manager";

export const registerRuntimeRoutes = (app: Hono, context: AppContext): void => {
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

  app.post("/runtime/vllm/upgrade", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    if (body && typeof body !== "object") {
      throw badRequest("Invalid payload");
    }
    const preferBundled = body?.prefer_bundled !== false;
    const result = await upgradeVllmRuntime(preferBundled);
    await context.eventManager.publish(new Event("runtime_vllm_upgraded", {
      success: result.success,
      version: result.version,
      used_wheel: result.used_wheel,
    }));
    return ctx.json(result);
  });
};
