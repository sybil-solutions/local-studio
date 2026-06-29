import { performance } from "node:perf_hooks";
import { HttpStatus, notFound } from "../../core/errors";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import { buildSseHeaders } from "../../http/sse";
import type { RouteRegistrar } from "../../http/route-registrar";
import type { Recipe } from "../models/types";
import { getDefaultReasoningParser } from "../engines/process/model-runtime-defaults";
import { buildInferenceUrl } from "../../services/inference-client";
import {
  DEFAULT_CHAT_PROVIDER,
  parseProviderModel,
  resolveProviderConfig,
} from "../../services/provider-routing";
import { normalizeChatMessageContentParts, normalizeToolRequest } from "./content-normalizer";
import {
  normalizeReasoningAndContentInMessage,
  normalizeToolCallsInMessage,
} from "./reasoning-extractor";
import { createToolCallStream } from "./tool-call-stream";
import {
  recordNonStreamingInferenceUsage,
  recordStreamingInferenceUsage,
} from "./inference-accounting";
import { PROXY_SESSION_HEADER_NAMES } from "./configs";
import type { OpenAIUsage } from "./types";

const NON_RUNNING_MODEL_WARN_INTERVAL_MS = 10 * 60_000;

interface NonRunningModelWarningState {
  lastWarnAt: number;
  suppressed: number;
}

export interface ModelNotRunningError {
  error: { message: string; type: "model_not_running"; code: "model_not_running" };
  detail: string;
}

/**
 * The chat proxy never launches a model. When the requested model isn't the
 * one running, return this OpenAI-shaped 503 body: SDK callers (the pi agent
 * runtime) read `error.message`, so this surfaces a real instruction instead
 * of a bare "503 status code (no body)". `detail` is kept for FastAPI-style
 * callers that already read it.
 */
export const modelNotRunningError = (
  activeModel: string | null,
  requestedModel: string | null | undefined,
): ModelNotRunningError => {
  const message = activeModel
    ? `Model ${activeModel} is running; ${requestedModel} is not. Launch it from the frontend before sending requests.`
    : `No model is running. Launch ${requestedModel} from the frontend before sending requests.`;
  return {
    error: { message, type: "model_not_running", code: "model_not_running" },
    detail: message,
  };
};

export const ensureStreamingUsageIncluded = (payload: Record<string, unknown>): boolean => {
  if (!Boolean(payload["stream"])) return false;
  const existingStreamOptions =
    payload["stream_options"] &&
    typeof payload["stream_options"] === "object" &&
    !Array.isArray(payload["stream_options"])
      ? (payload["stream_options"] as Record<string, unknown>)
      : {};
  if (existingStreamOptions["include_usage"] === true) return false;
  payload["stream_options"] = {
    ...existingStreamOptions,
    include_usage: true,
  };
  return true;
};

const exposeReasoningAsContentWhenEmpty = (
  message: Record<string, unknown>,
  model: string
): boolean => {
  const modelLower = model.toLowerCase();
  if (!modelLower.includes("trinity-large-thinking")) return false;

  const content = typeof message["content"] === "string" ? message["content"].trim() : "";
  if (content) return false;

  const reasoning =
    typeof message["reasoning"] === "string"
      ? message["reasoning"].trim()
      : typeof message["reasoning_content"] === "string"
        ? message["reasoning_content"].trim()
        : "";
  if (!reasoning) return false;

  message["content"] = reasoning;
  if (!message["reasoning_content"]) {
    message["reasoning_content"] = reasoning;
  }
  return true;
};

const shouldBufferImplicitReasoningContent = (
  model: string,
  reasoningParser: string | null | undefined
): boolean => {
  const parser = (reasoningParser ?? "").toLowerCase();
  const modelLower = model.toLowerCase();
  return (
    parser === "deepseek_r1" ||
    parser === "minimax_m2_append_think" ||
    modelLower.includes("deepseek") ||
    modelLower.includes("r1") ||
    modelLower.includes("reasoning") ||
    modelLower.includes("thinking")
  );
};

