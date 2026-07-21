# Controller code walkthrough: `src/modules/proxy/` — the OpenAI-compatible proxy slice

Paths below are relative to `/Users/sero/projects/vllm-studio/controller` unless absolute.

## 1. Purpose

This slice is the controller's public OpenAI-compatible face. It accepts `POST /v1/chat/completions` (streaming and non-streaming) plus two tokenization helper endpoints, normalizes the request, routes it either to the locally running inference runtime (vLLM/SGLang/llama.cpp/MLX) or to a configured remote provider, and then *repairs* the response on the way back: extracting tool calls that models emitted as XML/JSON text, separating `<think>` reasoning from visible content, deduplicating replayed deltas, and recording token usage into the metrics stores. In short: it makes a heterogeneous set of local/remote backends look like one clean, well-behaved OpenAI server.

## 2. File-by-file walkthrough

### `routes.ts` (7 lines) — the combiner
- Exports `registerAllProxyRoutes` (`routes.ts:5`), which merges `registerOpenAIRoutes` and `registerTokenizationRoutes` via `defineRoutes`/`mergeRoutes` from `src/http/route-registrar.ts`.
- `mergeRoutes` is a typing trick (`route-registrar.ts:22`): at runtime it just returns `routes[0]` — all registrars mutate the *same* Hono `app` instance — while its `UnionToIntersection` type-level machinery lets the caller keep a precise route-type union for OpenAPI doc generation. Worth knowing so you don't think routes get cloned.

### `openai-routes.ts` (331 lines) — the one big endpoint
The heart of the slice. Everything else exists to serve it.

**Exports:**
- `ModelNotRunningError` interface + `modelNotRunningError(...)` (`openai-routes.ts:31-47`) — builds the 503 JSON body returned when the requested model isn't the one currently loaded.
- `registerOpenAIRoutes` (`openai-routes.ts:49`) — registers `POST /v1/chat/completions` (`openai-routes.ts:193`).

**Key internal functions (all closures inside `registerOpenAIRoutes`):**
- `parseChatBody` (`openai-routes.ts:62-103`): reads the raw `ArrayBuffer`, JSON-parses it, validates with `Schema.Record(Schema.String, Schema.Unknown)` (deliberately permissive — this is a pass-through proxy, not a strict API). Then, in order: extracts the session id, canonicalizes the tool request, collapses multi-part text content, looks up the recipe by model name (`findRecipeByModel`), rewrites `model` to the recipe's canonical `served_model_name`, and forces `stream_options.include_usage = true` for streaming so usage accounting always has data. Returns a `bodyChanged` flag so the caller can skip re-serialization when nothing was modified (`openai-routes.ts:241-244`).
- `resolveChatUpstream` (`openai-routes.ts:105-144`): implements the `provider/model` prefix convention. `parseProviderModel("openrouter/anthropic/claude")` → `{provider: "openrouter", modelId: "anthropic/claude"}`; if the provider isn't the default (`"openai"`, meaning *local*), it looks up `baseUrl`/`apiKey` in `context.config.providers` and strips the prefix from the outgoing `model`. Otherwise the URL is `buildInferenceUrl(context, "/v1/chat/completions")` — i.e. `http://<inference_host>:<inference_port>`. Local calls optionally carry `Authorization: Bearer $INFERENCE_API_KEY` (`openai-routes.ts:134-142`).
- `gateOnRunningModel` (`openai-routes.ts:146-165`): asks `processManager.findInferenceProcess(inference_port)` what's actually running and compares it with the matched recipe via `isRecipeRunning(..., { allowEitherPathContains: true })`. On mismatch it emits a rate-limited warning and returns the 503 error body.
- `normalizeCompletionChoices` (`openai-routes.ts:167-190`): the non-streaming response post-processor. For each choice's message: parse tool calls out of text content (and fix `finish_reason` to `"tool_calls"` when found), split `<think>` reasoning out of content, and apply the Trinity-specific empty-content workaround.

