import { performance } from "node:perf_hooks";
import { Effect, Schema } from "effect";
import { HttpStatus, notFound } from "../../core/errors";
import { effectHandler } from "../../http/effect-handler";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import type { Recipe } from "../models/types";
import { buildInferenceUrl } from "../../http/local-fetch";
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

export const registerOpenAIRoutes = defineRoutes((app, context) => {
  const warnNonRunningModel = createNonRunningModelWarner(context.logger);

  interface ParsedChatBody {
    parsed: Record<string, unknown>;
    requestedModel: string | null;
    matchedRecipe: Recipe | null;
    isStreaming: boolean;
    bodyChanged: boolean;
    sessionId: string | null;
  }
  const ChatRequestSchema = Schema.Record(Schema.String, Schema.Unknown);

  const parseChatBody = (
    bodyBuffer: ArrayBuffer,
    getHeader: (name: string) => string | undefined,
  ): Effect.Effect<ParsedChatBody, HttpStatus | unknown> =>
    Effect.gen(function* () {
      const decoded = yield* Effect.try({
        try: () =>
          Schema.decodeUnknownSync(ChatRequestSchema)(
            JSON.parse(new TextDecoder().decode(bodyBuffer)),
          ),
        catch: () => new HttpStatus({ status: 400, detail: "Invalid JSON body" }),
      });
      const parsed: Record<string, unknown> = { ...decoded };
      const sessionId = extractSessionId(parsed, getHeader);
      let requestedModel: string | null = null;
      let matchedRecipe: Recipe | null = null;
      let bodyChanged = false;
      normalizeToolRequest(parsed);
      if (normalizeChatMessageContentParts(parsed)) {
        bodyChanged = true;
      }
      if (typeof parsed["model"] === "string") {
        requestedModel = parsed["model"];
        matchedRecipe = yield* findRecipeByModel(requestedModel, context);
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
      const isStreaming = Boolean(parsed["stream"]);
      if (ensureStreamingUsageIncluded(parsed)) {
        bodyChanged = true;
      }
      return { parsed, requestedModel, matchedRecipe, isStreaming, bodyChanged, sessionId };
    });

  const resolveChatUpstream = (
    requestedModel: string | null,
    parsed: Record<string, unknown>,
  ): {
    upstreamUrl: string;
    headers: Record<string, string>;
    requestProvider: string;
    providerRouting: ReturnType<typeof resolveProviderConfig>;
    rewroteModel: boolean;
  } => {
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
    let rewroteModel = false;
    if (providerRouting && requestedModel) {
      parsed["model"] = providerModel.modelId;
      rewroteModel = true;
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
    return { upstreamUrl, headers, requestProvider, providerRouting, rewroteModel };
  };

  const gateOnRunningModel = (
    matchedRecipe: Recipe,
    requestedModel: string | null,
    sourceHeader: string | null,
  ): Effect.Effect<ModelNotRunningError | null, unknown> =>
    context.processManager.findInferenceProcess(context.config.inference_port).pipe(
      Effect.map((current) => {
        const matches =
          current && isRecipeRunning(matchedRecipe, current, { allowEitherPathContains: true });
        if (matches) return null;
        const activeModel = current?.served_model_name ?? current?.model_path ?? null;
        warnNonRunningModel({
          requestedModel,
          requestedRecipeId: matchedRecipe.id,
          activeModel,
          source: sourceHeader,
        });
        return modelNotRunningError(activeModel, requestedModel);
      }),
    );

  const normalizeCompletionChoices = (
    result: Record<string, unknown>,
    recordedModel: string,
    sourceHeader: string | null,
  ): void => {
    const choices = result["choices"];
    if (!Array.isArray(choices)) return;
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
          },
        );
      }
    }
  };

  return mergeRoutes(
    app.post(
      "/v1/chat/completions",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const bodyRead = yield* Effect.tryPromise({
            try: () => ctx.req.arrayBuffer(),
            catch: () => new HttpStatus({ status: 400, detail: "Invalid request body" }),
          }).pipe(
            Effect.match({
              onFailure: (error) => ({ ok: false as const, error }),
              onSuccess: (value) => ({ ok: true as const, value }),
            }),
          );
          if (!bodyRead.ok) {
            return ctx.req.raw.signal.aborted
              ? new Response(null, { status: 499 })
              : yield* Effect.fail(bodyRead.error);
          }
          const bodyBuffer = bodyRead.value;
          const { parsed, requestedModel, matchedRecipe, isStreaming, bodyChanged, sessionId } =
            yield* parseChatBody(bodyBuffer, (name) => ctx.req.header(name));
          const { upstreamUrl, headers, requestProvider, providerRouting, rewroteModel } =
            resolveChatUpstream(requestedModel, parsed);
          const sourceHeader =
            ctx.req.header("x-vllm-source") ??
            ctx.req.header("x-source") ??
            ctx.req.header("user-agent") ??
            null;

          if (
            !matchedRecipe &&
            requestProvider === DEFAULT_CHAT_PROVIDER &&
            requestedModel &&
            context.config.strict_openai_models
          ) {
            return yield* Effect.fail(notFound(`Model not managed: ${requestedModel}`));
          }

          if (matchedRecipe) {
            const rejection = yield* gateOnRunningModel(
              matchedRecipe,
              requestedModel,
              sourceHeader,
            );
            if (rejection) return ctx.json(rejection, { status: 503 });
          }

          const finalBody =
            bodyChanged || rewroteModel
              ? new TextEncoder().encode(JSON.stringify(parsed)).buffer
              : bodyBuffer;

          const clientSignal = ctx.req.raw.signal;
          const requestStart = performance.now();
          const recordedModel =
            matchedRecipe?.served_model_name ?? matchedRecipe?.id ?? requestedModel ?? "unknown";
          const recordedProvider = providerRouting ? requestProvider : "local";

          if (!isStreaming) {
            const fetched = yield* Effect.tryPromise({
              try: (signal) =>
                fetch(upstreamUrl, {
                  method: "POST",
                  headers,
                  body: finalBody,
                  signal: AbortSignal.any([clientSignal, signal]),
                }),
              catch: (source) => source,
            }).pipe(
              Effect.match({
                onFailure: (error) => ({ ok: false as const, error }),
                onSuccess: (value) => ({ ok: true as const, value }),
              }),
            );
            if (!fetched.ok) {
              return clientSignal.aborted
                ? new Response(null, { status: 499 })
                : yield* Effect.fail(fetched.error);
            }
            const response = fetched.value;
            const decoded = yield* Effect.tryPromise({
              try: () => response.json(),
              catch: (source) => source,
            }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(ChatRequestSchema)),
              Effect.match({
                onFailure: (error) => ({ ok: false as const, error }),
                onSuccess: (value) => ({ ok: true as const, value }),
              }),
            );
            if (!decoded.ok) {
              if (clientSignal.aborted) return new Response(null, { status: 499 });
              return new Response(null, { status: response.status });
            }
            const result = { ...decoded.value };

            const usage = result["usage"] as OpenAIUsage | undefined;
            yield* recordNonStreamingInferenceUsage(
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
              },
            );

            attachSessionUsage(result, sessionId, usage);
            normalizeCompletionChoices(result, recordedModel, sourceHeader);

            return Response.json(result, { status: response.status });
          }

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
        }),
      ),
    ),
  );
});
