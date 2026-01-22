import type { Hono } from "hono";
import { readFileSync } from "node:fs";
import { AsyncLock, delay } from "../core/async";
import { HttpStatus, serviceUnavailable } from "../core/errors";
import type { AppContext } from "../types/context";
import type { Recipe } from "../types/models";
import type { ToolCallBuffer, ThinkState } from "../services/proxy-parsers";
import { parseToolCallsFromContent } from "../services/proxy-parsers";
import { createProxyStream } from "../services/proxy-streamer";

const switchLock = new AsyncLock();

/**
 * Register proxy routes.
 * @param app - Hono app.
 * @param context - App context.
 */
export const registerProxyRoutes = (app: Hono, context: AppContext): void => {
  /**
   * Locate a recipe by model name.
   * @param modelName - Requested model name.
   * @returns Matching recipe or null.
   */
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

  /**
   * Ensure requested model is running.
   * @param requestedModel - Requested model name.
   * @returns Error message or null.
   */
  const ensureModelRunning = async (requestedModel: string): Promise<string | null> => {
    if (!requestedModel) {
      return null;
    }
    const requestedLower = requestedModel.toLowerCase();
    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
    if (current?.served_model_name && current.served_model_name.toLowerCase() === requestedLower) {
      return null;
    }
    const recipe = findRecipeByModel(requestedModel);
    if (!recipe) {
      return null;
    }

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
          if (response.status === 200) {
            return null;
          }
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

  /**
   * Check if a process id exists.
   * @param pid - Process id.
   * @returns True if process exists.
   */
  const pidExists = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Read last N characters from a log file.
   * @param path - Log file path.
   * @param limit - Max chars.
   * @returns Log tail string.
   */
  const readLogTail = (path: string, limit: number): string => {
    try {
      const content = readFileSync(path, "utf-8");
      return content.slice(Math.max(0, content.length - limit));
    } catch {
      return "";
    }
  };

  /**
   * Parse tool name from content.
   * @param content - Buffer content.
   * @returns Tool name or empty string.
   */
  const extractToolName = (content: string): string => {
    const nameMatch = content.match(/use the (\w+) (?:tool|function)/i);
    if (nameMatch) {
      return nameMatch[1] ?? "";
    }
    const jsonNameMatch = content.match(/"name"\s*:\s*"([^"]+)"/);
    return jsonNameMatch?.[1] ?? "";
  };

  app.post("/v1/chat/completions", async (ctx) => {
    let bodyBuffer: ArrayBuffer;
    try {
      bodyBuffer = await ctx.req.arrayBuffer();
    } catch {
      throw new HttpStatus(400, "Invalid request body");
    }

    let requestedModel: string | null = null;
    let isStreaming = false;
    try {
      const bodyText = new TextDecoder().decode(bodyBuffer);
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      if (typeof parsed["model"] === "string") {
        requestedModel = parsed["model"];
      }
      isStreaming = Boolean(parsed["stream"]);
    } catch {
      requestedModel = null;
      isStreaming = false;
    }

    if (requestedModel) {
      const switchError = await ensureModelRunning(requestedModel);
      if (switchError) {
        throw serviceUnavailable(switchError);
      }
    }

    const masterKey = process.env["LITELLM_MASTER_KEY"] ?? "sk-master";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${masterKey}`,
    };
    const litellmUrl = "http://localhost:4100/v1/chat/completions";

    if (!isStreaming) {
      const response = await fetch(litellmUrl, { method: "POST", headers, body: bodyBuffer });
      const result = (await response.json()) as Record<string, unknown>;

      const choices = result["choices"];
      if (Array.isArray(choices) && choices.length > 0) {
        const choice = choices[0] as Record<string, unknown>;
        const message = choice["message"] as Record<string, unknown> | undefined;
        const toolCalls = message?.["tool_calls"];
        const content = typeof message?.["content"] === "string" ? String(message["content"]) : "";
        const reasoning = typeof message?.["reasoning_content"] === "string" ? String(message["reasoning_content"]) : "";
        const fullContent = `${content}${reasoning}`;

        if ((!toolCalls || (Array.isArray(toolCalls) && toolCalls.length === 0)) && fullContent) {
          const hasPattern = fullContent.includes("</tool_call>") ||
            fullContent.includes("<tool_call>") ||
            fullContent.includes("</use_mcp_tool>") ||
            fullContent.includes("use_mcp_tool>") ||
            (fullContent.includes("\"name\"") && fullContent.includes("\"arguments\""));
          if (hasPattern) {
            const parsedTools = parseToolCallsFromContent(fullContent);
            if (parsedTools.length > 0 && message) {
              message["tool_calls"] = parsedTools;
              choice["finish_reason"] = "tool_calls";
            }
          }
        }
      }

      return ctx.json(result, { status: response.status });
    }

    const litellmResponse = await fetch(litellmUrl, { method: "POST", headers, body: bodyBuffer });
    const reader = litellmResponse.body?.getReader();
    if (!reader) {
      throw serviceUnavailable("LiteLLM backend unavailable");
    }

    const thinkState: ThinkState = { inThinking: false };
    const toolCallBuffer: ToolCallBuffer = {
      content: "",
      tool_args: "",
      tool_name: "",
      has_malformed_tool_calls: false,
      tool_calls_found: false,
    };
    const stream = createProxyStream({
      reader,
      toolCallBuffer,
      thinkState,
      extractToolName,
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });
};