**The handler flow (`openai-routes.ts:196-328`):**
1. Read the body with `Effect.tryPromise`, mapped into an `{ok, value|error}` union via `Effect.match` — note the pattern of *not* failing the Effect for client-abort: if the client disconnected mid-upload it returns a bare `Response(null, {status: 499})` (nginx-style "client closed request") instead of an error (`openai-routes.ts:198-211`).
2. Parse/normalize body; compute `sourceHeader` for attribution from `x-vllm-source` → `x-source` → `user-agent` (`openai-routes.ts:217-221`).
3. If `strict_openai_models` is on and no local recipe matched a non-prefixed model name → 404 `Model not managed` (`openai-routes.ts:223-230`).
4. If a recipe matched, gate on it actually running → 503 (`openai-routes.ts:232-239`).
5. **Non-streaming** (`openai-routes.ts:252-310`): `fetch` upstream with `AbortSignal.any([clientSignal, signal])` (ties upstream cancellation to both the HTTP client's disconnect and Effect interruption), decode JSON, record usage via `recordNonStreamingInferenceUsage`, attach `session_usage`, normalize choices, return `Response.json(result, {status: response.status})`. If the upstream body isn't valid JSON it forwards a null-body response with the upstream status (`openai-routes.ts:284-287`) rather than synthesizing an error object.
6. **Streaming** (`openai-routes.ts:312-326`): delegates wholesale to `buildChatCompletionsStreamResponse`.

Notable detail: `ChatRequestSchema` (`openai-routes.ts:60`) is reused to decode the *response* too (`openai-routes.ts:278`) — "any JSON object" is the whole contract in both directions.

### `chat-request.ts` (136 lines) — request-side helpers
Pure-ish helpers extracted from the route for testability.

- `PROXY_SESSION_HEADER_NAMES` (`chat-request.ts:5-10`) — four accepted session-id headers; `extractSessionId` (`chat-request.ts:59-77`) falls back header → body `session_id`/`sessionId`/`chat_id` → `metadata.session_id`.
- `createNonRunningModelWarner` (`chat-request.ts:28-57`) — a tiny rate limiter: per composite key (recipe + model + active model + source, joined with `\u0000`), it logs at most one warning per 10 minutes (`NON_RUNNING_MODEL_WARN_INTERVAL_MS`, `chat-request.ts:14`) and reports how many requests it suppressed in the interval (`suppressed_requests` field). Closed-over `Map` state; created once per route registration.
- `attachSessionUsage` (`chat-request.ts:79-103`) — mutates the response JSON to add `session_id` and a `session_usage` block. Note it's named "session" but actually just echoes the *current request's* usage under both `prompt_tokens` and `current_prompt_tokens` keys — there's no cross-request aggregation here.
- `findRecipeByModel` (`chat-request.ts:105-120`) — case-insensitive match of the requested model string against each recipe's `served_model_name`, `id`, or `name`, via `stores.recipeStore.list()`.
- `ensureStreamingUsageIncluded` (`chat-request.ts:122-136`) — mutates the payload to set `stream_options.include_usage: true` (preserving any existing stream options). This is what guarantees the usage chunk that `tool-call-stream.ts` and the accounting layer depend on.

### `chat-completions-stream.ts` (201 lines) — the streaming response builder
Wraps the upstream SSE body in an Effect `Stream` pipeline.

- `ChatCompletionsStreamError` (`chat-completions-stream.ts:14-21`) — `Schema.TaggedErrorClass` with a `stage` literal (`connect` | `response` | `stream`) so failures are typed by where they happened.
- `responseBodyStream` (`chat-completions-stream.ts:50-141`): pulls the upstream `ReadableStream` through `createToolCallStream` (the transform), capturing two side-channels via closures: `observedUsage` and `ttftMs` (time-to-first-token, latched on first token, `chat-completions-stream.ts:88-90`). Decides whether to buffer implicit reasoning by combining the recipe's explicit `reasoning_parser` with `getDefaultReasoningParser(matchedRecipe)` fallback (`chat-completions-stream.ts:77-82`). The stream is wrapped with:
  - `Stream.catchCause` → log-and-swallow into `Stream.empty` (never propagate stream errors to the client mid-SSE; the connection just ends) (`chat-completions-stream.ts:107-112`).
  - `Stream.ensuring(...)` → finalizer that records streaming usage exactly once, *even if the client disconnects mid-stream* — the accounting effect itself is caught down to a warning so the finalizer can never fail (`chat-completions-stream.ts:113-139`). This is the key reliability mechanism of the whole slice.
- `upstreamStream` (`chat-completions-stream.ts:143-187`): `Stream.unwrap` around a `fetch` effect. Every failure mode is converted into an *SSE error frame* (`data: {"error": ...}`) instead of an HTTP error, because by this point the client already got a 200 with `text/event-stream` headers. Non-OK upstream statuses forward the upstream body as the frame payload (`responseErrorFrame`, `chat-completions-stream.ts:45-48`).
- `buildChatCompletionsStreamResponse` (`chat-completions-stream.ts:189-201`): merges the data stream with a heartbeat (`: keepalive` comment every 15 s, `KEEPALIVE_INTERVAL_MS` at `chat-completions-stream.ts:12`) using `Stream.merge(..., {haltStrategy: "left"})` — the stream ends when the *upstream* side ends, heartbeats alone never keep it alive. Converted to a web `ReadableStream` via `Stream.toReadableStream` and returned with `buildSseHeaders()`.

### `tool-call-parser.ts` (257 lines) — salvage parser for model-generated tool calls
Local models frequently emit tool invocations as text instead of structured `tool_calls`. This file recognizes four dialects and converts them to OpenAI `ToolCall` objects.

- `ToolCall` type + `createToolCallId` (`tool-call-parser.ts:4-11`) — ids look like `call_` + 9 hex chars.
- `parseJsonCandidate` (`tool-call-parser.ts:13-21`) — delegates to `parseJsonWithRepair` from `@earendil-works/pi-ai`, which tolerates truncated/unbalanced JSON (essential for model output).
- `parseToolCallsFromContent` (`tool-call-parser.ts:203-257`) — a cascade of four strategies, each only tried if the previous found nothing:
  1. `<tool_call>…</tool_call>` blocks with `<function=name>` + `<arguments>` or `<parameter name=…>` sub-tags (`tool-call-parser.ts:207-233`).
  2. Anthropic-style `<invoke name="…"><parameter name=…>…</parameter></invoke>` (`parseInvokeToolCalls`, `tool-call-parser.ts:68-78`).
  3. Bare JSON objects containing `name`/`tool` + `args`/`arguments`/`parameters` (`parseJsonToolCalls`, `tool-call-parser.ts:150-169`), which relies on `extractBalancedValue` (`tool-call-parser.ts:80-148`) — a hand-rolled balanced-brace/bracket/string scanner with escape handling.
  4. A last-ditch regex for `"name": "x", "arguments": …` fragments (`tool-call-parser.ts:243-254`).
- `stripToolCallsFromContent` (`tool-call-parser.ts:171-194`) — the inverse: removes all of the above (plus `<use_mcp_tool>`) from visible text. Two details worth reading: line 183 strips a *dangling unclosed* `<tool_call>…` to end-of-string (half-written calls from truncated streams must not leak into the answer), and lines 189-192 strip orphan structural tags like a lone `</arg_value>`. Note the JSON-line stripping at 177-179 runs `parseJsonToolCalls` on *every* line containing braces — correct but O(content²)-ish on pathological inputs.

### `tool-call-stream.ts` (357 lines) — the SSE transform (the subtlest file)
`createToolCallStream` (`tool-call-stream.ts:26`) returns `source.pipeThrough(transform)` — a web `TransformStream` that rewrites each upstream SSE event. It is Effect-free (plain web streams) and is consumed by `chat-completions-stream.ts`.

State held across chunks (all closed over): text `buffer`, `pendingEventLines`, `visibleContentBuffer` (all visible content ever emitted — used for tool-call detection at end of stream), and four small maps for the delta normalizer.

- **SSE framing** (`tool-call-stream.ts:325-355`): decodes bytes → lines, splits events on blank lines, keeps a trailing partial line in `buffer`. `flushEvent` (`tool-call-stream.ts:201-323`) handles one event: non-`data:` lines pass through verbatim; multi-line `data:` payloads are joined before JSON.parse; `[DONE]` triggers end-of-stream fixups (`tool-call-stream.ts:226-234`).
- **`normalizeTextDelta` (`tool-call-stream.ts:47-92`)** — the most clever/fragile part. Some backends send *cumulative* snapshots (`"hel"`, `"hello"`) instead of deltas (`"hel"`, `"lo"`), and some *replay* from the beginning after a snapshot. It detects: cumulative → slice off the already-seen prefix; a shorter text that is a prefix of history → assume a replay and suppress output until the replay cursor passes the old length (`replayCursors`); anything else → append. Read this function twice; it's what keeps doubled text out of the UI.
- **Think-tag rewriting**: two independent `createThinkRewriter` instances (`tool-call-stream.ts:94-97`) — one for `content` (with implicit-reasoning buffering) and one for native reasoning fields (defaulting everything to reasoning). Rewritten reasoning is merged into a single `reasoning_content` field and the alternative field names are deleted (`tool-call-stream.ts:309-315`).
- **Usage + TTFT callbacks**: `parseUsage` (`tool-call-stream.ts:163-184`) fires once on the first chunk carrying token counts (guaranteed to exist because the route forced `include_usage`), mapping `prompt_tokens_details.cached_tokens` → `cache_read_tokens`. `trackFirstToken` latches TTFT.
- **Deferred tool-call injection**: tool calls embedded in *content text* can't be detected until the stream ends, so at `[DONE]`/flush, `maybeInjectToolCalls` (`tool-call-stream.ts:192-199`) parses the accumulated `visibleContentBuffer` and synthesizes a final chunk with `delta.tool_calls` + `finish_reason: "tool_calls"` (`buildToolCallChunk`, `tool-call-stream.ts:113-125`). If upstream sent real structured `tool_calls` at any point, `toolCallsFound` short-circuits this.
- `flushThinkCarry` (`tool-call-stream.ts:151-161`) — drains the rewriter's held-back partial-tag carry at end of stream, deciding whether the tail is reasoning or content by whether we're inside a think block or the tail looks like a partial tag.

### `reasoning.ts` (319 lines) — `<think>` separation and reasoning field normalization
- `REASONING_FIELDS` + `firstReasoningField` (`reasoning.ts:8-17`): upstreams disagree on the key (`reasoning_content` vs `reasoning` vs `reasoning_text`); always take the first non-empty one so text is never double-counted. Everything in this module converges on writing `reasoning_content` and deleting the other two.
- `createThinkRewriter` (`reasoning.ts:73-172`): a small state machine that splits a *streaming* text into `{content, reasoningAppend}` around `<think>`/`<thinking>`/`<analysis>` tags (with attributes allowed, `reasoning.ts:33-45`). The hard problem it solves: a tag can be split across deltas (`<thi` + `nk>`), so it holds a `thinkCarry` of any trailing partial-tag-looking suffix (`thinkingTagPrefixIsPartial`, `reasoning.ts:47-71`) and re-processes it with the next delta. The `bufferImplicitReasoningContent` option handles DeepSeek-R1-style models that emit a `</think>` close tag *without* an open tag: content before the close is retroactively reclassified as reasoning (`reasoning.ts:124-138`).
- `normalizeReasoningAndContentInMessage` (`reasoning.ts:207-249`) — the non-streaming version. Extracts think blocks from both content and the reasoning field, then **deduplicates identical segments** (`reasoning.ts:222-229`) because some models emit the same reasoning both inline and in the dedicated field. Careful guard at 211: multi-part array content (images) is never touched. Also strips tool-call XML and collapses pathological doubled output (`collapseRepeatedVisibleContent`, `reasoning.ts:181-193` — detects "the whole answer repeated twice").
- `normalizeToolCallsInMessage` (`reasoning.ts:251-264`) — if a message has no structured `tool_calls`, try parsing them out of content; returns whether it injected any (used to fix `finish_reason`).
- Model-specific quirks: `exposeReasoningAsContentWhenEmpty` (`reasoning.ts:280-303`) — Trinity-Large-Thinking sometimes returns empty content with full reasoning; copy reasoning into content so naive clients don't render a blank bubble. `shouldBufferImplicitReasoningContent` (`reasoning.ts:305-319`) — heuristic (parser name or model id containing deepseek/r1/reasoning/thinking) that decides whether the stream rewriter should buffer for the no-open-tag case.

### `content-normalizer.ts` (152 lines) — request canonicalization
Runs on the *incoming* request before forwarding.
- `normalizeToolRequest` (`content-normalizer.ts:1-53`): legacy `functions` → modern `tools`; reorders each function object's keys into canonical order (`name`, `description`, `parameters`, then the rest sorted) and **sorts the tools array by function name**. Purpose: prompt-cache friendliness — semantically identical requests from different clients serialize byte-identically, maximizing KV/prompt cache hits upstream. Also deletes `tool_choice: "auto"` since it's the default.
- `normalizeChatMessageContentParts` (`content-normalizer.ts:129-152`): collapses `content: [{type:"text",text:…}, …]` arrays into a single plain string when *all* parts are text (`collapseTextContentParts`, `content-normalizer.ts:98-127`). Any non-text part (image_url etc.) leaves the message untouched. Returns whether anything changed.

### `inference-accounting.ts` (155 lines) — usage persistence
- `readUsageTotals` (`inference-accounting.ts:69-79`) — normalizes the many shapes of an OpenAI `usage` object (top-level `reasoning_tokens` vs nested `completion_tokens_details.reasoning_tokens`; `cached_tokens` vs `cache_read_tokens`).
- `addLifetimeUsage` (`inference-accounting.ts:81-102`) — increments the lifetime counters; note prompt and completion are each added to `addTokens` separately (so `addTokens` receives the total in two calls), and `addRequests(1)` only fires when there are billable tokens. Runs with `{concurrency: 1, discard: true}` — sequential, fire-and-forget results.
- `tryRecordInference` (`inference-accounting.ts:104-116`) — writes a per-request row; failures degrade to a logger warning, never a failed request.
- `recordNonStreamingInferenceUsage` / `recordStreamingInferenceUsage` (`inference-accounting.ts:118-155`) — near-identical; the only differences are `streamed: false/true` and that the non-streaming one tolerates a missing `usage` object (returns `null`). Both skip the per-request row entirely when prompt and completion tokens are both 0 (`hasBillableTokens`, `inference-accounting.ts:66`).

### `tokenization-routes.ts` (116 lines) — the small sibling endpoints
- `POST /v1/count-tokens` (`tokenization-routes.ts:67-84`): gates on an inference process actually running (`findObservedInferenceProcess`, an observability-wrapped `processManager.findInferenceProcess`), then POSTs `{model, prompt}` to the runtime's `/tokenize` endpoint and counts the returned token array. Errors degrade to `{error, num_tokens: 0}` with HTTP 200 — this endpoint never fails hard.
- `POST /v1/tokenize-chat-completions` (`tokenization-routes.ts:86-115`): flattens message text (`messageText`, `tokenization-routes.ts:52-63` — strings plus text parts only, joined with `\n`), tokenizes messages and `JSON.stringify(tools)` separately, and adds a fixed **4 tokens per message** overhead (`tokenization-routes.ts:106`) as the chat-template fudge factor. Returns a `{input_tokens, breakdown, model}` estimate. Both tokenize calls use `Effect.orElseSucceed(() => 0)` so a broken `/tokenize` upstream yields a partial estimate, not an error.
- Schemas here are real `Schema.Struct`s (`tokenization-routes.ts:9-27`), unlike the chat route — because these payloads are small and controller-defined.

**Tests:** there are no `*.test.ts` files for this slice — proxy behavior is currently untested in-repo.

## 3. How data/control flows

**Non-streaming chat completion:**
```
Hono POST /v1/chat/completions (openai-routes.ts:193)
 → effectHandler runs Effect.gen (effect-handler.ts:31)
 → read raw body (openai-routes.ts:198)
 → parseChatBody (openai-routes.ts:62)
     → normalizeToolRequest / normalizeChatMessageContentParts (content-normalizer.ts)
     → extractSessionId (chat-request.ts:59)
     → findRecipeByModel via recipeStore (chat-request.ts:105)
     → ensureStreamingUsageIncluded (chat-request.ts:122)
 → resolveChatUpstream: provider prefix? remote URL+key : local inference URL (openai-routes.ts:105)
 → strict-mode 404 check (openai-routes.ts:223) / running-model gate → 503 (openai-routes.ts:146)
 → fetch upstream with merged abort signal (openai-routes.ts:253)
 → recordNonStreamingInferenceUsage → lifetimeMetricsStore + inferenceRequestStore (inference-accounting.ts:118)
 → attachSessionUsage (chat-request.ts:79) + normalizeCompletionChoices
     → normalizeToolCallsInMessage / normalizeReasoningAndContentInMessage (reasoning.ts)
     → parseToolCallsFromContent (tool-call-parser.ts:203)
 → Response.json(result, upstream status) (openai-routes.ts:309)
```

**Streaming chat completion:**
```
… same parse/gate steps …
 → buildChatCompletionsStreamResponse (chat-completions-stream.ts:189)
     → upstreamStream: fetch; failures become SSE error frames (chat-completions-stream.ts:143)
     → responseBodyStream: upstream bytes → createToolCallStream transform
         (tool-call-stream.ts:26: frame split, delta normalize, think rewrite,
          tool-call strip/inject, usage + TTFT callbacks)
     → Stream.merge with 15s heartbeat, halt on upstream end (chat-completions-stream.ts:199)
     → Stream.ensuring → recordStreamingInferenceUsage exactly once,
         even on client disconnect (chat-completions-stream.ts:113)
 → Response(Stream.toReadableStream(...), buildSseHeaders()) (chat-completions-stream.ts:200)
```

**Tokenization:** Hono → `findObservedInferenceProcess` gate → `fetchInference("/tokenize")` (local-fetch.ts:62) → count tokens → JSON estimate; all failures collapse to zeros in a 200 response.

## 4. Key patterns & idioms

- **Effect 101 for this slice**: `Effect.gen(function* () { … yield* … })` is async/await for typed, interruptible effects. `Effect.tryPromise({try, catch})` lifts a Promise into an Effect with a typed error. `Effect.match({onFailure, onSuccess})` folds both channels into a plain value — this codebase uses it to build `{ok, value|error}` unions instead of `yield* Effect.fail` when the "error" is really a control-flow branch (client aborts, upstream failures). `Effect.try` receives a `signal` (Effect's interruption signal) and the code consistently merges it with the HTTP client's abort signal via `AbortSignal.any([clientSignal, signal])` — the idiom for "cancel upstream work if either the client or the runtime gives up".
- **Errors as values, but barely**: the route signatures use `Effect.Effect<…, HttpStatus | unknown>` — `HttpStatus` (from `core/errors.ts`) is the typed failure that the global error mapper turns into an HTTP status; everything else falls through as `unknown` and becomes a 500. Tagged errors (`Schema.TaggedErrorClass`) like `ChatCompletionsStreamError` carry structured stage info but are mostly caught locally and converted to SSE frames.
- **Streams**: `Stream.unwrap` turns an `Effect<Stream>` into a stream (lazy connect); `Stream.merge(a, heartbeat, {haltStrategy: "left"})` for keepalives; `Stream.ensuring` is try/finally for streams — the accounting finalizer is the canonical use. Note the actual byte-level transform is *not* an Effect stream — `tool-call-stream.ts` uses a raw web `TransformStream`, and Effect only wraps it at the boundary (`Stream.fromReadableStream` / `Stream.toReadableStream`). Don't look for Effect inside the transform.
- **Hono registration**: `defineRoutes((app, context) => …)` + `mergeRoutes` is the house style; `documentRoute` attaches a generic OpenAPI 200 description; `effectHandler` bridges Hono's sync handler signature to the controller's Effect runtime (`effect-handler.ts:31`). Handlers return `Response`/`ctx.json(...)` as *values* from the Effect.
- **Mutation is fine at the edges**: deep inside Effect code everything is immutable-ish, but the normalizers (`normalizeToolRequest`, message fixups) freely mutate parsed JSON records — the codebase treats freshly parsed request/response JSON as scratch space. `bodyChanged` flags track whether re-serialization is needed.
- **Defensive degradation**: accounting failures → warnings; tokenize failures → 0; stream errors → log + end stream; upstream non-JSON → forward status with empty body. The proxy's job is availability, not strictness. The one hard failure is the running-model gate (503) and strict-mode 404.
- **Rate-limited logging**: `createNonRunningModelWarner` shows the pattern — closed-over `Map`, composite key with `\u0000` separators, report suppressed counts on next emit.

## 5. Connections

**Depends on (incoming imports):**
- `../../http/route-registrar`, `../../http/effect-handler`, `../../http/sse` (`buildSseHeaders`), `../../http/local-fetch` (`buildInferenceUrl`, `fetchInference`) — HTTP plumbing.
- `../../core/errors` (`HttpStatus`, `notFound`), `../../core/logger`, `../../core/validation` (`decodeJsonBody`), `../../core/function-observability` (`findObservedInferenceProcess`).
- `../../services/provider-routing` — provider prefix parsing and remote provider config.
- `../models/types` (`Recipe`), `../models/recipes/recipe-matching` (`isRecipeRunning`) — model catalog and "is this recipe the running process" matching.
- `../engines/process/model-runtime-defaults` (`getDefaultReasoningParser`) — per-model default reasoning parser names.
- `../../stores/inference-request-store` (`InferenceRequestRecord`) and `../system/metrics-store` (`LifetimeMetricsStore`) — write side of usage accounting.
- `AppContext` (from `src/app-context.ts`) — supplies `config`, `logger`, `stores`, `processManager`.
- External: `@earendil-works/pi-ai` (`parseJsonWithRepair`) — the only non-stdlib dependency in the slice.

**Depended on by:** only `src/http/app.ts` (`app.ts:13`, mounts `registerAllProxyRoutes` at `app.ts:97`). The slice is a leaf — no other module imports its internals. The *frontend and any OpenAI-compatible client* are the real consumers of these endpoints.

## 6. How to read this code

Suggested order, building from contract to mechanism:

1. **`routes.ts`** (1 min) — see the two registrars being merged.
2. **`openai-routes.ts`** — read top to bottom, but on first pass only follow the handler body (`:196-328`) and the three closures it calls in order (`parseChatBody` → `resolveChatUpstream` → `gateOnRunningModel`). This gives you the whole request lifecycle. Note where `bodyChanged` and `rewroteModel` matter.
3. **`chat-request.ts` + `content-normalizer.ts`** — the small pure helpers the handler calls; quick reads that make step 2 fully concrete.
4. **`inference-accounting.ts`** — short; understand `readUsageTotals` and the "warn, don't fail" recording policy before you meet its call sites in streaming.
5. **`chat-completions-stream.ts`** — the streaming wrapper. Focus on the three stream combinators (`unwrap`, `catchCause`, `ensuring`) and the heartbeat merge; understand *why* errors become SSE frames (headers already sent).
6. **`tool-call-stream.ts`** — the hardest file. Read `flushEvent` first (the per-event pipeline), then `normalizeTextDelta` (cumulative/replay detection), then the end-of-stream fixups (`flushThinkCarry`, `maybeInjectToolCalls`).
7. **`reasoning.ts`** — read `createThinkRewriter`'s `rewrite` loop carefully (carry handling for split tags, implicit-reasoning retroactive reclassification), then the non-streaming `normalizeReasoningAndContentInMessage`.
8. **`tool-call-parser.ts`** — read last as reference; understand the four-dialect cascade and that `stripToolCallsFromContent` must stay in sync with it.
9. **`tokenization-routes.ts`** — quick skim; mostly a miniature of the same patterns (gate → fetch upstream → degrade to zeros).

What to look for first: the two places where this slice *guarantees* something the upstream doesn't — `ensureStreamingUsageIncluded` (usage always present) and the `Stream.ensuring` accounting finalizer (usage always recorded) — and the general philosophy that model output is adversarial text that must be repaired (think tags, XML tool calls, cumulative deltas) before clients see it.
