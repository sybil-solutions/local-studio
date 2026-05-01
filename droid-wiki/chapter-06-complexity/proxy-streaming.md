# 4 — Proxy tool-call streaming

> **Severity:** High
> **Cross-link:** [Chapter 2 — proxy module](../chapter-02-controller/proxy-module.md)

## Verified file sizes

```
423 controller/src/modules/proxy/tool-call-stream.ts
385 controller/src/modules/proxy/openai-routes.ts
265 controller/src/modules/proxy/tokenization-routes.ts
181 controller/src/modules/proxy/tool-call-parser.ts
159 controller/src/modules/proxy/reasoning-extractor.ts
 70 controller/src/modules/proxy/content-normalizer.ts
```

The Phase-5 split (Chapter 2) is a positive case study — the original
`tool-call-core.ts` (863 LoC) was broken into four focused files. But the
**streaming half of the work is still concentrated in one place**:
`tool-call-stream.ts` at 423 LoC.

## Why it's complex

### `tool-call-stream.ts` (423 LoC) — stateful SSE rewriter

This file consumes the upstream SSE chunks from vLLM/SGLang/llama.cpp and
emits OpenAI-shape `tool_calls` deltas as the call shape becomes
unambiguous. State that lives across chunks:

- A small **lookahead buffer** for partial tool-call openings
  (`<tool_call>` / `<function`).
- A token-by-token **reasoning extractor** that strips `<think>` content
  out of `delta.content` and routes it to `delta.reasoning_content`
  (separately from the message-level normaliser in `reasoning-extractor.ts`).
- An **assembly map** for incremental tool calls — `function.arguments`
  arrives as a stream of partial JSON fragments, and the rewriter must
  emit valid OpenAI-shape deltas (each with `index` / `id` / partial
  `arguments` string) without ever producing invalid JSON.

This kind of code is correct only when the test corpus covers every
upstream variant. There are tests, but the failure mode is silent: a new
quantized vLLM build that emits `<tool_call>` with a leading whitespace
delta would land as raw `content` text instead of a tool call, and the
agent would never invoke the tool.

### `openai-routes.ts` (385 LoC) — too many responsibilities for one handler

One `POST /v1/chat/completions` handler does:

1. Body parsing + session-id extraction (six possible locations:
   `x-vllm-session-id` header, `x-session-id` header, `x-chat-session-id`
   header, `openai-conversation-id` header, `body.session_id`,
   `body.metadata.session_id`).
2. `ensureStreamingUsageIncluded(payload)` — forced injection of
   `stream_options.include_usage = true`.
3. Provider routing via `parseProviderModel(model)` and
   `resolveProviderConfig(...)`. The default provider is now
   `DEFAULT_CHAT_PROVIDER = "openai"` (it was `"local"` on `main` —
   see [dead-shape-leftovers.md](./dead-shape-leftovers.md)).
4. `ensureActive(recipe)` for the `local` provider — the proxy waits for
   the engine to switch models if the requested recipe isn't running.
5. The actual `fetch` to the upstream server.
6. The SSE pump with abort handling tied to `ctx.req.raw.signal`.
7. Tool-call stream rewriting via `createToolCallStream()`.
8. Usage extraction and `attachSessionUsage` to `LifetimeMetricsStore`.

A single bug in any of those steps surfaces as a generic 502 or a stuck
SSE stream, with no obvious diagnostic.

### `reasoning-extractor.ts` (159 LoC) — multiple regex normalisations

Two exports operate on already-decoded message objects (the
*non-streaming* counterpart to the stream rewriter):

- `normalizeReasoningAndContentInMessage(message)` — finds
  `<think>...</think>` inside `content` via regex, moves it to
  `reasoning_content`, leaves the trimmed remainder in `content`.
- `normalizeToolCallsInMessage(message)` — re-numbers `index`, ensures
  `id` is set, ensures `type === "function"`, ensures `arguments` is
  stringified.

There are now **three places** that detect/strip `<think>` content:

1. `tool-call-stream.ts` — streaming-path stripper.
2. `reasoning-extractor.ts:normalizeReasoningAndContentInMessage` —
   message-object stripper.
3. `chat-pane.tsx:applyPiEvent` — frontend renderer that decides when to
   collapse a `thinking` block into a `<details>` element.

If a model emits `<thinking>` instead of `<think>` (or `<reasoning>`),
all three places need updating. There is no shared regex constant.

## What could simplify it

- Hoist the streaming state into an explicit, small FSM module that
  models `(idle | buffering_open_tag | inside_tool_call |
  inside_thinking | passthrough)` — analogous to `download-machine.ts`
  in the engines module, which the same PR holds up as a clean example.
- Split `openai-routes.ts` along (request build) / (provider resolve) /
  (fetch + abort) / (stream rewrite + usage attach). Today everything is
  closure-shared inside one async handler.
- Centralise the `<think>`-pattern in one regex constant and import it
  from both the streaming and non-streaming paths.
- Make `extractSessionId` log which of the six locations it picked when
  none of them are present in the obvious place — silent fallback to
  `body.metadata.session_id` is a debugging trap.
