import { performance } from "node:perf_hooks";
import { HttpStatus } from "../../core/errors";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import type { RouteRegistrar } from "../../http/route-registrar";
import { buildSseHeaders } from "../../http/sse";
import { buildInferenceUrl, fetchInference } from "../../services/inference-client";
import {
  anthropicErrorBody,
  anthropicPromptText,
  anthropicRequestToOpenAI,
  openAIResponseToAnthropic,
  type WireRecord,
} from "./anthropic-messages";
import { createAnthropicStreamTranslator, parseSseLine } from "./anthropic-messages-stream";
import {
  createNonRunningModelWarner,
  findRecipeByModel,
  type OpenAIUsage,
} from "./chat-request";
import {
  recordNonStreamingInferenceUsage,
  recordStreamingInferenceUsage,
} from "./inference-accounting";

const KEEPALIVE_INTERVAL_MS = 15_000;
const ANTHROPIC_SOURCE_HEADERS = ["x-vllm-source", "x-source", "user-agent"] as const;

const TOKENIZE_UPSTREAMS = [
  { path: "/tokenize", body: (model: unknown, prompt: string) => ({ model, prompt }) },
  { path: "/v1/token/encode", body: (_model: unknown, prompt: string) => ({ text: prompt }) },
] as const;

const countUpstreamTokens = async (
  context: Parameters<RouteRegistrar>[1],
  model: unknown,
  prompt: string
): Promise<number | null> => {
  for (const upstream of TOKENIZE_UPSTREAMS) {
    const response = await fetchInference(context, upstream.path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(upstream.body(model, prompt)),
    });
    if (response.status !== 200) continue;
    const data = (await response.json()) as { tokens?: unknown[]; length?: number };
    if (typeof data.length === "number") return data.length;
    if (Array.isArray(data.tokens)) return data.tokens.length;
  }
  return null;
};

