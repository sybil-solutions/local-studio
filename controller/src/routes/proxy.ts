// CRITICAL
import type { Hono } from "hono";
import { readFileSync } from "node:fs";
import { AsyncLock, delay } from "../core/async";
import { HttpStatus, serviceUnavailable } from "../core/errors";
import { buildSseHeaders } from "../http/sse";
import type { AppContext } from "../types/context";
import type { ProcessInfo, Recipe } from "../types/models";
import type { ToolCallBuffer, ThinkState, Utf8State } from "../services/proxy-parsers";
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
   * Locate a recipe by model name or alias.
   * Matches on served_model_name, recipe id, or recipe name (case-insensitive).
   * @param modelName - Requested model name.
   * @returns Matching recipe or null.
   */
  const findRecipeByModel = (modelName: string): Recipe | null => {
    const lower = modelName.toLowerCase();
    for (const recipe of context.stores.recipeStore.list()) {
      const served = (recipe.served_model_name ?? "").toLowerCase();
      if (served === lower || recipe.id.toLowerCase() === lower) {
        return recipe;
      }
      const name = (recipe.name ?? "").toLowerCase();
      if (name && name === lower) {
        return recipe;
      }
    }
    return null;
  };

  /**
   * Check if a recipe matches a running process.
   * @param recipe - Recipe to check.
   * @param current - Running process info.
   * @returns True if the recipe matches the running process.
   */
  const isRecipeRunning = (recipe: Recipe, current: ProcessInfo): boolean => {
    const canonical = (recipe.served_model_name ?? "").toLowerCase();
    if (canonical && current.served_model_name && current.served_model_name.toLowerCase() === canonical) {
      return true;
    }
    if (current.model_path) {
      const normalize = (p: string): string => p.replace(/\/+$/, "");
      if (normalize(recipe.model_path) === normalize(current.model_path)) {
        return true;
      }
      if (current.model_path.split("/").pop() === recipe.model_path.split("/").pop()) {
        return true;
      }
    }
    return false;
  };

  /**
   * Ensure requested recipe's model is running.
   * @param recipe - Recipe to launch if not already running.
   * @returns Error message or null.
   */
  const ensureModelRunning = async (recipe: Recipe): Promise<string | null> => {
    const current = await context.processManager.findInferenceProcess(context.config.inference_port);
    if (current && isRecipeRunning(recipe, current)) {
      return null;
    }

    const release = await switchLock.acquire();
    try {
      const latest = await context.processManager.findInferenceProcess(context.config.inference_port);
      if (latest && isRecipeRunning(recipe, latest)) {
        return null;
      }
      await context.processManager.evictModel(false);
      await delay(2000);
      const launch = await context.processManager.launchModel(recipe);
      if (!launch.success) {
        return `Failed to launch model ${recipe.id}: ${launch.message}`;
      }

      const start = Date.now();
      const timeout = 300_000;
      while (Date.now() - start < timeout) {
        if (launch.pid && !pidExists(launch.pid)) {
          const logFile = `/tmp/vllm_${recipe.id}.log`;
          const errorTail = readLogTail(logFile, 500);
          return `Model ${recipe.id} crashed during startup: ${errorTail.slice(-200)}`;
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
      return `Model ${recipe.id} failed to become ready (timeout)`;
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
    const functionMatch = content.match(/<function=([^>\s]+)>/i);
    if (functionMatch) {
      return functionMatch[1] ?? "";
    }
    const jsonNameMatch = content.match(/"name"\s*:\s*"([^"]+)"/);
    return jsonNameMatch?.[1] ?? "";
  };

  /**
   * System prompt suffix for models with tokenizer UTF-8 issues (GLM).
   * These models corrupt emoji and special Unicode during streaming.
   */
  const UTF8_AVOIDANCE_PROMPT = `

IMPORTANT: Do not use emoji, Unicode symbols, or decorative box-drawing characters (┌┐└┘─│) in your responses. Use plain ASCII text, standard punctuation, and simple formatting only. For visual elements, use basic ASCII like dashes (---), pipes (|), plus (+), and asterisks (*).`;

  /**
   * Check if model has known UTF-8 streaming issues.
   * @param model - Model name.
   * @returns True if model has UTF-8 issues.
   */
  const hasUtf8Issues = (model: string): boolean => {
    const lower = model.toLowerCase();
    return lower.includes("glm");
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
    let modifiedBody: ArrayBuffer | null = null;
    let bodyChanged = false;
    let matchedRecipe: Recipe | null = null;

    try {
      const bodyText = new TextDecoder().decode(bodyBuffer);
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      if (typeof parsed["model"] === "string") {
        requestedModel = parsed["model"];
        matchedRecipe = findRecipeByModel(requestedModel);
        if (matchedRecipe) {
          const canonical = matchedRecipe.served_model_name ?? matchedRecipe.id;
          if (canonical && canonical !== requestedModel) {
            parsed["model"] = canonical;
            requestedModel = canonical;
            bodyChanged = true;
          }
        }
      }
      isStreaming = Boolean(parsed["stream"]);

      // Inject UTF-8 avoidance prompt for models with tokenizer issues
      if (requestedModel && hasUtf8Issues(requestedModel)) {
        const messages = parsed["messages"];
        if (Array.isArray(messages) && messages.length > 0) {
          const firstMessage = messages[0] as Record<string, unknown>;
          if (firstMessage["role"] === "system" && typeof firstMessage["content"] === "string") {
            // Append to existing system message
            firstMessage["content"] = firstMessage["content"] + UTF8_AVOIDANCE_PROMPT;
          } else {
            // Prepend new system message
            messages.unshift({ role: "system", content: UTF8_AVOIDANCE_PROMPT.trim() });
          }
          bodyChanged = true;
        }
      }
      if (bodyChanged) {
        modifiedBody = new TextEncoder().encode(JSON.stringify(parsed)).buffer;
      }
    } catch {
      requestedModel = null;
      matchedRecipe = null;
      isStreaming = false;
    }

    // Use modified body if we injected the prompt
    const finalBody = modifiedBody ?? bodyBuffer;

    if (matchedRecipe) {
      const switchError = await ensureModelRunning(matchedRecipe);
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
      const response = await fetch(litellmUrl, { method: "POST", headers, body: finalBody });
      const result = (await response.json()) as Record<string, unknown>;

      // Track token usage to lifetime metrics
      const usage = result["usage"] as Record<string, number> | undefined;
      if (usage) {
        const promptTokens = usage["prompt_tokens"] ?? 0;
        const completionTokens = usage["completion_tokens"] ?? 0;
        if (promptTokens > 0) {
          context.stores.lifetimeMetricsStore.addPromptTokens(promptTokens);
          context.stores.lifetimeMetricsStore.addTokens(promptTokens);
        }
        if (completionTokens > 0) {
          context.stores.lifetimeMetricsStore.addCompletionTokens(completionTokens);
          context.stores.lifetimeMetricsStore.addTokens(completionTokens);
        }
        if (promptTokens > 0 || completionTokens > 0) {
          context.stores.lifetimeMetricsStore.addRequests(1);
        }
      }

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

    const litellmResponse = await fetch(litellmUrl, { method: "POST", headers, body: finalBody });
    if (!litellmResponse.ok) {
      const errorText = await litellmResponse.text();
      return new Response(errorText, {
        status: litellmResponse.status,
        headers: {
          "Content-Type": litellmResponse.headers.get("Content-Type") ?? "application/json",
        },
      });
    }
    const reader = litellmResponse.body?.getReader();
    if (!reader) {
      throw serviceUnavailable("LiteLLM backend unavailable");
    }

    const thinkState: ThinkState = { inThinking: false };
    const utf8State: Utf8State = { pendingContent: "", pendingReasoning: "" };
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
      utf8State,
      extractToolName,
      onUsage: (usage) => {
        // Track streaming tokens to lifetime metrics
        if (usage.prompt_tokens > 0) {
          context.stores.lifetimeMetricsStore.addPromptTokens(usage.prompt_tokens);
          context.stores.lifetimeMetricsStore.addTokens(usage.prompt_tokens);
        }
        if (usage.completion_tokens > 0) {
          context.stores.lifetimeMetricsStore.addCompletionTokens(usage.completion_tokens);
          context.stores.lifetimeMetricsStore.addTokens(usage.completion_tokens);
        }
        if (usage.prompt_tokens > 0 || usage.completion_tokens > 0) {
          context.stores.lifetimeMetricsStore.addRequests(1);
        }
      },
    });

    return new Response(stream, { headers: buildSseHeaders() });
  });
};
