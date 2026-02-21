// CRITICAL
import type { Hono } from "hono";
import type { AppContext } from "../../types/context";
import { badRequest } from "../../core/errors";
import { getLlamacppConfigHelp } from "./llamacpp-runtime";
import { getVllmRuntimeInfo, upgradeVllmRuntime } from "./vllm-runtime";
import { getVllmConfigHelp } from "./vllm-runtime";
import { getLlamacppRuntimeInfo, getSglangRuntimeInfo } from "./runtime-info";
import { getCudaInfo } from "./runtime-info";
import { getRocmInfo, resolveRocmSmiTool } from "./platform/rocm-info";
import {
  runPlatformUpgrade,
  upgradeLlamacppRuntime,
  upgradeSglangRuntime,
} from "./runtime-upgrade";
import { Event } from "../monitoring/event-manager";

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

  app.get("/runtime/sglang", async (ctx) => {
    const info = await getSglangRuntimeInfo(context.config);
    return ctx.json(info);
  });

  app.get("/runtime/llamacpp", async (ctx) => {
    const info = getLlamacppRuntimeInfo(context.config);
    return ctx.json(info);
  });

  app.get("/runtime/cuda", async (ctx) => {
    return ctx.json(getCudaInfo());
  });

  app.get("/runtime/rocm", async (ctx) => {
    const smiTool = resolveRocmSmiTool();
    return ctx.json(getRocmInfo(smiTool));
  });

  app.post("/runtime/sglang/upgrade", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const command = typeof body?.command === "string" ? body.command : undefined;
    const parsedArguments = Array.isArray(body?.args) ? body.args : [];
    if (parsedArguments.some((value: unknown) => typeof value !== "string")) {
      throw badRequest("args must be an array of strings");
    }

    const finalResult = await upgradeSglangRuntime(context.config, {
      command,
      ...(parsedArguments.length > 0 ? { args: parsedArguments as string[] } : {}),
    });
    await context.eventManager.publish(
      new Event("runtime_sglang_upgraded", {
        success: finalResult.success,
        version: finalResult.version,
        used_command: finalResult.used_command,
      })
    );
    return ctx.json(finalResult);
  });

  app.post("/runtime/llamacpp/upgrade", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const command = typeof body?.command === "string" ? body.command : undefined;
    const parsedArguments = Array.isArray(body?.args) ? body.args : [];
    if (parsedArguments.some((value: unknown) => typeof value !== "string")) {
      throw badRequest("args must be an array of strings");
    }

    const result = await upgradeLlamacppRuntime(context.config, {
      command,
      ...(parsedArguments.length > 0 ? { args: parsedArguments as string[] } : {}),
    });
    await context.eventManager.publish(
      new Event("runtime_llamacpp_upgraded", {
        success: result.success,
        version: result.version,
        used_command: result.used_command,
      })
    );
    return ctx.json(result);
  });

  app.post("/runtime/cuda/upgrade", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const command = typeof body?.command === "string" ? body.command : undefined;
    const parsedArguments = Array.isArray(body?.args) ? body.args : [];
    if (parsedArguments.some((value: unknown) => typeof value !== "string")) {
      throw badRequest("args must be an array of strings");
    }
    const result = runPlatformUpgrade("cuda", {
      command,
      ...(parsedArguments.length > 0 ? { args: parsedArguments as string[] } : {}),
    });
    await context.eventManager.publish(
      new Event("runtime_cuda_upgraded", {
        success: result.success,
        version: result.version,
        used_command: result.used_command,
      })
    );
    return ctx.json(result);
  });

  app.post("/runtime/rocm/upgrade", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const command = typeof body?.command === "string" ? body.command : undefined;
    const parsedArguments = Array.isArray(body?.args) ? body.args : [];
    if (parsedArguments.some((value: unknown) => typeof value !== "string")) {
      throw badRequest("args must be an array of strings");
    }
    const result = runPlatformUpgrade("rocm", {
      command,
      ...(parsedArguments.length > 0 ? { args: parsedArguments as string[] } : {}),
    });
    await context.eventManager.publish(
      new Event("runtime_rocm_upgraded", {
        success: result.success,
        version: result.version,
        used_command: result.used_command,
      })
    );
    return ctx.json(result);
  });

  app.post("/runtime/vllm/upgrade", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    if (body && typeof body !== "object") {
      throw badRequest("Invalid payload");
    }
    const preferBundled = body?.prefer_bundled !== false;
    const command = typeof body?.command === "string" ? body.command : undefined;
    const parsedArguments = Array.isArray(body?.args) ? body.args : [];
    const requestedVersion = typeof body?.version === "string" ? body.version.trim() : undefined;
    if (parsedArguments.some((value: unknown) => typeof value !== "string")) {
      throw badRequest("args must be an array of strings");
    }
    const result = await upgradeVllmRuntime({
      command,
      preferBundled,
      ...(parsedArguments.length > 0 ? { args: parsedArguments as string[] } : {}),
      ...(requestedVersion ? { version: requestedVersion } : {}),
    });
    await context.eventManager.publish(
      new Event("runtime_vllm_upgraded", {
        success: result.success,
        version: result.version,
        used_wheel: result.used_wheel,
      })
    );
    return ctx.json(result);
  });
};
