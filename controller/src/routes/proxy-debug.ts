import type { Hono } from "hono";
import { readFileSync, appendFileSync } from "node:fs";
import { AsyncLock, delay } from "../core/async";
import { HttpStatus, serviceUnavailable } from "../core/errors";
import type { AppContext } from "../types/context";
import type { Recipe } from "../types/models";
import type { ToolCallBuffer, ThinkState } from "../services/proxy-parsers";
import { parseToolCallsFromContent } from "../services/proxy-parsers";
import { createProxyStreamDebug } from "../services/proxy-streamer-debug";

const switchLock = new AsyncLock();
const DEBUG_LOG = "/tmp/proxy-debug.log";

const log = (stage: string, data: unknown): void => {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${stage}] ${JSON.stringify(data, null, 2)}\n`;
  appendFileSync(DEBUG_LOG, line);
  console.log(`[DEBUG] [${stage}]`, typeof data === "string" ? data : JSON.stringify(data).slice(0, 200));
};

export const registerProxyRoutesDebug = (app: Hono, context: AppContext): void => {
  const findRecipeByModel = (modelName: string): Recipe | null => {
    const lower = modelName.toLowerCase();
    for (const recipe of context.stores.recipeStore.list()) {
      const servedLower = (recipe.served_model_name ?? "").toLowerCase();
      if (servedLower === lower || recipe.id.toLowerCase() === lower) {
        return recipe;
      }
    }
    return null;
  };

  const ensureModelRunning = async (requestedModel: string): Promise<string | null> => {
    if (!requestedModel) return null;
    const requestedLower = requestedModel.toLowerCase();
    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
    if (current?.served_model_name && current.served_model_name.toLowerCase() === requestedLower) {
      return null;
    }
    const recipe = findRecipeByModel(requestedModel);
    if (!recipe) return null;

    const release = await switchLock.acquire();
    try {
      const latest = await context.processManager.findInferenceProcess(context.config.inference_port);
      if (latest?.served_model_name && latest.served_model_name.toLowerCase() === requestedLower) {
        return null;
      }
      await context.processManager.evictModel(false);
      await delay(2000);
      const launch = await context.processManager.launchModel(recipe);
      if (!launch.success) {
        return `Failed to launch model ${requestedModel}: ${launch.message}`;
      }
      const start = Date.now();
      const timeout = 300_000;
      while (Date.now() - start < timeout) {
        if (launch.pid && !pidExists(launch.pid)) {
          const logFile = `/tmp/vllm_${recipe.id}.log`;
          const errorTail = readLogTail(logFile, 500);
          return `Model ${requestedModel} crashed during startup: ${errorTail.slice(-200)}`;
        }
        try {
          const controller = new AbortController();
          const timeoutHandle = setTimeout(() => controller.abort(), 5000);
          const response = await fetch(`http://localhost:${context.config.inference_port}/health`, {
            signal: controller.signal,
          });
          clearTimeout(timeoutHandle);
          if (response.status === 200) return null;
        } catch {
          await delay(3000);
        }
        await delay(3000);
      }
      return `Model ${requestedModel} failed to become ready (timeout)`;
    } finally {
      release();
    }
  };

  const pidExists = (pid: number): boolean => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };

  const readLogTail = (path: string, limit: number): string => {
    try {
      const content = readFileSync(path, "utf-8");
      return content.slice(Math.max(0, content.length - limit));
    } catch { return ""; }
  };

  const extractToolName = (content: string): string => {
    const nameMatch = content.match(/use the (\w+) (?:tool|function)/i);
    if (nameMatch) return nameMatch[1] ?? "";
    const jsonNameMatch = content.match(/"name"\s*:\s*"([^"]+)"/);
    return jsonNameMatch?.[1] ?? "";
  };

  // Debug endpoint
  app.post("/v1/chat/completions/debug", async (ctx) => {
    log("REQUEST_START", "=== New Debug Request ===");
    
    let bodyBuffer: ArrayBuffer;
    try {
      bodyBuffer = await ctx.req.arrayBuffer();
    } catch {
      throw new HttpStatus(400, "Invalid request body");
    }

    const bodyText = new TextDecoder().decode(bodyBuffer);
    let parsed: Record<string, unknown> = {};
    let requestedModel: string | null = null;
    let isStreaming = false;
    
    try {
      parsed = JSON.parse(bodyText) as Record<string, unknown>;
      requestedModel = typeof parsed["model"] === "string" ? parsed["model"] : null;
      isStreaming = Boolean(parsed["stream"]);
    } catch {
      requestedModel = null;
      isStreaming = false;
    }

    log("REQUEST_BODY", { model: requestedModel, streaming: isStreaming, messages: parsed["messages"] });

    if (requestedModel) {
      const switchError = await ensureModelRunning(requestedModel);
      if (switchError) throw serviceUnavailable(switchError);
    }

    const masterKey = process.env["LITELLM_MASTER_KEY"] ?? "sk-master";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${masterKey}`,
    };
    const litellmUrl = "http://localhost:4100/v1/chat/completions";

    if (!isStreaming) {
      log("NON_STREAMING", "Using non-streaming path");
      const response = await fetch(litellmUrl, { method: "POST", headers, body: bodyBuffer });
      const result = (await response.json()) as Record<string, unknown>;
      log("LITELLM_RESPONSE", result);
      return ctx.json(result, { status: response.status });
    }

    log("STREAMING", "Using streaming path");
    const litellmResponse = await fetch(litellmUrl, { method: "POST", headers, body: bodyBuffer });
    const reader = litellmResponse.body?.getReader();
    if (!reader) throw serviceUnavailable("LiteLLM backend unavailable");

    const thinkState: ThinkState = { inThinking: false };
    const toolCallBuffer: ToolCallBuffer = {
      content: "",
      tool_args: "",
      tool_name: "",
      has_malformed_tool_calls: false,
      tool_calls_found: false,
    };

    log("STREAM_INIT", { thinkState, toolCallBuffer });

    const stream = createProxyStreamDebug({
      reader,
      toolCallBuffer,
      thinkState,
      extractToolName,
      onUsage: (usage) => {
        log("USAGE", usage);
      },
      onChunk: (stage, data) => {
        log(stage, data);
      },
    });

    return new Response(stream, {
      headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  });
};
