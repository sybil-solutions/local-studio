import { performance } from "node:perf_hooks";
import { Effect, Schema, Stream } from "effect";
import type { AppContext } from "../../app-context";
import { buildSseHeaders } from "../../http/sse";
import type { ProviderRouteConfig } from "../../services/provider-routing";
import type { Recipe } from "../models/types";
import { getDefaultReasoningParser } from "../engines/process/model-runtime-defaults";
import { shouldBufferImplicitReasoningContent } from "./reasoning";
import { recordStreamingInferenceUsage } from "./inference-accounting";
import { createToolCallStream, type StreamUsage } from "./tool-call-stream";

const KEEPALIVE_INTERVAL_MS = 15_000;

export class ChatCompletionsStreamError extends Schema.TaggedErrorClass<ChatCompletionsStreamError>()(
  "ChatCompletionsStreamError",
  {
    stage: Schema.Literals(["connect", "response", "stream"]),
    message: Schema.String,
    source: Schema.optional(Schema.Unknown),
  },
) {}

export interface ChatCompletionsStreamParameters {
  upstreamUrl: string;
  headers: Record<string, string>;
  body: BodyInit;
  clientSignal: AbortSignal;
  matchedRecipe: Recipe | null;
  sourceHeader: string | null;
  sessionId: string | null;
  recordedModel: string;
  recordedProvider: string;
  requestStart: number;
  requestProvider: string;
  providerRouting: ProviderRouteConfig | null;
  context: Pick<AppContext, "logger" | "stores">;
  keepaliveIntervalMs?: number;
}

const errorFrame = (message: string): Uint8Array =>
  new TextEncoder().encode(
    `data: ${JSON.stringify({ error: { message, type: "upstream_error" } })}\n\n`,
  );

const responseErrorFrame = (status: number, body: string): Uint8Array =>
  new TextEncoder().encode(
    `data: ${body || JSON.stringify({ error: { message: `Upstream returned ${status}`, type: "upstream_error" } })}\n\n`,
  );

const responseBodyStream = (
  upstreamResponse: Response,
  parameters: ChatCompletionsStreamParameters,
): Stream.Stream<Uint8Array, never> => {
  const {
    matchedRecipe,
    sourceHeader,
    sessionId,
    recordedModel,
    recordedProvider,
    requestStart,
    providerRouting,
    requestProvider,
    context,
  } = parameters;
  const source = upstreamResponse.body;
  if (!source) {
    return Stream.succeed(
      errorFrame(
        providerRouting
          ? `${requestProvider} backend unavailable`
          : "Inference backend unavailable",
      ),
    );
  }
  let ttftMs: number | null = null;
  let observedUsage: StreamUsage | null = null;
  const reasoningParser =
    matchedRecipe && matchedRecipe.reasoning_parser !== null
      ? matchedRecipe.reasoning_parser
      : matchedRecipe
        ? getDefaultReasoningParser(matchedRecipe)
        : null;
  const transformed = createToolCallStream(
    source,
    (usage) => {
      observedUsage = usage;
    },
    () => {
      ttftMs ??= Math.max(0, Math.round(performance.now() - requestStart));
    },
    {
      bufferImplicitReasoningContent: shouldBufferImplicitReasoningContent(
        recordedModel,
        reasoningParser,
      ),
    },
  );
  return Stream.fromReadableStream({
    evaluate: () => transformed,
    onError: (source) =>
      new ChatCompletionsStreamError({
        stage: "stream",
        message: "Chat completions stream failed",
        source,
      }),
  }).pipe(
    Stream.catchCause((cause) => {
      if (!parameters.clientSignal.aborted) {
        context.logger.error("Stream pipe error", { error: String(cause) });
      }
      return Stream.empty;
    }),
    Stream.ensuring(
      Effect.suspend(() =>
        observedUsage
          ? recordStreamingInferenceUsage(
              { logger: context.logger, stores: context.stores },
              {
                usage: observedUsage,
                record: {
                  model: recordedModel,
                  source: sourceHeader,
                  session_id: sessionId,
                  provider: recordedProvider,
                  ttft_ms: ttftMs,
                  duration_ms: Math.round(performance.now() - requestStart),
                  status: upstreamResponse.status,
                },
              },
            ).pipe(
              Effect.catch((error) =>
                Effect.sync(() =>
                  context.logger.warn("Streaming accounting failed", { error: String(error) }),
                ),
              ),
            )
          : Effect.void,
      ),
    ),
  );
};

const upstreamStream = (
  parameters: ChatCompletionsStreamParameters,
): Stream.Stream<Uint8Array, never> =>
  Stream.unwrap(
    Effect.tryPromise({
      try: (signal) =>
        fetch(parameters.upstreamUrl, {
          method: "POST",
          headers: parameters.headers,
          body: parameters.body,
          signal: AbortSignal.any([parameters.clientSignal, signal]),
        }),
      catch: (source) =>
        new ChatCompletionsStreamError({
          stage: "connect",
          message: "Chat completions connection failed",
          source,
        }),
    }).pipe(
      Effect.flatMap((response) => {
        if (response.ok) return Effect.succeed(responseBodyStream(response, parameters));
        return Effect.tryPromise({
          try: () => response.text(),
          catch: (source) =>
            new ChatCompletionsStreamError({
              stage: "response",
              message: "Chat completions response failed",
              source,
            }),
        }).pipe(
          Effect.map((body) => Stream.succeed(responseErrorFrame(response.status, body))),
          Effect.catch(() =>
            Effect.succeed(Stream.succeed(responseErrorFrame(response.status, ""))),
          ),
        );
      }),
      Effect.catch((error) =>
        Effect.succeed(
          parameters.clientSignal.aborted
            ? Stream.empty
            : Stream.succeed(errorFrame(`Upstream connection failed: ${error.message}`)),
        ),
      ),
    ),
  );

export const buildChatCompletionsStreamResponse = (
  parameters: ChatCompletionsStreamParameters,
): Response => {
  const keepalive = new TextEncoder().encode(": keepalive\n\n");
  const heartbeat = Stream.concat(
    Stream.succeed(keepalive),
    Stream.tick(parameters.keepaliveIntervalMs ?? KEEPALIVE_INTERVAL_MS).pipe(
      Stream.map(() => keepalive),
    ),
  );
  const stream = Stream.merge(upstreamStream(parameters), heartbeat, { haltStrategy: "left" });
  return new Response(Stream.toReadableStream(stream), { headers: buildSseHeaders() });
};