export const registerAnthropicRoutes: RouteRegistrar = (app, context) => {
  const warnNonRunningModel = createNonRunningModelWarner(context.logger);

  app.post("/v1/messages/count_tokens", async (ctx) => {
    let body: WireRecord;
    try {
      body = (await ctx.req.json()) as WireRecord;
    } catch {
      return ctx.json(anthropicErrorBody("Invalid JSON body", "invalid_request_error"), {
        status: 400,
      });
    }
    const prompt = anthropicPromptText(body);
    try {
      const count = await countUpstreamTokens(context, body["model"], prompt);
      if (count !== null) return ctx.json({ input_tokens: count });
      return ctx.json(anthropicErrorBody("Tokenization is not supported by the running backend"), {
        status: 502,
      });
    } catch (error) {
      return ctx.json(anthropicErrorBody(String(error)), { status: 502 });
    }
  });

  app.post("/v1/messages", async (ctx) => {
    let body: WireRecord;
    try {
      body = (await ctx.req.json()) as WireRecord;
    } catch {
      if (ctx.req.raw.signal.aborted) return ctx.body(null, { status: 499 });
      throw new HttpStatus({ status: 400, detail: "Invalid JSON body" });
    }

    const requestedModel = typeof body["model"] === "string" ? body["model"] : null;
    const matchedRecipe = requestedModel ? findRecipeByModel(requestedModel, context) : null;
    const canonicalModel = matchedRecipe
      ? (matchedRecipe.served_model_name ?? matchedRecipe.id)
      : requestedModel;
    if (canonicalModel && canonicalModel !== body["model"]) {
      body["model"] = canonicalModel;
    }
    const sourceHeader =
      ANTHROPIC_SOURCE_HEADERS.map((name) => ctx.req.header(name)).find(Boolean) ?? null;

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
        const message = activeModel
          ? `Model ${activeModel} is running; ${requestedModel} is not. Launch it from the frontend before sending requests.`
          : `No model is running. Launch ${requestedModel} from the frontend before sending requests.`;
        return ctx.json(anthropicErrorBody(message, "overloaded_error"), { status: 503 });
      }
    }

    const openAIBody = anthropicRequestToOpenAI(body);
    const isStreaming = openAIBody["stream"] === true;
    const upstreamUrl = buildInferenceUrl(context, "/v1/chat/completions");
    const inferenceKey = process.env["INFERENCE_API_KEY"] ?? "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(inferenceKey ? { Authorization: `Bearer ${inferenceKey}` } : {}),
    };
    const clientSignal = ctx.req.raw.signal;
    const requestStart = performance.now();
    const recordedModel = canonicalModel ?? "unknown";

    if (!isStreaming) {
      let response: Response;
      try {
        response = await fetch(upstreamUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(openAIBody),
          signal: clientSignal,
        });
      } catch (error) {
        if (clientSignal.aborted) return ctx.body(null, { status: 499 });
        throw error;
      }
      let result: WireRecord;
      try {
        result = (await response.json()) as WireRecord;
      } catch {
        if (clientSignal.aborted) return ctx.body(null, { status: 499 });
        return ctx.json(anthropicErrorBody(`Upstream returned ${response.status}`), {
          status: response.status,
        });
      }
      if (!response.ok) {
        const upstreamError = result["error"];
        const message =
          typeof upstreamError === "object" && upstreamError !== null
            ? String((upstreamError as WireRecord)["message"] ?? response.status)
            : String(result["detail"] ?? response.status);
        return ctx.json(anthropicErrorBody(message), { status: response.status });
      }
      recordNonStreamingInferenceUsage(
        { logger: context.logger, stores: context.stores },
        {
          usage: result["usage"] as OpenAIUsage | undefined,
          record: {
            model: recordedModel,
            source: sourceHeader,
            session_id: null,
            provider: "local",
            duration_ms: Math.round(performance.now() - requestStart),
            status: response.status,
          },
        }
      );
      return ctx.json(openAIResponseToAnthropic(result), { status: 200 });
    }

    openAIBody["stream_options"] = { include_usage: true };
    const translator = createAnthropicStreamTranslator(recordedModel);
    const encoder = new TextEncoder();
    const keepaliveBytes = encoder.encode(
      `event: ping\ndata: ${JSON.stringify({ type: "ping" })}\n\n`
    );
    let keepaliveId: ReturnType<typeof setInterval> | null = null;
    const stopKeepalive = (): void => {
      if (keepaliveId) {
        clearInterval(keepaliveId);
        keepaliveId = null;
      }
    };
    let ttftMs: number | null = null;

    const recordUsage = (status: number): void => {
      const usage = translator.usage();
      if (!usage) return;
      recordStreamingInferenceUsage(
        { logger: context.logger, stores: context.stores },
        {
          usage: usage as OpenAIUsage,
          record: {
            model: recordedModel,
            source: sourceHeader,
            session_id: null,
            provider: "local",
            ttft_ms: ttftMs,
            duration_ms: Math.round(performance.now() - requestStart),
            status,
          },
        }
      );
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller): Promise<void> {
        const send = (frames: string[]): void => {
          for (const frame of frames) controller.enqueue(encoder.encode(frame));
        };
        keepaliveId = setInterval(() => {
          try {
            controller.enqueue(keepaliveBytes);
          } catch {
            stopKeepalive();
          }
        }, KEEPALIVE_INTERVAL_MS);

        let upstreamResponse: Response;
        try {
          upstreamResponse = await fetch(upstreamUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(openAIBody),
            signal: clientSignal,
          });
        } catch (error) {
          stopKeepalive();
          if (!clientSignal.aborted) {
            send([
              `event: error\ndata: ${JSON.stringify(anthropicErrorBody(`Upstream connection failed: ${String(error)}`))}\n\n`,
            ]);
          }
          controller.close();
          return;
        }
        if (!upstreamResponse.ok || !upstreamResponse.body) {
          stopKeepalive();
          send([
            `event: error\ndata: ${JSON.stringify(anthropicErrorBody(`Upstream returned ${upstreamResponse.status}`))}\n\n`,
          ]);
          controller.close();
          return;
        }

        const reader = upstreamResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const parsed = parseSseLine(line);
              if (parsed === null || parsed === "done") continue;
              ttftMs ??= Math.max(0, Math.round(performance.now() - requestStart));
              send(translator.translateChunk(parsed));
            }
          }
          send(translator.finish());
          recordUsage(upstreamResponse.status);
        } catch (error) {
          if (!clientSignal.aborted) {
            context.logger.error("Anthropic stream pipe error", { error: String(error) });
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

    return new Response(stream, { headers: buildSseHeaders() });
  });
};
