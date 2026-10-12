import { performance } from "node:perf_hooks";
import { Effect, Stream } from "effect";
import type { Context } from "hono";
import { HttpStatus, notFound } from "../../core/errors";
import { buildSseHeaders } from "../../http/sse";
import { defineRoutes, effectRoute, mergeRoutes } from "../../http/route-registrar";
import type { ControllerEffect, ControllerEnvironment } from "../../http/effect-handler";
import { isRecipeRunning } from "../models/recipes/recipe-matching";
import type { Recipe } from "../models/types";
import { DEFAULT_CHAT_PROVIDER } from "../../services/provider-routing";
import {
  createNonRunningModelWarner,
  ensureStreamingUsageIncluded,
  extractSessionId,
  findRecipeByModel,
  resolveUpstreamForModel,
} from "./chat-request";
import {
  recordNonStreamingInferenceUsage,
  recordStreamingInferenceUsage,
  type InferenceUsageInput,
} from "./inference-accounting";
import { createUsageObserver, usageFromPayload, type ProxyDialect } from "./usage-observer";
import { createContextGuard, type ContextLimits } from "./context-guard";
import { normalizeResponsesBody } from "./responses-normalizer";

/**
 * The one inference proxy: OpenAI chat completions, OpenAI Responses, and
 * Anthropic Messages, all served the same way. The engines this controller
 * launches speak all three dialects natively — vLLM and SGLang serve
 * /v1/responses and /v1/messages beside /v1/chat/completions — so the
 * controller's job is routing, auth, and recording — never translation, with
 * one exception: lax Responses-API item shapes are normalized to the strict
 * schema vLLM validates against (see responses-normalizer.ts).
 *
 * The request body is forwarded verbatim except for the model field (resolved
 * against the recipe store so aliases reach the engine under its served model
 * name, or rewritten for a configured "provider/model" route) and, for chat
 * streams, stream_options.include_usage so usage can be recorded. Responses
 * stream back byte-for-byte; a side observer reads token usage out of the
 * frames without touching them.
 */

const KEEPALIVE_INTERVAL_MS = 15_000;

interface DialectRoute {
  dialect: ProxyDialect;
  path: "/v1/chat/completions" | "/v1/responses" | "/v1/messages";
}

const DIALECTS: readonly DialectRoute[] = [
  { dialect: "chat", path: "/v1/chat/completions" },
  { dialect: "responses", path: "/v1/responses" },
  { dialect: "messages", path: "/v1/messages" },
];

/** Client protocol headers each dialect expects the upstream to see. */
const FORWARDED_HEADERS = ["anthropic-version", "anthropic-beta", "openai-beta"] as const;

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

const errorFrame = (message: string): Uint8Array =>
  new TextEncoder().encode(
    `data: ${JSON.stringify({ error: { message, type: "upstream_error" } })}\n\n`,
  );

