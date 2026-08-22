import { performance } from "node:perf_hooks";
import { Effect, Schema } from "effect";
import { HttpStatus, notFound } from "../../core/errors";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import { effectRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import type { Recipe } from "../models/types";
import { DEFAULT_CHAT_PROVIDER } from "../../services/provider-routing";
import { normalizeChatMessageContentParts, normalizeToolRequest } from "./content-normalizer";
import {
  normalizeReasoningAndContentInMessage,
  normalizeToolCallsInMessage,
  exposeReasoningAsContentWhenEmpty,
  stripDeepSeekControlTokens,
} from "./reasoning";
import {
  recordInferenceUsage,
  type InferenceUsageInput,
} from "./inference-accounting";
import {
  attachSessionUsage,
  createNonRunningModelWarner,
  ensureStreamingUsageIncluded,
  extractSessionId,
  findRecipeByModel,
  resolveUpstreamForModel,
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

const isDeepSeekV4ControllerRecipe = (recipe: Recipe | null): boolean => {
  if (!recipe) return false;
  return `${recipe.id} ${recipe.name} ${recipe.served_model_name ?? ""}`
    .toLowerCase()
    .includes("deepseek-v4");
};

/**
 * DeepSeek's hosted API has a different reasoning protocol from our local
 * DeepSeek V4 vLLM endpoint. A stale desktop client may send its hosted-only
 * `thinking` field and inject blank `reasoning_content` fields when replaying
 * tool turns. Remove only that incompatible transport residue at the
 * controller boundary, while preserving actual reasoning and reasoning_effort.
 */
export const sanitizeDeepSeekV4ControllerRequest = (
  body: Record<string, unknown>,
  recipe: Recipe | null,
): boolean => {
  if (!isDeepSeekV4ControllerRecipe(recipe)) return false;

  let changed = false;
  if ("thinking" in body) {
    delete body["thinking"];
    changed = true;
  }

  const messages = body["messages"];
  if (!Array.isArray(messages)) return changed;
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const record = message as Record<string, unknown>;
    if (
      typeof record["reasoning_content"] === "string" &&
      record["reasoning_content"].trim().length === 0
    ) {
      delete record["reasoning_content"];
      changed = true;
    }
    if (typeof record["content"] === "string") {
      const cleaned = stripDeepSeekControlTokens(record["content"]);
      if (cleaned !== record["content"]) {
        record["content"] = cleaned;
        changed = true;
      }
    }
  }
  return changed;
};

const abortAware = <A, E>(
  effect: Effect.Effect<A, E>,
  signal: AbortSignal,
): Effect.Effect<{ aborted: true } | { aborted: false; value: A }, E> =>
  effect.pipe(
    Effect.map((value) => ({ aborted: false as const, value })),
    Effect.catch((error) =>
      signal.aborted ? Effect.succeed({ aborted: true as const }) : Effect.fail(error),
    ),
  );

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
      if (sanitizeDeepSeekV4ControllerRequest(parsed, matchedRecipe)) {
        bodyChanged = true;
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

  const gateOnRunningModel = (
    matchedRecipe: Recipe,
    requestedModel: string | null,
    sourceHeader: string | null,
  ): Effect.Effect<ModelNotRunningError | null, unknown> =>
    context.bridge.findInferenceProcess().pipe(
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
    effectRoute(app.post, "/v1/chat/completions", (ctx) =>
      Effect.gen(function* () {
        const bodyRead = yield* abortAware(
          Effect.tryPromise({
            try: () => ctx.req.arrayBuffer(),
            catch: () => new HttpStatus({ status: 400, detail: "Invalid request body" }),
          }),
          ctx.req.raw.signal,
        );
        if (bodyRead.aborted) return new Response(null, { status: 499 });
        const bodyBuffer = bodyRead.value;
        const { parsed, requestedModel, matchedRecipe, isStreaming, bodyChanged, sessionId } =
          yield* parseChatBody(bodyBuffer, (name) => ctx.req.header(name));
        const { upstreamUrl, auth, requestProvider, providerRouting, rewroteModel } =
          resolveUpstreamForModel(requestedModel, parsed, "/v1/chat/completions", context);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          ...auth,
        };
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
          const rejection = yield* gateOnRunningModel(matchedRecipe, requestedModel, sourceHeader);
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
          const fetched = yield* abortAware(
            Effect.tryPromise({
              try: (signal) =>
                fetch(upstreamUrl, {
                  method: "POST",
                  headers,
                  body: finalBody,
                  signal: AbortSignal.any([clientSignal, signal]),
                }),
              catch: (source) => source,
            }),
            clientSignal,
          );
          if (fetched.aborted) return new Response(null, { status: 499 });
          const response = fetched.value;
          const decoded = yield* abortAware(
            Effect.tryPromise({ try: () => response.json(), catch: (source) => source }).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(ChatRequestSchema)),
            ),
            clientSignal,
          ).pipe(Effect.catch(() => Effect.succeed(null)));
          if (!decoded) return new Response(null, { status: response.status });
          if (decoded.aborted) return new Response(null, { status: 499 });
          const result = { ...decoded.value };

          const usage = result["usage"] as InferenceUsageInput | undefined;
          const usageTotals = yield* recordInferenceUsage(
            { logger: context.logger, stores: context.stores },
            {
              usage,
              streamed: false,
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

          attachSessionUsage(result, sessionId, usageTotals);
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
  );
});
