import { performance } from "node:perf_hooks";
import type { AppContext } from "../../app-context";
import { buildSseHeaders } from "../../http/sse";
import type { ProviderRouteConfig } from "../../services/provider-routing";
import type { Recipe } from "../models/types";
import { getDefaultReasoningParser } from "../engines/process/model-runtime-defaults";
import { shouldBufferImplicitReasoningContent } from "./reasoning";
import { recordStreamingInferenceUsage } from "./inference-accounting";
import { createToolCallStream } from "./tool-call-stream";

const KEEPALIVE_INTERVAL_MS = 15_000;

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

/**
 * Proxies an upstream chat-completions SSE stream to the client, with a
 * keepalive ping every 15s so Cloudflare doesn't 502 the connection during a
 * long vLLM prefill (no bytes otherwise flow until the first token).
 */
export const buildChatCompletionsStreamResponse = (
  parameters: ChatCompletionsStreamParameters,
): Response => {
  const {
    upstreamUrl,
    headers,
    body,
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
    keepaliveIntervalMs = KEEPALIVE_INTERVAL_MS,
  } = parameters;

  const sseEncoder = new TextEncoder();
  const keepaliveBytes = sseEncoder.encode(": keepalive\n\n");
  let keepaliveId: ReturnType<typeof setInterval> | null = null;
  const stopKeepalive = (): void => {
    if (keepaliveId) {
      clearInterval(keepaliveId);
      keepaliveId = null;
    }
  };

  const responseStream = new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      controller.enqueue(keepaliveBytes);
      keepaliveId = setInterval(() => {
        try {
          controller.enqueue(keepaliveBytes);
        } catch {
          if (keepaliveId) {
            clearInterval(keepaliveId);
            keepaliveId = null;
          }
        }
      }, keepaliveIntervalMs);

      let upstreamResponse: Response;
      try {
        upstreamResponse = await fetch(upstreamUrl, {
          method: "POST",
          headers,
          body,
          signal: clientSignal,
        });
      } catch (error) {
        stopKeepalive();
        if (clientSignal.aborted) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
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
        } catch {
          /* already closed */
        }
        return;
      }

      if (!upstreamResponse.ok) {
        stopKeepalive();
        let errorBody = "";
        try {
          errorBody = await upstreamResponse.text();
        } catch {
          /* ignore */
        }
        try {
          const payload =
            errorBody ||
            JSON.stringify({
              error: {
                message: `Upstream returned ${upstreamResponse.status}`,
                type: "upstream_error",
              },
            });
          controller.enqueue(sseEncoder.encode(`data: ${payload}\n\n`));
          controller.close();
        } catch {
          /* already closed */
        }
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
        } catch {
          /* already closed */
        }
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
            },
          );
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

      const pipeReader = toolCallStream.getReader();
      try {
        while (true) {
          const { done, value } = await pipeReader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } catch (error) {
        if (!clientSignal.aborted) {
          context.logger.error("Stream pipe error", { error: String(error) });
        }
      } finally {
        stopKeepalive();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },

    cancel(): void {
      stopKeepalive();
    },
  });

  return new Response(responseStream, { headers: buildSseHeaders() });
};
