import { Effect, Schema } from "effect";
import type { AppContext } from "../../app-context";
import { findObservedInferenceProcess } from "../../core/function-observability";
import { decodeJsonBody } from "../../core/validation";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { fetchInference } from "../../http/local-fetch";

const CountTokensRequestSchema = Schema.Struct({
  text: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
});

const TokenizeChatRequestSchema = Schema.Struct({
  messages: Schema.optional(Schema.Array(Schema.Unknown)),
  tools: Schema.optional(Schema.Array(Schema.Unknown)),
  model: Schema.optional(Schema.String),
});

const TokenizeResponseSchema = Schema.Struct({
  tokens: Schema.optional(Schema.Array(Schema.Unknown)),
});

const TextPartSchema = Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) });
const MessageSchema = Schema.Struct({
  content: Schema.optional(Schema.Union([Schema.String, Schema.Array(TextPartSchema)])),
});

const responseTokens = (response: Response): Effect.Effect<number, unknown> =>
  Effect.tryPromise({ try: () => response.json(), catch: (source) => source }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(TokenizeResponseSchema)),
    Effect.map((payload) => payload.tokens?.length ?? 0),
  );

const tokenize = (
  context: AppContext,
  model: string,
  prompt: string,
): Effect.Effect<number, unknown> =>
  fetchInference(context, "/tokenize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt }),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? responseTokens(response)
        : Effect.fail(new Error(`Tokenize failed: ${response.status}`)),
    ),
  );

const messageText = (messages: readonly unknown[]): string =>
  messages
    .flatMap((message) => {
      const decoded = Schema.decodeUnknownOption(MessageSchema)(message);
      if (decoded._tag === "None" || decoded.value.content === undefined) return [];
      return typeof decoded.value.content === "string"
        ? [decoded.value.content]
        : decoded.value.content.flatMap((part) =>
            part.type === "text" && part.text ? [part.text] : [],
          );
    })
    .join("\n");

export const registerTokenizationRoutes = defineRoutes((app, context) => {
  return mergeRoutes(
    app.post(
      "/v1/count-tokens",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const current = yield* findObservedInferenceProcess(context, "countTokens");
          if (!current) return ctx.json({ error: "No model running", num_tokens: 0 });
          const body = yield* decodeJsonBody(ctx, CountTokensRequestSchema);
          const model = body.model ?? current.served_model_name ?? "default";
          return yield* tokenize(context, model, body.text ?? "").pipe(
            Effect.map((numberTokens) => ctx.json({ num_tokens: numberTokens, model })),
            Effect.catch((error) =>
              Effect.succeed(ctx.json({ error: String(error), num_tokens: 0 })),
            ),
          );
        }),
      ),
    ),

    app.post(
      "/v1/tokenize-chat-completions",
      documentRoute,
      effectHandler((ctx) =>
        Effect.gen(function* () {
          const current = yield* findObservedInferenceProcess(context, "tokenizeChatCompletions");
          if (!current) return ctx.json({ error: "No model running", input_tokens: 0 });
          const body = yield* decodeJsonBody(ctx, TokenizeChatRequestSchema);
          const messages = body.messages ?? [];
          const tools = body.tools ?? [];
          const model = body.model ?? current.served_model_name ?? "default";
          const messagesTokens = yield* tokenize(context, model, messageText(messages)).pipe(
            Effect.orElseSucceed(() => 0),
          );
          const toolsTokens =
            tools.length > 0
              ? yield* tokenize(context, model, JSON.stringify(tools)).pipe(
                  Effect.orElseSucceed(() => 0),
                )
              : 0;
          const overhead = messages.length * 4;
          return ctx.json({
            input_tokens: messagesTokens + toolsTokens + overhead,
            breakdown: { messages: messagesTokens + overhead, tools: toolsTokens },
            model,
          });
        }),
      ),
    ),
  );
});
