# Proxy module — `controller/src/modules/proxy/`

The proxy module is the **Phase-5** consolidation. It absorbs the
863-line monolith `tool-call-core.ts` and the `proxy-parsers.ts`
escape hatch into four focused files, plus moves UTF-8 helpers out to
`core/utf8.ts`.

## Layout

```
controller/src/modules/proxy/
├── index.ts                 #   9 LoC — re-exports
├── routes.ts                #  14 LoC — composition: openai + tokenization
├── openai-routes.ts         # 385 LoC — the streaming/non-streaming proxy
├── tokenization-routes.ts   # 265 LoC — /v1/tokenize and /v1/detokenize
├── tool-call-parser.ts      # 181 LoC — non-streaming string → ToolCall[]
├── tool-call-stream.ts      # 423 LoC — SSE-rewriting state machine
├── reasoning-extractor.ts   # 159 LoC — strips <think>, normalises tool_calls in messages
├── content-normalizer.ts    #  70 LoC — multimodal content-parts normalisation
└── types.ts                 #   ~  — shared types
```

## The 4-way split (Phase 5)

`origin/main` had a single `tool-call-core.ts` of **863 lines** that
mixed:

- Parsing tool calls out of model output (Hermes / Llama / generic XML
  formats).
- Rewriting Server-Sent Events on the fly to synthesise OpenAI-shape
  `tool_calls` deltas.
- Stripping `<think>` blocks from `content` and surfacing them as
  `reasoning_content`.
- Normalising multimodal `content` parts and `tool_choice`.

The branch breaks this into four files with clear responsibilities:

### `tool-call-parser.ts` (181 LoC)

Pure string-in / `ToolCall[]`-out. Used by the non-streaming path.
Handles:

- `<tool_call>...</tool_call>` Hermes blocks.
- `<parameter name="x">...</parameter>` parameter blocks.
- JSON blocks containing `{"name":"...","arguments":{...}}`.
- Generates IDs via `createToolCallId()` (random UUID, prefixed
  `call_`, 9 chars).
- `coerceArguments(value)` ensures the `arguments` field is always a
  JSON string (OpenAI spec compliance).

### `tool-call-stream.ts` (423 LoC)

The SSE-rewriting state machine — the largest file in the module.
Used by the streaming path. It consumes the upstream SSE chunks, holds
a small buffer, detects partial tool-call openings (`<tool_call>` /
`<function`), and emits OpenAI-shape deltas as the call shape becomes
unambiguous. Also normalises `<think>` content here.

`createToolCallStream()` is the factory; the returned object has the
shape used by `openai-routes.ts` to wrap the upstream `Response.body`.

### `reasoning-extractor.ts` (159 LoC)

Operates on **already-decoded message objects** (not the raw stream).
Two main exports:

- `normalizeReasoningAndContentInMessage(message)` — finds `<think>...
  </think>` inside `content`, moves it to `reasoning_content`, leaves
  the trimmed remainder in `content`.
- `normalizeToolCallsInMessage(message)` — re-numbers `index` values
  on `tool_calls`, ensures `id` is set, ensures `type === "function"`,
  and that `function.arguments` is a JSON string.

### `content-normalizer.ts` (70 LoC)

The smallest file. Two exports:

- `normalizeChatMessageContentParts(message)` — coerces multimodal
  `content` (an array of `{type:"text"|"image_url",...}`) into a flat
  string when the upstream model doesn't support parts, and back into
  parts when it does.
- `normalizeToolRequest(toolChoice)` — handles `tool_choice` variants
  (`"auto"`, `"none"`, `{type:"function",function:{name}}`).

## `openai-routes.ts` (385 LoC) — the proxy itself

Endpoints:

```
POST /v1/chat/completions   — streaming or non-streaming chat completions
POST /v1/completions        — text completions
POST /api/title             — short proprietary "give me a chat title" endpoint
```

Notable behaviours:

- **`extractSessionId(body, headers)`** reads (in order): the
  `x-vllm-session-id`, `x-session-id`, `x-chat-session-id`, or
  `openai-conversation-id` headers, then `body.session_id` /
  `body.sessionId` / `body.chat_id`, then `body.metadata.session_id`.
- **`ensureStreamingUsageIncluded(payload)`** forces
  `stream_options.include_usage = true` on streaming requests so
  per-request token totals always come back — this is what feeds
  `LifetimeMetricsStore`.
- **Provider routing**: `parseProviderModel(model)` from
  `services/provider-routing.ts` interprets `provider:model` strings
  (e.g. `openai:gpt-4o`, `anthropic:claude-3-5-sonnet`,
  `local:Llama-3.1-8B`) and `resolveProviderConfig(...)` returns the
  upstream URL + headers. The default provider when no prefix is
  present is `DEFAULT_CHAT_PROVIDER = "local"`.
- **`ensureActive` swap**: for the `local` provider, the proxy calls
  `context.engineService.ensureActive(recipe)` before forwarding the
  request. `switched: true` means the proxy waited for the model to
  load. Unmatched recipes return `404 Recipe not found`. No matching
  process available returns `503 Service Unavailable`.
- **Abort handling**: `ctx.req.raw.signal` is forwarded into the
  inference fetch and used to short-circuit the SSE pump. On client
  disconnect, the proxy returns 499 (handled by `http/app.ts`'s
  `onError`).
- **Usage attachment**: `attachSessionUsage(result, sessionId, usage)`
  decorates the response with `session_usage` (prompt/completion/
  reasoning tokens) and writes a `LifetimeMetrics` row.

## `tokenization-routes.ts` (265 LoC)

```
POST /v1/tokenize
POST /v1/detokenize
GET  /v1/tokenization/info
```

Forwards to the active inference server's tokenization endpoints when
they exist (vLLM has them; SGLang has them; llama.cpp does not). For
the no-tokenizer case, falls back to a server-side approximation.

## `routes.ts` (14 LoC) — composition

```ts
export const registerAllProxyRoutes = (app: Hono, context: AppContext): void => {
  registerOpenAIRoutes(app, context);
  registerTokenizationRoutes(app, context);
};
```

That's the whole file — the renames make this composition trivial.

## Tests

- `controller/src/tests/tool-call-core.test.ts` — survived the rename
  (file kept for git history) but +57/-21 lines now exercise the four
  new files.
- `tool-call-stream.test.ts` (in `proxy/`) — new SSE rewriter tests.

## What `proxy-parsers.ts` became

`controller/src/modules/proxy/proxy-parsers.ts` (gone) → moved to
`controller/src/core/utf8.ts`. The new file's exports are:

```ts
export const decodeUtf8Chunked: (input: Uint8Array, decoder: TextDecoder) => string;
export const splitSseFrames: (buffer: string) => { frames: string[]; remainder: string };
```

These are now general-purpose helpers used by the proxy and by any
other future SSE-consuming component, hence the `core/` placement.

## Chapter 7 candidates

- **`openai-routes.ts` (385 LoC)** is still long for one route handler.
  The body parsing, session-id extraction, provider routing,
  `ensureActive` swap, fetch, SSE rewrite, usage attach are all in one
  function. Splitting along "request build" / "fetch" / "response
  shape" would help.
- **`tool-call-stream.ts` (423 LoC)** is the largest remaining file
  in the module. The state machine for SSE rewriting could be modelled
  more explicitly (cf. `engines/layers/download-machine.ts` as a
  good example of a pure-FSM module elsewhere in this same branch).
- The four-file split is **a clear win** and should be cited as the
  positive case study in any "controller refactor lessons" section.