export const registerOpenAIRoutes: RouteRegistrar = (app, context) => {
  const nonRunningModelWarnings = new Map<string, NonRunningModelWarningState>();

  const warnNonRunningModel = (details: {
    requestedModel: string | null;
    requestedRecipeId: string;
    activeModel: string | null;
    source: string | null;
  }): void => {
    const key = [
      details.requestedRecipeId,
      details.requestedModel ?? "",
      details.activeModel ?? "",
      details.source ?? "",
    ].join("\u0000");
    const now = Date.now();
    const state = nonRunningModelWarnings.get(key) ?? { lastWarnAt: 0, suppressed: 0 };
    if (now - state.lastWarnAt < NON_RUNNING_MODEL_WARN_INTERVAL_MS) {
      state.suppressed += 1;
      nonRunningModelWarnings.set(key, state);
      return;
    }

    const suppressed = state.suppressed;
    nonRunningModelWarnings.set(key, { lastWarnAt: now, suppressed: 0 });
    context.logger.warn("Rejected chat request for non-running model", {
      requested_model: details.requestedModel,
      requested_recipe_id: details.requestedRecipeId,
      active_model: details.activeModel,
      source: details.source,
      ...(suppressed > 0 ? { suppressed_requests: suppressed } : {}),
    });
  };

  const extractSessionId = (
    parsedBody: Record<string, unknown>,
    header: (name: string) => string | undefined
  ): string | null => {
    const fromHeader = PROXY_SESSION_HEADER_NAMES.map((name) => header(name)).find(Boolean);
    if (fromHeader?.trim()) return fromHeader.trim();

    const direct = parsedBody["session_id"] ?? parsedBody["sessionId"] ?? parsedBody["chat_id"];
    if (typeof direct === "string" && direct.trim()) return direct.trim();

    const metadata = parsedBody["metadata"];
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const record = metadata as Record<string, unknown>;
      const fromMetadata = record["session_id"] ?? record["sessionId"] ?? record["chat_id"];
      if (typeof fromMetadata === "string" && fromMetadata.trim()) return fromMetadata.trim();
    }

    return null;
  };

  const attachSessionUsage = (
    result: Record<string, unknown>,
    sessionId: string | null,
    usage: OpenAIUsage | undefined
  ): void => {
    if (!sessionId) return;

    const promptTokens = usage?.["prompt_tokens"] ?? 0;
    const completionTokens = usage?.["completion_tokens"] ?? 0;
    const reasoningTokens = usage?.["reasoning_tokens"] ?? 0;

    result["session_id"] = sessionId;
    result["session_usage"] = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      current_prompt_tokens: promptTokens,
      current_completion_tokens: completionTokens,
      current_reasoning_tokens: typeof reasoningTokens === "number" ? reasoningTokens : 0,
    };
  };

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

  app.post("/v1/chat/completions", async (ctx) => {
    let bodyBuffer: ArrayBuffer;
    try {
      bodyBuffer = await ctx.req.arrayBuffer();
    } catch {
      // If the client already disconnected (e.g. Droid cancelled the
      // stream before finishing its POST body), don't report this as a
      // "400 Invalid request body" — that ends up as `400 (no body)` on
      // the SDK side, which looks like a real server bug.
      if (ctx.req.raw.signal.aborted) {
        return ctx.body(null, { status: 499 });
      }
      throw new HttpStatus({ status: 400, detail: "Invalid request body" });
    }

    let parsed: Record<string, unknown> = {};
    let requestedModel: string | null = null;
    let matchedRecipe: Recipe | null = null;
    let isStreaming = false;
    let bodyChanged = false;
    let sessionId: string | null = null;

    try {
      const bodyText = new TextDecoder().decode(bodyBuffer);
      parsed = JSON.parse(bodyText) as Record<string, unknown>;
      sessionId = extractSessionId(parsed, (name) => ctx.req.header(name));
      normalizeToolRequest(parsed);
      if (normalizeChatMessageContentParts(parsed)) {
        bodyChanged = true;
      }
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
      if (parsed["functions"] || parsed["tools"] !== undefined) {
        bodyChanged = true;
      }
      isStreaming = Boolean(parsed["stream"]);
      if (ensureStreamingUsageIncluded(parsed)) {
        bodyChanged = true;
      }
    } catch {
      throw new HttpStatus({ status: 400, detail: "Invalid JSON body" });
    }

    const providerModel = requestedModel
      ? parseProviderModel(requestedModel)
      : { provider: DEFAULT_CHAT_PROVIDER, modelId: "" };
    const requestProvider = providerModel.provider;
    const providerRouting =
      requestProvider !== DEFAULT_CHAT_PROVIDER
        ? resolveProviderConfig(requestProvider, {
            providers: context.config.providers,
          })
        : null;
    const sourceHeader =
      ctx.req.header("x-vllm-source") ??
      ctx.req.header("x-source") ??
      ctx.req.header("user-agent") ??
      null;

    if (providerRouting && requestedModel) {
      parsed["model"] = providerModel.modelId;
      bodyChanged = true;
    }

    if (
      !matchedRecipe &&
      requestProvider === DEFAULT_CHAT_PROVIDER &&
      requestedModel &&
      context.config.strict_openai_models
    ) {
      throw notFound(`Model not managed: ${requestedModel}`);
    }

    // Chat proxy never launches or switches models. The frontend's explicit
    // /engines/* and /recipes/:id/launch endpoints are the only authorized
    // path to control which model is running. If the requested model isn't
    // running, reject with 503 so the caller can ask the frontend to launch
    // it instead of silently thrashing the GPU.
    if (matchedRecipe) {
      const current = await context.processManager.findInferenceProcess(
        context.config.inference_port
      );
      const matches =
        current && isRecipeRunning(matchedRecipe, current, { allowEitherPathContains: true });
      if (!matches) {
        const activeModel = current?.served_model_name ?? current?.model_path ?? null;
        warnNonRunningModel({
          requestedModel,
          requestedRecipeId: matchedRecipe.id,
          activeModel,
          source: sourceHeader,
        });
        // Return an OpenAI-shaped error so SDK callers (the pi agent runtime)
        // surface the message instead of a bare "503 status code (no body)" —
        // the SDK reads `error.message`, not FastAPI's `detail`. Keep `detail`
        // too for any non-OpenAI caller that already relies on it.
        return ctx.json(modelNotRunningError(activeModel, requestedModel), { status: 503 });
      }
    }

    const upstreamUrl =
      providerRouting && requestedModel
        ? `${providerRouting.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`
        : buildInferenceUrl(context, "/v1/chat/completions");
    const inferenceKey = process.env["INFERENCE_API_KEY"] ?? "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(providerRouting
        ? { Authorization: `Bearer ${providerRouting.apiKey}` }
        : inferenceKey
          ? { Authorization: `Bearer ${inferenceKey}` }
          : {}),
    };
    const finalBody = bodyChanged
      ? new TextEncoder().encode(JSON.stringify(parsed)).buffer
      : bodyBuffer;

    const clientSignal = ctx.req.raw.signal;
    const requestStart = performance.now();
    const recordedModel =
      matchedRecipe?.served_model_name ?? matchedRecipe?.id ?? requestedModel ?? "unknown";
    const recordedProvider = providerRouting ? requestProvider : "local";

    if (!isStreaming) {
      let response: Response;
      try {
        response = await fetch(upstreamUrl, {
          method: "POST",
          headers,
          body: finalBody,
          signal: clientSignal,
        });
      } catch (error) {
        if (clientSignal.aborted) {
          return ctx.body(null, { status: 499 });
        }
        throw error;
      }
      let result: Record<string, unknown>;
      try {
        result = (await response.json()) as Record<string, unknown>;
      } catch {
        if (clientSignal.aborted) {
          return ctx.body(null, { status: 499 });
        }
        // Upstream returned non-JSON body (empty or error text). Pass the
        // status through but don't pretend we got a structured response.
        return ctx.body(null, { status: response.status });
      }

      const usage = result["usage"] as OpenAIUsage | undefined;
      recordNonStreamingInferenceUsage(
        { logger: context.logger, stores: context.stores },
        {
          usage,
          record: {
            model: recordedModel,
            source: sourceHeader,
            session_id: sessionId,
            provider: recordedProvider,
            duration_ms: Math.round(performance.now() - requestStart),
            status: response.status,
          },
        }
      );

      attachSessionUsage(result, sessionId, usage);

      const choices = result["choices"];
      if (Array.isArray(choices)) {
        for (const choice of choices) {
          const choiceRecord = choice as Record<string, unknown>;
          const message = choiceRecord["message"] as Record<string, unknown> | undefined;
          if (!message) continue;
          // 1) If the backend emitted tool-call XML, extract `tool_calls` before stripping it.
          if (normalizeToolCallsInMessage(message)) choiceRecord["finish_reason"] = "tool_calls";
          // 2) Move <think>...</think> to `reasoning_content` and strip tool-call XML wrappers from visible content.
          normalizeReasoningAndContentInMessage(message);
          if (exposeReasoningAsContentWhenEmpty(message, recordedModel)) {
            context.logger.warn(
              "Exposed Trinity reasoning as content because visible content was empty",
              {
                model: recordedModel,
                source: sourceHeader,
              }
            );
          }
        }
      }

      return ctx.json(result, { status: response.status });
    }

    // SSE keepalive streaming path (fixes Cloudflare 502 during vLLM prefill)
    const sseEncoder = new TextEncoder();
    const KEEPALIVE_BYTES = sseEncoder.encode(": keepalive\n\n");
    const KEEPALIVE_INTERVAL_MS = 15_000;
    let keepaliveId: ReturnType<typeof setInterval> | null = null;
    const stopKeepalive = () => {
      if (keepaliveId) {
        clearInterval(keepaliveId);
        keepaliveId = null;
      }
    };

    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(KEEPALIVE_BYTES);
        keepaliveId = setInterval(() => {
          try { controller.enqueue(KEEPALIVE_BYTES); } catch {
            if (keepaliveId) { clearInterval(keepaliveId); keepaliveId = null; }
          }
        }, KEEPALIVE_INTERVAL_MS);

        let upstreamResponse: Response;
        try {
          upstreamResponse = await fetch(upstreamUrl, {
            method: "POST",
            headers,
            body: finalBody,
            signal: clientSignal,
          });
        } catch (error) {
          stopKeepalive();
          if (clientSignal.aborted) {
            try { controller.close(); } catch { /* already closed */ }
            return;
          }
          const errorPayload = JSON.stringify({
            error: {
              message: `Upstream connection failed: ${String(error)}`,
              type: "upstream_error",
            },
          });
          try {
            controller.enqueue(sseEncoder.encode(`data: ${errorPayload}\n\n`));
            controller.close();
          } catch { /* already closed */ }
          return;
        }

        if (!upstreamResponse.ok) {
          stopKeepalive();
          let errorBody = "";
          try { errorBody = await upstreamResponse.text(); } catch { /* ignore */ }
          try {
            const payload = errorBody || JSON.stringify({
              error: {
                message: `Upstream returned ${upstreamResponse.status}`,
                type: "upstream_error",
              },
            });
            controller.enqueue(sseEncoder.encode(`data: ${payload}\n\n`));
            controller.close();
          } catch { /* already closed */ }
          return;
        }

        const reader = upstreamResponse.body?.getReader();
        if (!reader) {
          stopKeepalive();
          const errorPayload = JSON.stringify({
            error: {
              message: providerRouting
                ? `${requestProvider} backend unavailable`
                : "Inference backend unavailable",
              type: "upstream_error",
            },
          });
          try {
            controller.enqueue(sseEncoder.encode(`data: ${errorPayload}\n\n`));
            controller.close();
          } catch { /* already closed */ }
          return;
        }

        let ttftMs: number | null = null;
        const reasoningParser =
          matchedRecipe && matchedRecipe.reasoning_parser !== null
            ? matchedRecipe.reasoning_parser
            : matchedRecipe
              ? getDefaultReasoningParser(matchedRecipe)
              : null;
        const toolCallStream = createToolCallStream(
          reader,
          (usage) => {
            recordStreamingInferenceUsage(
              { logger: context.logger, stores: context.stores },
              {
                usage,
                record: {
                  model: recordedModel,
                  source: sourceHeader,
                  session_id: sessionId,
                  provider: recordedProvider,
                  ttft_ms: ttftMs,
                  duration_ms: Math.round(performance.now() - requestStart),
                  status: upstreamResponse.status,
                },
              }
            );
          },
          () => {
            ttftMs ??= Math.max(0, Math.round(performance.now() - requestStart));
          },
          {
            bufferImplicitReasoningContent: shouldBufferImplicitReasoningContent(
              recordedModel,
              reasoningParser
            ),
          }
        );

        const pipeReader = toolCallStream.getReader();
        try {
          while (true) {
            const { done, value } = await pipeReader.read();
            if (done) break;
            stopKeepalive();
            controller.enqueue(value);
          }
        } catch (error) {
          if (!clientSignal.aborted) {
            context.logger.error("Stream pipe error", { error: String(error) });
          }
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },

      cancel() {
        stopKeepalive();
      },
    });

    return new Response(responseStream, { headers: buildSseHeaders() });
  });
};
