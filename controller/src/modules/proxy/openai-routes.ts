import { performance } from "node:perf_hooks";
import { HttpStatus, notFound } from "../../core/errors";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import type { RouteRegistrar } from "../../http/route-registrar";
import type { Recipe } from "../models/types";
import { buildInferenceUrl, buildLocalUrl } from "../../http/local-fetch";
import {
  DEFAULT_CHAT_PROVIDER,
  parseProviderModel,
  resolveProviderConfig,
} from "../../services/provider-routing";
import { normalizeChatMessageContentParts, normalizeToolRequest } from "./content-normalizer";
import {
  normalizeReasoningAndContentInMessage,
  normalizeToolCallsInMessage,
  exposeReasoningAsContentWhenEmpty,
} from "./reasoning";
import { recordNonStreamingInferenceUsage } from "./inference-accounting";
import {
  attachSessionUsage,
  createNonRunningModelWarner,
  ensureStreamingUsageIncluded,
  extractSessionId,
  findRecipeByModel,
  type OpenAIUsage,
} from "./chat-request";
import { buildChatCompletionsStreamResponse } from "./chat-completions-stream";

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
  requestedModel: string | null | undefined
): ModelNotRunningError => {
  const message = activeModel
    ? `Model ${activeModel} is running; ${requestedModel} is not. Launch it from the frontend before sending requests.`
    : `No model is running. Launch ${requestedModel} from the frontend before sending requests.`;
  return {
    error: { message, type: "model_not_running", code: "model_not_running" },
    detail: message,
  };
};

export const registerOpenAIRoutes: RouteRegistrar = (app, context) => {
  const warnNonRunningModel = createNonRunningModelWarner(context.logger);

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
        matchedRecipe = findRecipeByModel(requestedModel, context);
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

    // Resolve target port: check primary first, then shared instances.
    let targetPort = context.config.inference_port;
    if (matchedRecipe) {
      const current = await context.processManager.findInferenceProcess(
        context.config.inference_port
      );
      const primaryMatches =
        current && isRecipeRunning(matchedRecipe, current, { allowEitherPathContains: true });
      if (!primaryMatches) {
        const instance = context.instanceRegistry.get(matchedRecipe.id);
        if (instance?.phase === "ready") {
          targetPort = instance.port;
        } else {
          const activeModel = current?.served_model_name ?? current?.model_path ?? null;
          warnNonRunningModel({
            requestedModel,
            requestedRecipeId: matchedRecipe.id,
            activeModel,
            source: sourceHeader,
          });
          return ctx.json(modelNotRunningError(activeModel, requestedModel), { status: 503 });
        }
      }
    }

    const upstreamUrl =
      providerRouting && requestedModel
        ? `${providerRouting.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`
        : buildLocalUrl(targetPort, "/v1/chat/completions", context.config.inference_host);
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
          if (normalizeToolCallsInMessage(message)) choiceRecord["finish_reason"] = "tool_calls";
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
    return buildChatCompletionsStreamResponse({
      upstreamUrl,
      headers,
      body: finalBody,
      clientSignal,
      matchedRecipe,
      sourceHeader,
      sessionId,
      recordedModel,
      recordedProvider,
      requestStart,
      requestProvider,
      providerRouting,
      context,
    });
  });
};