export const registerPassthroughRoutes = defineRoutes((app, context) => {
  const warnNonRunningModel = createNonRunningModelWarner(context.logger);
  const contextGuard = createContextGuard(context);

  const gateOnRunningModel = (
    matchedRecipe: Recipe,
    requestedModel: string | null,
    sourceHeader: string | null,
  ): Effect.Effect<ModelNotRunningError | null, unknown> =>
    context.compute.model.findInferenceProcess().pipe(
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

  const streamedResponse = (input: {
    dialect: ProxyDialect;
    upstream: Response;
    body: ReadableStream<Uint8Array>;
    clientSignal: AbortSignal;
    record: {
      model: string;
      source: string | null;
      session_id: string | null;
      provider: string;
    };
    requestStart: number;
    extraHeaders?: Record<string, string>;
  }): Response => {
    const merged: InferenceUsageInput = {};
    let sawUsage = false;
    let ttftMs: number | null = null;
    const observed = input.body.pipeThrough(
      createUsageObserver(input.dialect, {
        onUsage: (usage) => {
          sawUsage = true;
          Object.assign(merged, usage);
        },
        onFirstFrame: () => {
          ttftMs ??= Math.max(0, Math.round(performance.now() - input.requestStart));
        },
      }),
    );
    const upstream = Stream.fromReadableStream({
      evaluate: () => observed,
      onError: (source) => source,
    }).pipe(
      Stream.catchCause((cause) => {
        if (!input.clientSignal.aborted) {
          context.logger.error("Passthrough stream failed", { error: String(cause) });
        }
        return Stream.empty;
      }),
      Stream.ensuring(
        Effect.suspend(() => {
          if (sawUsage) contextGuard.observe(input.record, merged);
          return sawUsage
            ? recordStreamingInferenceUsage(
                { logger: context.logger, stores: context.stores },
                {
                  usage: merged,
                  record: {
                    ...input.record,
                    ttft_ms: ttftMs,
                    duration_ms: Math.round(performance.now() - input.requestStart),
                    status: input.upstream.status,
                  },
                },
              ).pipe(
                Effect.catch((error) =>
                  Effect.sync(() =>
                    context.logger.warn("Streaming accounting failed", { error: String(error) }),
                  ),
                ),
              )
            : Effect.void;
        }),
      ),
    );
    // Chat clients idle through long generations behind proxies that time out
    // silent connections; SSE comment keepalives are protocol-invisible. The
    // other dialects heartbeat themselves (Messages sends ping events).
    const keepalive = new TextEncoder().encode(": keepalive\n\n");
    const heartbeat = Stream.concat(
      Stream.succeed(keepalive),
      Stream.tick(KEEPALIVE_INTERVAL_MS).pipe(Stream.map(() => keepalive)),
    );
    const stream =
      input.dialect === "chat"
        ? Stream.merge(upstream, heartbeat, { haltStrategy: "left" })
        : upstream;
    return new Response(Stream.toReadableStream(stream), {
      status: input.upstream.status,
      headers: buildSseHeaders(input.extraHeaders ?? {}),
    });
  };

  const forward =
    ({ dialect, path }: DialectRoute) =>
    (ctx: Context<ControllerEnvironment>): ControllerEffect<Response, unknown> =>
      Effect.gen(function* () {
        const clientSignal = ctx.req.raw.signal;
        const bodyRead = yield* Effect.tryPromise({
          try: () => ctx.req.json<Record<string, unknown>>(),
          catch: () => new HttpStatus({ status: 400, detail: "Invalid JSON request body" }),
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ ok: false as const, error }),
            onSuccess: (value) => ({ ok: true as const, value }),
          }),
        );
        if (!bodyRead.ok) {
          return clientSignal.aborted
            ? new Response(null, { status: 499 })
            : yield* Effect.fail(bodyRead.error);
        }
        const parsed: Record<string, unknown> = { ...bodyRead.value };
        const sessionId = extractSessionId(parsed, (name) => ctx.req.header(name));
        const sourceHeader =
          ctx.req.header("x-vllm-source") ??
          ctx.req.header("x-source") ??
          ctx.req.header("user-agent") ??
          null;

        let requestedModel = typeof parsed["model"] === "string" ? parsed["model"] : null;
        let matchedRecipe: Recipe | null = null;
        if (requestedModel) {
          matchedRecipe = yield* findRecipeByModel(requestedModel, context);
          const canonical = matchedRecipe?.served_model_name ?? matchedRecipe?.id;
          if (canonical && canonical !== requestedModel) {
            parsed["model"] = canonical;
            requestedModel = canonical;
          }
        }
        const { upstreamUrl, auth, requestProvider, providerRouting } = resolveUpstreamForModel(
          requestedModel,
          parsed,
          path,
          context,
          { includeXApiKey: true },
        );

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

        const isStreaming = Boolean(parsed["stream"]);
        if (dialect === "chat") ensureStreamingUsageIncluded(parsed);
        if (dialect === "responses") normalizeResponsesBody(parsed);

        const headers: Record<string, string> = { "Content-Type": "application/json", ...auth };
        for (const name of FORWARDED_HEADERS) {
          const value = ctx.req.header(name);
          if (value) headers[name] = value;
        }

        const requestStart = performance.now();
        const record = {
          model: matchedRecipe?.served_model_name ?? matchedRecipe?.id ?? requestedModel ?? "unknown",
          source: sourceHeader,
          session_id: sessionId,
          provider: providerRouting ? requestProvider : "local",
        };

        // Context guard: refuse to grow a local session past the soft ceiling.
        // The rejection is shaped as a context-overflow error so agent clients
        // compact and retry instead of pushing the engine to its hard limit.
        let contextLimits: ContextLimits | null = null;
        if (matchedRecipe && record.provider === "local") {
          contextLimits = yield* contextGuard.resolveLimits(matchedRecipe);
          if (contextLimits) {
            const rejection = contextGuard.check({
              dialect,
              sessionId,
              model: record.model,
              body: parsed,
              limits: contextLimits,
            });
            if (rejection) {
              context.logger.warn("Context guard rejected request", {
                model: record.model,
                session_id: sessionId,
                source: sourceHeader,
                soft_limit: contextLimits.softLimit,
                window: contextLimits.window,
              });
              return ctx.json(rejection.body, {
                status: rejection.status,
                headers: contextGuard.headers(contextLimits),
              });
            }
          }
        }
        const contextHeaders = contextLimits ? contextGuard.headers(contextLimits) : {};

        const fetched = yield* Effect.tryPromise({
          try: (signal) =>
            fetch(upstreamUrl, {
              method: "POST",
              headers,
              body: JSON.stringify(parsed),
              signal: AbortSignal.any([clientSignal, signal]),
            }),
          catch: () =>
            new HttpStatus({
              status: 503,
              detail: `The inference engine did not answer ${path}. It may still be starting, or this engine may not serve this API.`,
            }),
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ ok: false as const, error }),
            onSuccess: (value) => ({ ok: true as const, value }),
          }),
        );
        if (clientSignal.aborted) return new Response(null, { status: 499 });
        if (!fetched.ok) {
          // A chat client that asked for a stream reads SSE frames, not a JSON
          // error status; surface connection failures inside the protocol.
          if (dialect === "chat" && isStreaming) {
            return new Response(errorFrame("Inference backend unavailable").slice().buffer, {
              headers: buildSseHeaders(),
            });
          }
          return yield* Effect.fail(fetched.error);
        }
        const upstream = fetched.value;

        const contentType = upstream.headers.get("content-type") ?? "";
        if (contentType.includes("text/event-stream") && upstream.body) {
          return streamedResponse({
            dialect,
            upstream,
            body: upstream.body,
            clientSignal,
            record,
            requestStart,
            extraHeaders: contextHeaders,
          });
        }

        const body = yield* Effect.tryPromise({
          try: () => upstream.arrayBuffer(),
          catch: () => new HttpStatus({ status: 502, detail: "Upstream response unreadable" }),
        });
        yield* Effect.try({
          try: () => JSON.parse(new TextDecoder().decode(body)) as unknown,
          catch: () => null,
        }).pipe(
          Effect.flatMap((payload) => {
            const usage =
              payload && typeof payload === "object" && !Array.isArray(payload)
                ? usageFromPayload(dialect, payload as Record<string, unknown>)
                : null;
            if (usage) contextGuard.observe(record, usage);
            return recordNonStreamingInferenceUsage(
              { logger: context.logger, stores: context.stores },
              {
                usage: usage ?? undefined,
                record: {
                  ...record,
                  duration_ms: Math.round(performance.now() - requestStart),
                  status: upstream.status,
                },
              },
            );
          }),
          Effect.catch(() => Effect.succeed(null)),
        );
        return new Response(body, {
          status: upstream.status,
          headers: { "Content-Type": contentType || "application/json", ...contextHeaders },
        });
      });

  const [chat, responses, messages] = DIALECTS;
  return mergeRoutes(
    effectRoute(app.post, chat!.path, forward(chat!)),
    effectRoute(app.post, responses!.path, forward(responses!)),
    effectRoute(app.post, messages!.path, forward(messages!)),
  );
});
