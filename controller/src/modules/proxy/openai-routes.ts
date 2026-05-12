// CRITICAL
import { performance } from "node:perf_hooks";
import type { Hono } from "hono";
import { HttpStatus, notFound, serviceUnavailable } from "../../core/errors";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import { buildSseHeaders } from "../../http/sse";
import type { AppContext } from "../../types/context";
import type { ProcessInfo, Recipe } from "../models/types";
import type { LaunchState } from "../engines/process/launch-state";
import { buildInferenceUrl } from "../../services/inference/inference-client";
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
import {
  DEFAULT_OPENAI_MODEL_ACTIVATION_POLICY,
  PROXY_SESSION_HEADER_NAMES,
} from "./configs";
import type { OpenAIModelActivationPolicy, OpenAIUsage } from "./types";

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

export const getLaunchInProgressMessage = (
  launchState: LaunchState,
  requestedRecipeId: string
): string | null => {
  const snapshot = launchState.getState();
  if (snapshot.phase === "idle") return null;
  const activeRecipeId = snapshot.recipeId ?? "unknown";
  if (activeRecipeId === requestedRecipeId) {
    return `Model ${requestedRecipeId} is still launching; refusing to start a duplicate activation`;
  }
  return `Model ${activeRecipeId} is still launching; refusing to auto-launch ${requestedRecipeId}`;
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

export const registerOpenAIRoutes = (app: Hono, context: AppContext): void => {
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

  const ensureRecipeIsActive = async (
    recipe: Recipe,
    current: ProcessInfo | null,
    policy: OpenAIModelActivationPolicy
  ): Promise<void> => {
    const launchInProgress = getLaunchInProgressMessage(context.launchState, recipe.id);
    if (launchInProgress) {
      throw serviceUnavailable(launchInProgress);
    }

    if (current && !isRecipeRunning(recipe, current, { allowEitherPathContains: true })) {
      if (policy === "switch_on_request") {
        const switchResult = await context.engineService.ensureActive(recipe, {
          force_evict: false,
        });
        if (switchResult.error) {
          throw serviceUnavailable(switchResult.error);
        }
      }
      return;
    }

    const shouldTrackAutoLaunch = !current && context.launchState.getState().phase === "idle";
    if (shouldTrackAutoLaunch) context.launchState.markLaunching(recipe.id);
    try {
      const switchResult = await context.engineService.ensureActive(recipe, {
        force_evict: false,
      });
      if (switchResult.error) {
        throw serviceUnavailable(switchResult.error);
      }
    } finally {
      if (shouldTrackAutoLaunch && context.launchState.getLaunchingRecipeId() === recipe.id) {
        context.launchState.markIdle();
      }
    }
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
      throw new HttpStatus(400, "Invalid request body");
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
      throw new HttpStatus(400, "Invalid JSON body");
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

    if (matchedRecipe) {
      const current = await context.processManager.findInferenceProcess(
        context.config.inference_port
      );
      const policy =
        context.config.openai_model_activation_policy ?? DEFAULT_OPENAI_MODEL_ACTIVATION_POLICY;
      context.logger.info("OpenAI model activation check", {
        requested_model: requestedModel,
        recipe_id: matchedRecipe.id,
        policy,
        current_model: current?.served_model_name ?? current?.model_path ?? null,
        source: sourceHeader,
      });
      const isMismatchedActive = Boolean(
        current && !isRecipeRunning(matchedRecipe, current, { allowEitherPathContains: true })
      );

      if (isMismatchedActive && policy === "load_if_idle") {
        const activeModel = current?.served_model_name ?? current?.model_path ?? "unknown";
        context.logger.warn("Rejected mismatched OpenAI model request", {
          requested_model: requestedModel,
          requested_recipe_id: matchedRecipe.id,
          active_model: activeModel,
          source: sourceHeader,
        });
        throw serviceUnavailable(
          `Model ${activeModel} is already running; refusing request for ${requestedModel}`
        );
      } else {
        await ensureRecipeIsActive(matchedRecipe, current, policy);
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

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
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
    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      return new Response(errorText, {
        status: upstreamResponse.status,
        headers: {
          "Content-Type": upstreamResponse.headers.get("Content-Type") ?? "application/json",
        },
      });
    }

    const reader = upstreamResponse.body?.getReader();
    if (!reader) {
      throw serviceUnavailable(
        providerRouting ? `${requestProvider} backend unavailable` : "Inference backend unavailable"
      );
    }

    let ttftMs: number | null = null;
    const stream = createToolCallStream(
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
      }
    );

    return new Response(stream, { headers: buildSseHeaders() });
  });
};
