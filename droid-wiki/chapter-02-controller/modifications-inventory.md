# Modifications inventory

22 files in `controller/` were modified (not added, not deleted, not
renamed) on `feat/plop-t3code-with-pi`. This page summarises each one
in roughly biggest-impact-first order.

Renames are documented elsewhere — see
[`engines-module.md`](engines-module.md),
[`system-module.md`](system-module.md),
[`models-module.md`](models-module.md), and
[`shared-types-and-app-context.md`](shared-types-and-app-context.md).

## 19 added files (cross-link with renames)

For completeness, the **net-new** files on this branch are:

| File | LoC | Purpose |
|------|----:|---------|
| `engines/configs.ts`                          |  21 | Merged lifecycle + downloads configs. |
| `engines/index.ts`                            |   6 | Public exports. |
| `engines/types.ts`                            |   - | Re-exports from models. |
| `engines/services/engine-service.ts`          |  98 | The new public contract interface. |
| `engines/routes.ts`                           | 327 | Recipe CRUD + launch + downloads + runtimes. |
| `engines/routes.test.ts`                      | 167 | Route harness tests. |
| `engines/layers/engine-coordinator.ts`        | 578 | Orchestrator (replaces lifecycle-coordinator). |
| `engines/layers/engine-coordinator.test.ts`   | 171 | |
| `engines/layers/download-machine.ts`          | 277 | Pure FSM. |
| `engines/layers/runtime-upgrade.ts`           |  92 | Simplified upgrade entry points. |
| `proxy/content-normalizer.ts`                 |  70 | Multimodal parts + tool_choice. |
| `proxy/reasoning-extractor.ts`                | 159 | `<think>` extraction + tool_calls normalisation. |
| `proxy/tool-call-parser.ts`                   | 181 | Non-streaming string → ToolCall[]. |
| `proxy/tool-call-stream.ts`                   | 423 | SSE rewriter state machine. |
| `proxy/openai-routes.test.ts`                 |   - | |
| `system/usage-routes.ts`                      |  38 | Thin shim merging chat-database + pi-sessions. |
| `system/usage/pi-sessions.ts`                 | 290 | NEW — reads `~/.pi/agent/sessions/*.jsonl`. |
| `system/usage/pi-sessions.test.ts`            |  53 | |
| `system/usage/chat-database.test.ts`          |  73 | |

## Modified files

### Top-level wiring (4 files)

#### `controller/src/app-context.ts` — full rewrite

```
+82 / −56
```

The container was rebuilt around `engineService`. Key changes:

- New service: `engineService = createEngineCoordinator({ ... })`.
- `processManager` and `downloadManager` are still constructed and
  exposed (for legacy access) but the canonical surface is
  `engineService`.
- `abortRunsForModel: () => 0` — deliberate no-op (chat runtime gone).
- `lifetimeMetricsStore.ensureFirstStarted()` is called at boot.
- `JobManager` is constructed last so it can capture the rest of the
  context (with structural typing via `IJobManager`).
- All imports updated to the new module locations.

#### `controller/src/main.ts` — minimal change (+2 / −2)

```ts
import { startMetricsCollector } from "./modules/system/metrics-collector/metrics-collector";
```

The only change is the import path (was
`./modules/lifecycle/metrics/metrics-collector`). Behaviour identical.

#### `controller/src/types/context.ts` — full rewrite (+34 / −34)

Defines `AppContext` with the new shape. Key changes:

- `engineService: EngineCoordinator` replaces
  `lifecycleCoordinator`.
- Imports retargeted to new module paths (`modules/engines/layers/...`,
  `modules/system/...`, `modules/models/recipes/...`).
- `jobManager: IJobManager` (narrowed interface) replaces direct
  `JobManager` reference to avoid circular type dependency.

#### `controller/src/contracts/controller-events.ts` — shrunk to a re-export shim

```
+13 / −135
```

Now 16 LoC of pure re-exports from `modules/shared/controller-events`.

### HTTP layer (2 files)

#### `controller/src/http/app.ts` — net −95 LoC

```
+13 / −108
```

- `registerAllLifecycleRoutes` and `registerDownloadsRoutes` removed.
- `registerEngineRoutes` added (Phase-1 successor).
- `registerAllChatRoutes` removed (chat tree gone).
- `registerSystemRoutes` now sources from `modules/system/routes`.
- The 499/AbortError handler is hardened — swallows `AbortError`,
  `ERR_STREAM_PREMATURE_CLOSE`, `EPIPE`, `ECONNRESET`,
  `ECONNABORTED` as 499 instead of 500.

#### `controller/src/http/openapi-spec.ts` — net −18 LoC

```
+0 / −18
```

The OpenAPI spec lost the chat/agent-files routes plus a few obsolete
schemas. No new spec entries — the new download routes etc. were
already present under engines paths.

### Modules with import-path-only modifications (9 files)

These files only changed import paths to follow the new module layout:

