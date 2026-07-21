# Code Review: `contracts/` — the API contract shared with the frontend

Scope: `/Users/sero/projects/vllm-studio/controller/contracts/` — 9 TypeScript modules + `package.json`, ~1,370 lines total. No tests exist inside `contracts/` itself (behavior of its pure functions, e.g. vision inference, is exercised indirectly through consumers).

## 1. Purpose

`contracts/` is a tiny publishable-style package, `@local-studio/contracts`, that defines **every shape that crosses the wire between the controller and the frontend**: REST response bodies (`UsageStats`, `SpeechStatus`, `ConfigData`), the recipe/serve domain model (`RecipeBase`, `ModelDownload`), SSE event names (`controller-events.ts`), and a handful of **shared pure functions** (engine-argument filtering, vision-capability inference) that must behave identically on both sides. The frontend installs it via a `file:` dependency (`frontend/package.json:50`), while the controller itself resolves `@local-studio/contracts/*` through a tsconfig path mapping (`controller/tsconfig.json:21`) that Bun also honors at runtime. In short: this directory is the single source of truth for "what the API looks like"; changing a field here changes both sides at once.

## 2. File-by-file walkthrough

### `package.json` (12 lines)

- `name: "@local-studio/contracts"`, version `2.1.0` (matches the controller's own version — they are bumped together), `private: true` so it is never published to npm.
- `"exports": { "./*": "./*.ts" }` (`contracts/package.json:6-8`): **subpath imports resolve straight to TypeScript source** — there is no build step, no `dist/`, no declaration emit. Both Bun and the frontend's bundler (Vite) compile the `.ts` on the fly. This is the key trick of the package.
- The only runtime dependency is `effect@4.0.0-beta.90`, needed solely because `rigs.ts` defines Effect `Schema` validators.

### `recipes.ts` (114 lines) — the serve/download domain model

The foundational file: it defines `Backend`, which `engine-args.ts` and `system.ts` both build on.

- `Backend` (`recipes.ts:1`): `"vllm" | "sglang" | "llamacpp" | "mlx"` — the four inference engines. Note `system.ts:37` re-declares the same union as `EngineBackend`; the two must be kept in sync by hand (see "noteworthy" below).
- `ServeRuntime` / `ServeRuntimeKind` (`recipes.ts:3-9`): how a recipe gets launched — `managed_venv`, `system`, `docker`, or `binary`, plus an opaque `ref` (e.g. venv path, image name) and a display `label`. Note the deliberate `label?: string | undefined` — explicit-undefined-friendly for `exactOptionalPropertyTypes`-style consumers.
- `RecipeBase` (`recipes.ts:14-41`): the canonical recipe shape sent over the wire — model path, vision flag, backend, runtime, parallelism (`tensor_parallel_size`, `pipeline_parallel_size`), memory knobs (`max_model_len`, `gpu_memory_utilization`, `kv_cache_dtype`), parser config (`tool_call_parser`, `reasoning_parser`), network (`host`, `port`), the escape hatch `extra_args: Record<string, unknown>`, and thinking-mode config. Every field except nullable ones is required — this is the **server's serialized form**, not the input form.
- `RecipePayload` (`recipes.ts:48-49`): the create/update DTO — `Pick` the three required keys (`id`, `name`, `model_path`) and `Partial` everything else. The JSDoc (`recipes.ts:43-47`) explicitly says omitted fields are defaulted server-side. `Serve`/`ServePayload` (`recipes.ts:51-52`) are pure aliases kept for older call sites.
- Download tracking: `DownloadStatus` (`recipes.ts:54-60`, six-state machine `queued → downloading → paused/completed/failed/canceled`), per-file `DownloadFileInfo`, and aggregate `ModelDownload` (`recipes.ts:71-86`) with byte counters, optional speed, and an error string. Optional-vs-null distinction matters: `source?`/`completed_at?` may be absent; `revision`/`error` are always present but nullable.
- `StorageInfo` (`recipes.ts:88-98`) and `ModelInfo` (`recipes.ts:100-114`): disk accounting and the scanned-model shape. `ModelInfo` carries GGUF/architecture metadata (`num_hidden_layers`, `num_kv_heads`, `hidden_size`, `head_dim`) used by the frontend's VRAM estimator, plus reverse links (`recipe_ids`, `has_recipe`).

### `engine-args.ts` (281 lines) — shared CLI-argument policy

The most logic-heavy file in the package. It encodes **which keys in `recipe.extra_args` are legal, which are internal, and which must be stripped per-backend** — used by both the controller's command builders and the frontend's recipe editor so both agree.

- `engineArgKey(field)` (`engine-args.ts:14`): snake_case → kebab-case (CLI flag style). `normalizeEngineArgKey` (`:16`) additionally lowercases/trims — the comparison key everywhere below.
- `ENGINE_ARG_SPECS` (`engine-args.ts:18-109`): ~65 declarative specs `{ field, type: "string"|"number"|"boolean", scope, aliases? }`, `as const satisfies readonly EngineArgSpec[]`. Scope semantics:
  - `"vllm"` — real vLLM CLI flags (tokenizer, speculative decoding, LoRA, multimodal, logging…).
  - `"shared"` — only `chat_template` (`:26`): meaningful to more than one backend.
  - `"device"` — GPU-selection env-ish keys (`visible_devices`, `cuda_visible_devices`, `hip_visible_devices`, `rocr_visible_devices`, `:79-108`) with uppercase `*_VISIBLE_DEVICES` aliases. These are consumed by the controller (env injection), never passed as CLI flags.
- `stripForeignFlagKeys(backend, extraArgs)` (`engine-args.ts:162-175`): given a backend, returns a copy of `extra_args` minus keys that only vLLM understands. The "foreign" set for sglang is `VLLM_ONLY_FLAG_KEYS` minus `SGLANG_COMPATIBLE_VLLM_KEYS` (`:115-148`, a hand-maintained allowlist of flags SGLang happens to accept, like `enable-prefix-caching`); for llamacpp/mlx it's the full vLLM set. Consumers: `src/modules/engines/specs/sglang-spec.ts:91`, `mlx-spec.ts:21`, `llamacpp-spec.ts:82`, and the frontend's `prepare-recipe.ts` — so the previewed command and the actually-launched command match exactly.
- `KNOWN_VLLM_EXTRA_ARG_KEYS` (`:177-215`) + `VLLM_EXPERIMENTAL_PREFIXES` (`:217-224`) + `getUnknownVllmExtraArgKeys` (`:262-273`): the validation side — any key not known and not matching an experimental prefix (`fuse-`, `rok-`, `swap-`, …) is reported as unknown by `vllm-spec.ts`.
- `INTERNAL_RECIPE_KEYS` / `isInternalRecipeKey` (`:226-245`): keys that live in recipes but are controller metadata, not engine flags — device-scope keys plus `venv-path`, `env-vars`, `description`, `tags`, `launch-command`, `docker-image`, etc. The command builder skips them (`src/modules/engines/process/backend-builder.ts:39`) and the frontend editor hides them from the "extra args" UI.
- `isJsonStringArgumentKey` (`:247-253`): `speculative-config` and `default-chat-template-kwargs` hold JSON-in-a-string; `backend-builder.ts:53` passes them through without the normal value mangling.
- `looksLikeNotesKey` (`:275-281`): heuristic for "this key is a user's scratch note, not a flag" — `*-notes`, `benchmark-notes*`, or keys ending in a 6–8 digit date stamp (`-\d{6,8}`). Used by `vllm-spec.ts:63` to downgrade unknown-key warnings for annotation keys.

### `model-capabilities.ts` (123 lines) — vision-capability inference

Pure functions deciding whether a model supports image input. Shared so the controller's `/models` listing and the frontend render the same `vision` boolean.

- `VISION_IDENTIFIER_PATTERNS` (`model-capabilities.ts:8-44`): ~35 lowercase substring patterns (`qwen-vl`, `llava`, `pixtral`, `vision`, `-mm-`, …) matched against model identifiers by `inferModelVision` (`:111-115`) — a deliberately crude name-based heuristic, last in the precedence chain.
- The metadata parsers are careful about untrusted JSON: `isRecord` (`:46`), `booleanValue` (`:49-56`, accepts booleans **and** strings like `"1"/"true"/"yes"/"on"`), `imageModality` (`:66-74`, accepts arrays or comma-joined strings, true if any entry is `image`/`vision`).
- `legacyVision` (`:86-109`): probes a HuggingFace-style metadata object through multiple historical field spellings (`vision`, `supportsVision`, `supports_vision`, `multimodal`, `capabilities.vision/image`, then modality lists under `input`/`inputs`/`modalities`/`input_modalities`). `firstBoolean` takes the first parseable answer; `firstImageModality` (`:76-84`) returns `true` on any positive, `false` only if some modality list was actually declared, `undefined` if no information — a three-valued logic.
- `resolveModelVision` (`:117-123`): the public entry — `recipeOverride ?? legacyVision(metadata) ?? inferModelVision(identifiers)`. Explicit recipe setting beats metadata beats name heuristic. Consumer: `src/modules/models/routes.ts:64,146`.

### `system.ts` (181 lines) — config, runtime, and compatibility DTOs

Response shapes for the settings/diagnostics endpoints. Pure interfaces, no logic.

- `SystemConfig` (`system.ts:10-21`): host/ports, paths (`models_dir`, `data_dir`, `db_path`), per-backend interpreter/binary overrides, and `api_key_configured: boolean` — note the API exposes only the **boolean**, never the key itself.
- `EngineBackend` (`:37`) and `RuntimeKind` (`:39`): duplicates of `recipes.ts` unions with one difference — `RuntimeKind` is `"venv"` while `ServeRuntimeKind` is `"managed_venv"` (a wart; see below).
- `RuntimeTarget` (`:41-71`): the frontend's engine-management card model — install state, `source: "configured" | "discovered" | "running" | "bundled"`, a `capabilities` object (what the UI may offer: launch/update/inspect/docker), a `health` status, and an optional `update` block describing an available upgrade (versions, package spec, release-notes URL, `restartRequired`, changelog lines).
- `EngineJob` (`:73-86`): an async install/update/download/inspect job with `queued/running/success/error/cancelled` states, optional `progress`, `outputTail` (last lines of process output), and `error`.
- Platform detection shapes: `RuntimePlatformKind` (`cuda|rocm|metal|unknown`), `RuntimeRocmInfo` (including which SMI tool was found), `RuntimeTorchBuildInfo`, `RuntimeGpuMonitoringInfo` (`:88-128`).
- `CompatibilityCheck` / `CompatibilityReport` (`:135-166`): id + `info|warn|error` severity + message + `evidence` + `suggested_fix` — a self-describing diagnostics list the UI can render verbatim.
- `ConfigData` (`:168-173`): the aggregate GET response — config + services + environment URLs + full runtime info.
- `RuntimeUpgradeResult` (`:175-181`): success flag, resolved version, captured `output`, `error`, and `used_command` (the exact command run, for display/support).

### `observability.ts` (174 lines) — GPU/metrics/peaks DTOs

- `GPU` (`observability.ts:3-21`): per-device telemetry with an important pattern — every optional reading has a paired `*_available?: boolean` flag (`memory_usage_available`, `utilization_available`, `temperature_available`, `power_available`). This lets the UI distinguish "sensor reads zero" from "sensor absent" (relevant for Apple Silicon / unified memory, cf. `memory_shared`).
- `Metrics` (`:23-85`): the big SSE-pushed metrics payload — three **tiers of peaks**: session averages (`session_avg_*`), current-session peaks (`session_peak_*`, "reset on model switch" per the comment at `:49`), best-session-per-model (`best_session_*`), all-time peaks (`peak_*`), and lifetime counters (`lifetime_*`, including energy accounting `lifetime_energy_kwh`, `kwh_per_million_tokens`). A reader should treat the `session_* / best_session_* / peak_* / lifetime_*` prefixes as the organizing schema of the whole struct.
- `VRAMCalculation` (`:88-103`): the estimator result — total plus a `breakdown` (weights / kv-cache / activations / per-GPU), plus both `fits_in_vram` and `fits` (two spellings kept for compatibility).
- `PeakMetrics` (`:105-116`), `ProcessInfo` (`:118-124`, a running engine process: pid/backend/port), `LogSession` (`:126-137`, `running|stopped|crashed`).
- `StudioSettings` (`:139-148`): separates `persisted` (what's actually in the config file — optional) from `effective` (resolved with defaults) — a pattern worth copying.
- `StudioDiagnostics` (`:150-174`): the support-bundle shape — OS, memory, `gpus: GPU[]`, vLLM install probe, disks, and the full `SystemConfig` (imports `system.ts`, the only intra-package import along with `engine-args → recipes`).

### `usage.ts` (184 lines) — analytics response shapes

- `UsageStats` (`usage.ts:68-184`): the inference-analytics dashboard payload. `totals` includes token splits and unique sessions/users; `latency` and `ttft` carry full percentile sets (avg/p50/p95/p99); `cache` tracks prefix-cache hit rates; `week_over_week` and `recent_activity` provide pre-computed comparison deltas (`change_pct`, nullable when the previous period is empty); breakdowns by model, by day, by hour; `peak_days`/`peak_hours`. Optional `daily_by_model?` and `controller?` sub-objects let the endpoint trim payload size.
- `ControllerUsageStats` (`:1-66`): the same idea for the controller's own HTTP API (by-path, by-status, recent errors with `error_class`/`error_message`) plus an optional `function_calls?` section for tool-call analytics. Nullability convention throughout: `number | null` means "no data", not "zero".

### `speech.ts` (47 lines) — TTS (Chatterbox) contract

- Three pinned constants: `CHATTERBOX_BACKEND = "chatterbox-turbo"`, `CHATTERBOX_PACKAGE_VERSION = "0.1.7"`, `CHATTERBOX_MODEL_REVISION` (a git SHA) (`speech.ts:1-3`). The controller uses them for install paths, pip specs (`chatterbox-tts==0.1.7`), and Schema **literals** — worker handshake messages are only accepted if backend/version/revision match exactly (`src/modules/speech/runtime.ts:26-27`, `worker-client.ts:49-51`). Bumping the version here forces re-install and re-handshake everywhere.
- Two small state machines: `SpeechInstallPhase` (`missing|installing|ready|failed`) and `SpeechWorkerPhase` (`stopped|starting|ready|busy|failed`) (`:5-6`).
- `SpeechStatus` (`:21-47`): install progress, worker `queue_depth`, target GPU, prerequisites (ffmpeg, python 3.11, storage with `available/required/ready`), and `voice_count`. `SpeechVoiceProfile` (`:14-19`) is a cloned-voice record.

### `rigs.ts` (126 lines) — multi-machine topology + the only Effect Schemas

- Domain types: `RigHardwareType` (7 values, `rigs.ts:3-10`), `RigNodeRole` (`head|worker|standalone`), `RigNodeSource` (`detected|manual`), `RigAccelerator`, `RigNode` (a machine: hostname/address/CPU/memory/accelerators), `Rig` (named group of nodes), `RigsPayload` (all rigs + `local_node_id` identifying this machine).
- UI constants colocated with the types: `RIG_HARDWARE_TYPES`, `RIG_NODE_ROLES` arrays (`:55-65`) and `RIG_*_LABELS` display maps (`:67-81`) — the frontend renders dropdowns directly from these (`frontend/src/features/configure/rig-node-card.tsx`), so adding a hardware type here updates both sides.
- The only Effect code in the package: `RigAcceleratorInputSchema`, `RigCreateSchema`, `RigUpdateSchema`, `RigNodeCreateSchema`, `RigNodeUpdateSchema` (`:83-126`), built with `Schema.Struct` + `Schema.optional`/`Schema.NullOr`. These validate **incoming** POST/PATCH bodies on the controller (`src/modules/studio/rig-routes.ts:196` decodes with `RigNodeCreateSchema`). Note the convention: input schemas are permissive (`optional`, `NullOr`) while the output interfaces above are strict — validation normalizes at the boundary.

### `controller-events.ts` (132 lines) — the SSE event vocabulary

- `CONTROLLER_EVENTS` (`controller-events.ts:1-26`): an `as const` map of SCREAMING_KEY → kebab-string event names (25 events: status/gpu/metrics, launch/download lifecycle, recipe CRUD, rig updates, MCP server/tool events, per-runtime upgrade completions, and `LOG`). Using a const object (not an enum) keeps the string values literal-typed and tree-shakeable.
- `CONTROLLER_STREAM_EVENT_TYPES` (`:31-55`): the subset actually sent over the `/events` SSE stream — **deliberately excludes `LOG`** (log lines travel on a separate channel/mechanism), even though `event-manager.ts:124` publishes LOG events through the same `EventManager`. The type `ControllerStreamEventType` is derived via indexed access (`:57-58`).
- Domain routing: `ControllerEventDomain` (`recipe|runtime|controller|mcp`, `:60-64`) and the exhaustive `CONTROLLER_EVENT_DOMAIN_MAP` (`:66-93`) — exhaustiveness is compiler-enforced because it's typed `Record<ControllerStreamEventType, ...>`, so adding a stream event without a domain is a compile error.
- `CONTROLLER_BROWSER_EVENT_CHANNEL` (`:95-100`): maps each domain to a browser `CustomEvent` name (`vllm:recipe-event`, etc.). Note `mcp` shares `vllm:controller-event` with `controller`.
- Three helper functions form the runtime pipeline (`:105-132`): `isControllerStreamEventType` (Set-backed type guard), `getControllerEventDomain`, and `getBrowserEventChannelForControllerEvent` — the chain an SSE consumer runs to turn an incoming `event:` line into "which browser event do I dispatch, and which store should handle it". The frontend mirrors this in `frontend/src/lib/controller-events-contract.ts`.

## 3. How data/control flows

This package has no I/O of its own; the flows are **flows of shapes and policies** across the controller/frontend boundary:

1. **REST response flow (outbound):** controller stores/services build objects typed by these interfaces → Hono handlers return them as JSON → frontend's `frontend/src/lib/types.ts` re-exports the same interfaces (`recipes`, `system`, `usage`, `rigs`, `observability`) → React components consume them. Example: `UsageStats` (`usage.ts:68`) is assembled in `src/modules/system/usage-routes.ts` / `usage-utilities.ts` from the SQLite request stores (`src/stores/inference-request-store.ts`, `controller-request-store.ts`) and rendered by the frontend analytics views.
2. **Request validation flow (inbound):** frontend POSTs a rig node → `RigNodeCreateSchema` (`rigs.ts:102`) decodes/validates the body in `rig-routes.ts:196` → rig store persists → `RigsPayload` (`rigs.ts:50`) returned. Only `rigs.ts` participates in inbound validation; everything else is outbound-only typing.
3. **Recipe → process-argv flow:** frontend editor edits `RecipePayload` (`recipes.ts:48`) → controller stores a full `RecipeBase` → backend builders (`src/modules/engines/process/backend-builder.ts:39,53` and `specs/*-spec.ts`) apply the `engine-args.ts` policies: skip `isInternalRecipeKey` keys, strip `stripForeignFlagKeys(backend, …)` for non-vLLM backends, pass JSON-string args through untouched, and flag unknown keys via `getUnknownVllmExtraArgKeys`/`looksLikeNotesKey`. The frontend's `prepare-recipe.ts` runs the *same* `stripForeignFlagKeys` so the command preview matches reality.
4. **SSE flow:** services call `EventManager.publish` with names from `CONTROLLER_EVENTS` (`event-manager.ts:101-147`) → the `/events` stream emits typed events → consumers run `isControllerStreamEventType` → `getControllerEventDomain` → `getBrowserEventChannelForControllerEvent` (`controller-events.ts:109-132`) to dispatch browser events to the right frontend store. Payloads of the high-frequency events (`gpu`, `metrics`) are the `GPU[]`/`Metrics` interfaces from `observability.ts`.
5. **Speech handshake flow:** `speech/service.ts` reports `SpeechStatus` built from the pinned constants (`speech.ts:1-3`); the Python worker's handshake is validated against `Schema.Literal(CHATTERBOX_*)` — a version skew between controller and worker fails fast at connect time.

## 4. Key patterns & idioms

- **Types-only-by-default, functions-only-when-shared.** Most files export bare interfaces (zero runtime footprint, erased at compile). Runtime code is added only when *both* sides need identical behavior: `stripForeignFlagKeys`, `resolveModelVision`, the event-routing helpers, and the rigs Schemas.
- **`as const` + derived types.** Unions are defined once as const arrays/objects, and types are derived (`(typeof X)[keyof typeof X]`, `[number]` indexing) — single source of truth, no enum runtime cost. See `CONTROLLER_EVENTS`/`ControllerEventType` (`controller-events.ts:1-29`) and `ENGINE_ARG_SPECS` (`engine-args.ts:109`).
- **Three-valued logic for capability detection.** `resolveModelVision` chains `??` over `boolean | undefined` results (`model-capabilities.ts:117-123`) — "explicit override → declared metadata → name heuristic". Understanding `firstBoolean`/`firstImageModality`'s undefined-means-unknown convention is the key to reading that file.
- **Normalization before comparison.** Every key lookup goes through `normalizeEngineArgKey` (`engine-args.ts:16`) so `cuda_visible_devices`, `CUDA_VISIBLE_DEVICES`, and `cuda-visible-devices` all match — important because recipe JSON comes from users and YAML-ish sources with inconsistent casing.
- **Exhaustive Records as compiler-checked switch statements.** `CONTROLLER_EVENT_DOMAIN_MAP` (`controller-events.ts:66-93`) and the `RIG_*_LABELS` maps (`rigs.ts:67-81`) use `Record<Union, V>` so the compiler forces updates when the union grows.
- **Effect Schema at the trust boundary only.** The package depends on `effect` purely for `rigs.ts` request validation; `Schema.Struct`/`Schema.optional`/`Schema.NullOr` in effect@4 build decoders whose static type is recovered via `Schema.Schema.Type<typeof …>` (used in `rig-routes.ts:54`). The pattern: strict interfaces for what the server emits, permissive schemas for what it accepts.
- **Availability flags instead of sentinel values.** `GPU.*_available` booleans (`observability.ts:17-21`) and `number | null` in `usage.ts` encode "not measurable" explicitly rather than overloading 0/−1.
- **Pinned-version constants as protocol version.** The `CHATTERBOX_*` constants (`speech.ts:1-3`) double as a wire-protocol version negotiated via Schema literals.

## 5. Connections

**Intra-package imports (the whole dependency graph inside `contracts/`):**
- `engine-args.ts:1` imports `Backend` from `recipes.ts`.
- `observability.ts:1` imports `SystemConfig` from `system.ts`.

**Consumed by the controller (`src/`, 36 files):**
- `controller-events.ts` → `src/modules/system/event-manager.ts` (SSE publish names) and `logs-routes.ts`.
- `engine-args.ts` → `src/modules/engines/process/backend-builder.ts`, `specs/{vllm,sglang,llamacpp,mlx}-spec.ts` (command building/validation).
- `model-capabilities.ts` → `src/modules/models/routes.ts:64,146` (`resolveModelVision`).
- `recipes.ts` → engine specs, runtimes, download manager, `src/modules/engines/types.ts`, `src/modules/models/types.ts` (5 imports — the heaviest consumer).
- `rigs.ts` → `src/modules/studio/rig-routes.ts` (schemas), `rig-store.ts`, `rig-detection.ts`.
- `speech.ts` → `src/modules/speech/{service,runtime,worker-client}.ts`, `src/modules/audio/routes.ts:234` (OpenAI-compat route maps `model: "chatterbox-turbo"` to the TTS worker).
- `usage.ts` → `src/modules/system/usage-routes.ts`, `usage-utilities.ts`, `pi-sessions.ts`, both request stores.
- `system.ts` / `observability.ts` → runtime-target factory, upgrade/install machinery, diagnostics endpoints.

**Consumed by the frontend:** `frontend/package.json:50` (`file:../controller/contracts`); `frontend/src/lib/types.ts` re-exports most interfaces; feature code imports `engine-args`, `controller-events`, `rigs`, `speech` directly (21 import sites). The frontend's `controller-events-contract.ts` mirrors the event-routing helpers.

**Resolution mechanics:** controller-side imports resolve via the tsconfig `paths` entry (`controller/tsconfig.json:21`), which Bun honors natively; frontend-side via the `file:` dependency and the package's wildcard `exports` map (`contracts/package.json:6-8`).

## 6. How to read this code

Suggested order for a newcomer:

1. **`package.json` first** (30 seconds): understanding that imports resolve to raw `.ts` via a wildcard `exports` map explains why there is no build output and why the frontend and controller always see identical types.
2. **`recipes.ts`** — the domain nouns (`Backend`, `RecipeBase`, `ModelDownload`). Everything else references these; read `RecipeBase` field-by-field since it's the largest flat struct and the center of the app.
3. **`controller-events.ts`** — read top to bottom: const map → stream subset → domain map → channel map → the three helper functions at `:105-132`. It's the cleanest example of the package's "const object + derived types + exhaustive Record" style.
4. **`observability.ts` + `usage.ts`** together — skim as pure DTO catalogs; learn the prefix conventions (`session_`/`best_session_`/`peak_`/`lifetime_`, `*_available`, `number | null`) rather than memorizing fields.
5. **`system.ts`** — same treatment; note `RuntimeTarget.capabilities` and `CompatibilityReport` as "UI-driven" shapes (the server describes what the UI may offer).
6. **`engine-args.ts`** — read after you know `RecipeBase.extra_args`. Start at the exported functions at the bottom (`stripForeignFlagKeys:162`, `getUnknownVllmExtraArgKeys:262`, `isInternalRecipeKey:244`) and work backward to the tables they consume. The three scope values (`vllm`/`shared`/`device`) are the mental model.
7. **`model-capabilities.ts`** — read the public `resolveModelVision:117` first, then the parsers it chains. Appreciate the three-valued `boolean | undefined` convention before judging the code as convoluted.
8. **`rigs.ts` + `speech.ts`** last — the only files with runtime validation/pinning concerns; read them alongside their consumers (`rig-routes.ts`, `speech/runtime.ts`) to see why the Schemas and constants live here.

What to look for first in any file: **is this export type-only or runtime?** Type-only exports are documentation; runtime exports (const maps, functions, Schemas) are behavior that must stay in lockstep between two separately-built apps — those are where breaking changes hide.
