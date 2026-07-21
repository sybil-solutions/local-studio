# Controller Code Review — Reading Guide

A deep, file-by-file walkthrough of `/Users/sero/projects/vllm-studio/controller` — the Bun + Hono + Effect backend for Local Studio. Generated 2026-07-21 from the code as it exists on disk.

## What the controller is

The HTTP brain of Local Studio. It:

- launches and evicts local inference runtimes (vLLM, SGLang, llama.cpp, MLX) described by **recipes**
- discovers/installs runtime targets (venvs, Docker images, system Pythons, binaries)
- proxies **OpenAI-compatible** requests (`/v1/chat/completions`, `/v1/models`, audio, tokenization) to whatever is actually running
- streams logs/events over SSE, collects GPU + engine metrics, tracks usage, manages HF model downloads and TTS/STT

## The documents (read in this order)

| # | File | Covers |
|---|------|--------|
| 1 | [boot-config.md](boot-config.md) | `src/main.ts`, `src/app-context.ts`, `src/config/` — startup, DI graph, env/persisted config |
| 2 | [core.md](core.md) | `src/core/` — Effect runtime, tagged errors, logger, redaction, command runner, validation |
| 3 | [http.md](http.md) | `src/http/` — Hono app, middleware chain, Effect↔Hono bridge, SSE, body limits |
| 4 | [stores.md](stores.md) | `src/stores/` — SQLite plumbing, rig/settings/request stores |
| 5 | [contracts.md](contracts.md) | `contracts/` — the wire types shared with the frontend |
| 6 | [engines-core.md](engines-core.md) | engine lifecycle routes, coordinator, spec strategy interface |
| 7 | [engines-runtimes.md](engines-runtimes.md) | runtime target discovery, venv/binary installs, upgrades, jobs |
| 8 | [engines-process-downloads.md](engines-process-downloads.md) | process spawn/kill, orphan reaping, HF download manager |
| 9 | [proxy.md](proxy.md) | OpenAI-compatible proxy, streaming, tool-call parsing, reasoning rewriting |
| 10 | [models.md](models.md) | recipes, recipe parsing/matching, model browser, `/v1/models` |
| 11 | [studio.md](studio.md) | settings, rigs (hardware nodes), providers, file ops |
| 12 | [system-core.md](system-core.md) | event bus, metrics collector/store, logs, GPU leases |
| 13 | [system-platform-usage.md](system-platform-usage.md) | GPU vendor detection (NVIDIA/AMD/Intel/Apple), usage accounting |
| 14 | [speech-audio-services.md](speech-audio-services.md) | Chatterbox TTS worker protocol, voice vault crypto, audio routes |

## The five patterns that unlock the whole codebase

1. **Everything is an Effect.** `Effect.gen` pipelines, typed error channels (`Schema.TaggedErrorClass`), resources via `Effect.acquireRelease`, concurrency via fibers/semaphores. One memoized `ManagedRuntime` (`src/core/effect-runtime.ts:13`) runs effects at boot and per-request.
2. **One Hono app, many registrars.** Each module exports a `register*Routes(app)` that mutates the same Hono instance; `mergeRoutes` is a type-level trick only (it returns `routes[0]` at runtime). Mounting happens in `src/http/app.ts`.
3. **`effectHandler` is the only bridge.** Handlers build an Effect; `runControllerEffect` (`src/http/effect-handler.ts:20`) runs it and rethrows typed errors into Hono's `onError`, which maps `HttpStatus` → HTTP codes.
4. **Fail-soft telemetry, fail-fast config.** Metrics/accounting/logging writes are wrapped in `Effect.ignore` — they can never break a request. Config and recipe parsing throw at the boundary instead.
5. **Sync core + `*Effect` twin.** Stores and command runners expose a synchronous method plus an Effect-wrapped variant; Effect is used for error typing and structured concurrency, not for async I/O (bun:sqlite is sync).

## Recurring caveats worth knowing

- Almost no tests exist outside `engines/runtimes` and `engines/downloads` — even for the riskiest code (process killing, GPU lease locking, tool-call stream parsing).
- Two error idioms coexist: typed `Effect.fail(HttpStatus)` and "error object inside HTTP 200".
- `GET` routes with write side effects exist (`/studio/rigs` re-detects hardware).
- Provider API keys are stored plaintext in `studio-settings.json` (protected only by file permissions).