| File | Diff |
|------|------|
| `controller/src/modules/audio/routes.ts` | +5 / −5 |
| `controller/src/modules/audio/routes.test.ts` | +4 / −4 |
| `controller/src/modules/studio/routes.ts` | +3 / −3 |
| `controller/src/modules/studio/routes.test.ts` | +1 / −1 |
| `controller/src/modules/models/index.ts` | +1 / −0 |
| `controller/src/modules/models/routes.ts` | +1 / −1 |
| `controller/src/modules/proxy/index.ts` | +5 / −1 (re-exports the four new files) |
| `controller/src/modules/proxy/types.ts` | +0 / −5 (removed unused `ProxyConfig` shape) |

### Modules with logic changes (4 files)

#### `controller/src/modules/proxy/openai-routes.ts` — +91 / −18

The proxy gained:

- `ensureStreamingUsageIncluded(payload)` helper that mutates the
  request to include `stream_options.include_usage = true` (this is
  what feeds `LifetimeMetricsStore`).
- A more thorough `extractSessionId` (8 lookup paths) so usage data
  can be attributed to the external pi-agent's sessions.
- `attachSessionUsage(result, sessionId, usage)` decorates non-streaming
  responses with `session_usage`.
- Provider routing via `parseProviderModel` / `resolveProviderConfig`
  (see below).

#### `controller/src/modules/models/types.ts` — +73 / −1

The big addition: re-exports of all the runtime/system/recipe types
from `modules/shared/system-types.ts` and `modules/shared/recipe-types.ts`,
plus new local types `ModelsModuleConfig`, `ModelBrowserRecord`. This
file is now the canonical place for model-domain types.

#### `controller/src/services/provider-routing.ts` — +37 / −0

New behaviour:

- `DEFAULT_CHAT_PROVIDER = "openai"` (was `"local"` before — note this
  changes the default routing!).
- `WELL_KNOWN_PROVIDERS = { openai, anthropic }` table.
- `parseProviderModel(rawModel)` — interprets `provider/model` syntax
  (`/`-separated, e.g. `openai/gpt-4o`).
- `resolveProviderConfig(provider, config)` — returns
  `{ baseUrl, apiKey }` from persisted provider settings.
- `getProviderCompatMetadata(provider)` — per-provider feature flags
  (`supportsDeveloperRole`, `supportsImageUrl`,
  `supportsMessageName`, `supportsUsageInStreaming`,
  `maxTokensField`).

**Risk to flag in PR review**: the change of
`DEFAULT_CHAT_PROVIDER` from `"local"` to `"openai"` is a **behaviour
change**, not just a refactor. Any model name without a provider
prefix will now route to OpenAI by default. Verify the frontend
always passes a provider prefix or the proxy's local fallback still
catches model names that match a recipe.

#### `controller/src/core/async.ts` — +26 / −0

`AsyncQueue<T>` gained:

- Explicit `evictedCount` tracking.
- `evictOldest(): TValue | null` — manual eviction.
- `evictions: number` getter.
- `size: number` and `isFull: boolean` getters.

These are surfaced by the system module to monitor SSE backpressure.

### Type files (1 file)

#### `controller/src/types/chat.ts` — +16 / −0

Despite the chat module being deleted, this file **survived** because
the proxy still uses these message shapes. It gained four small fields:

- `request_prompt_tokens`, `request_tools_tokens`,
  `request_total_input_tokens`, `request_completion_tokens`,
  `cache_read_tokens`, `cache_write_tokens`, `thinking_tokens`,
  `provider_model_id`, `cost_json` on `ChatMessage`.
- `cache_read_tokens`, `cache_write_tokens`, `thinking_tokens`,
  `estimated_cost`, `cost_details` on `ChatUsage`.

The file is now arguably **misnamed** — there is no `chat` module, but
this `chat.ts` lives at `controller/src/types/chat.ts` carrying types
that are now consumed only by the proxy, the audio module, and the
usage routes. **Chapter 7 candidate**: rename to `messages.ts` and
move beneath the proxy module.

### Test files (3 files)

#### `controller/src/tests/tool-call-core.test.ts` — +57 / −21

The legacy test file kept its location for git history but its
expectations were rewritten to match the four new files.

#### `controller/src/tests/build-environment-visible-devices.test.ts` — +4 / −4

Import path adjustment only.

#### `controller/src/tests/runtime-summary-events.test.ts` — +4 / −4

Import path adjustment only.

## What this means for review

- **Refactor surface**: 22 modified files are mostly import-path
  adjustments and surgical additions. The risky logic changes are
  concentrated in **3 files**: `app-context.ts`, `openai-routes.ts`,
  and `provider-routing.ts`.
- **Behaviour change to flag**: `DEFAULT_CHAT_PROVIDER` changing from
  `"local"` to `"openai"` in `provider-routing.ts`.
- **Test deletion to flag**: `http/security-middleware.test.ts` is
  gone (not in this list because it's a deletion). The middleware
  itself remains untested on this branch.
- **Type-system smell to flag**: `controller/src/types/chat.ts`
  surviving with no chat module to back it.
