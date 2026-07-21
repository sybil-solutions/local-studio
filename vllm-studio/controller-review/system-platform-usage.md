# Code Review: system platform + usage slice

Scope: `controller/src/modules/system/platform/` (8 files), `controller/src/modules/system/usage/` (2 files), `controller/src/modules/system/usage-routes.ts`. All paths below are relative to `/Users/sero/projects/vllm-studio/controller`.

---

## 1. Purpose

This slice answers two questions for the rest of the controller: **"what hardware am I running on?"** and **"how much has the inference server been used?"**. The `platform/` files probe the host for GPUs and accelerator toolchains by shelling out to vendor tools (`nvidia-smi`, `amd-smi`, `rocm-smi`, `hipcc`, `rocminfo`, `lspci`) or reading Linux sysfs, normalizing everything into one `GpuInfo[]` shape. The `usage/` files and `usage-routes.ts` expose aggregated request/token statistics over HTTP — from the controller's own SQLite request store, and (as a side feature) from a local Pi coding-agent's JSONL session logs.

---

## 2. File-by-file walkthrough

### `src/modules/system/platform/smi-tools.ts` (36 lines) — binary resolution & env overrides

Pure, synchronous, Effect-free helpers. Everything else in `platform/` funnels through here to find executables.

- `resolveConfiguredBinary(envKey, fallback)` (`smi-tools.ts:6`) — reads an env var (`NVIDIA_SMI_PATH`, `AMD_SMI_PATH`, `ROCM_SMI_PATH`); if set and non-empty uses it, else the bare tool name; then delegates to `resolveBinary` in `src/core/command.ts:246`, which uses `Bun.which` against an augmented PATH (prepends `LOCAL_STUDIO_RUNTIME_BIN` or the snap runtime dir, appends `~/.local/bin`, `~/bin`, `/home/<user>/...` — see `binarySearchPath` at `src/core/command.ts:232`).
- `resolveNvidiaSmiBinary` / `resolveAmdSmiBinary` / `resolveRocmSmiBinary` (`:11`, `:14`, `:17`) — thin wrappers returning `string | null`.
- `resolveForcedGpuMonitoringTool` (`:20`) — reads `LOCAL_STUDIO_GPU_SMI_TOOL` and validates it against the whitelist `nvidia-smi | amd-smi | rocm-smi | intel-sysfs`. This is the user's escape hatch when auto-detection picks wrong.
- `resolveForcedRocmTool` (`:33`) — narrows the forced value to the ROCm subset.

### `src/modules/system/platform/torch-info.ts` (37 lines) — PyTorch build probe

- `TORCH_PROBE_ARGS` (`:7`) — an inline Python one-liner (passed as `python -c`) that imports `torch` and prints a JSON object `{torch_version, torch_cuda, torch_hip}`. The `try/except` inside the Python means a missing torch still prints valid JSON with nulls, so the TS side almost never sees a non-zero exit from import failure.
- `getTorchBuildInfo(python)` (`:34`) — runs the probe via `runCommandAsyncEffect` with a 3 s timeout and maps the result through `parseTorchBuildOutput` (`:18`), which returns `EMPTY_TORCH` (all nulls) on non-zero exit or malformed JSON. Errors never propagate; worst case is "unknown".
- The `torch_hip` / `torch_cuda` fields are what `detectPlatformKind` (`src/modules/engines/runtimes/runtime-info.ts:165`) uses to decide ROCm vs CUDA — this tiny probe drives platform classification.

### `src/modules/system/platform/nvidia-compute-processes.ts` (55 lines) — "which GPUs are busy?"

- `FULL_NVIDIA_UUID` (`:5`) — strict regex for `GPU-xxxxxxxx-...` UUIDs.
- `NvidiaComputeProcessDependencies` (`:9`) — an injectable seam: `{ resolveBinary, execute }`. The default `dependencies` object (`:17`) wires the real binary resolver and `runCommandAsyncEffect` with 5 s timeout / 256 KB output cap. Designed for tests, though no tests currently exist for it.
- `computeGpuUuids` (`:25`) — parses `nvidia-smi --query-compute-apps=gpu_uuid,pid --format=csv,noheader,nounits` output. Notably **strict**: any line that isn't exactly two comma-separated fields with a valid UUID and numeric PID throws (`:32`). All-or-nothing — one malformed line fails the whole query.
- `canonicalUuid` (`:23`) — lowercases everything after the `GPU-` prefix and dedupes via a `Set`, so the result is the set of GPU UUIDs that have ≥1 compute process.
- `queryNvidiaComputeGpuUuids` (`:40`) — returns `Effect<readonly string[], Error>`; one of the few functions in this slice with a typed error channel (fails when the binary is missing, the command fails, or `exitConfirmed === false`). Sole consumer: `src/modules/speech/service.ts:356`, which uses the busy-GPU list to place speech models.

### `src/modules/system/platform/compatibility-report.ts` (185 lines) — health-check report builder

Two exports:

- `probeGpuMonitoring(kind, rocmTool)` (`:31`) — actually *executes* each candidate smi tool with a harmless query (`--query-gpu=name` for nvidia, `version` for amd-smi, `--showproductname` for rocm-smi), 2 s timeout each, and reports `{available, tool}`. For `rocm` with no preference it tries amd-smi first, then rocm-smi (`:67-77`). Used by `runtime-info.ts:134` when the nvidia snapshot wasn't already taken.
- `buildCompatibilityReport(args)` (`:83`) — a **pure function** (no Effect) that turns a `SystemRuntimeInfo` plus port-occupancy facts into a `CompatibilityReport`: a list of `CompatibilityCheck`s with `id`, `severity` (`info|warn|error`), `message`, `evidence`, `suggested_fix`. Checks emitted:
  - `gpu.none-detected` (`:94`, warn) — with platform-specific fixes;
  - `torch.rocm-missing-hip` (`:112`, error) — ROCm platform but `torch.version.hip` is null, i.e. the user installed a CUDA/CPU torch build;
  - `gpu-monitoring.rocm-unavailable` (`:127`, warn) / `gpu-monitoring.cuda-unavailable` (`:138`, warn) — the cuda one even mentions the snap-bun PATH gotcha (`:146`);
  - `inference.port-in-use` (`:150`, error) — port open but process unknown → something else is squatting on the inference port;
  - `backends.none-installed` (`:161`, info).
- `toEvidence` (`:13`) joins non-empty lines into a single evidence string or null. `addCheck` (`:18`) normalizes optional fields to null. Served by `GET /compat` in `src/modules/system/routes.ts:112-136`.

### `src/modules/system/platform/gpu.ts` (229 lines) — the GPU detection hub

The central file of the slice; everything GPU-shaped in the controller ultimately calls `getGpuInfo()`.

- `NVIDIA_SMI_GPU_FIELDS` (`:16`) — 10 query columns; `NVIDIA_SMI_SNAPSHOT_QUERY` (`:29`) appends `driver_version` as column 11. `parseNvidiaSmiDriverVersion` (`:96`) recovers it by indexing `split(",")[NVIDIA_SMI_GPU_FIELDS.length]` — a deliberate coupling: the driver version position is derived from the field-array length so adding a field doesn't silently break the index.
- `parseNvidiaSmiGpuLine` (`:36`) — CSV line → `GpuInfo`. Handles `N/A` / `[Not Supported]` sentinels (`identity`, `:51`), non-finite numbers → 0 (`toFiniteNumber`, `:57`). The interesting bit is the **unified-memory fallback** (`:64-70`): on NVIDIA GB10/Grace systems `memory.total` reports 0, so it substitutes host RAM (`totalmem()`/`freemem()`) for total/free and derives used = total − free.
- `queryNvidiaSmiSnapshot()` (`:109`) — returns `Effect<NvidiaSmiSnapshot | null>`: `null` when no binary, `{available, gpus, driverVersion}` otherwise. Note the final `Effect.catch` (`:125`) that converts any defect into `{available: false, ...}` — snapshot queries never fail the caller.
- `detectGpuMonitoringTool()` (`:132`) — boot-time tool selection (called from `src/main.ts:21`): forced env → nvidia-smi → rocm tool → intel sysfs (actually runs a probe) → null.
- `warnNoGpuToolingOnce` (`:145`) — module-level `warnedNoGpuTooling` flag so the "no GPUs found" log (which lists what was attempted, `:148-153`) prints once per process, not on every poll.
- `collectGpuInfo()` (`:157`) — the vendor fallback cascade, in order:
  1. If a tool is **forced** via env, use exactly that tool and return whatever it yields — even an empty list (`:159-171`). Forced means authoritative; no fall-through.
  2. nvidia-smi; return if non-empty (`:173`).
  3. ROCm: try the resolved tool first, then the *other* ROCm tool as backup (`:178-188`) — asymmetric: amd-smi preferred falls back to rocm-smi and vice versa.
  4. Intel sysfs (`:190`).
  5. **Apple Silicon pseudo-GPU** (`:195-217`): on darwin/arm64 fabricates a single `GpuInfo` from the CPU model name and host RAM, with all `*_available: false` flags so the UI shows "shared memory, no telemetry" instead of zeros. Note it sets `id: "apple-metal-0"` even though `GpuInfo = Omit<GPU, "id">` (`src/modules/models/types.ts:58`) — the excess property survives inference and leaks into JSON responses.
- `getGpuInfo()` (`:222`) — public wrapper: collect, warn-once if empty, return. Consumers: `metrics-collector.ts:52` (periodic telemetry), `metrics-routes.ts:53`, `system/routes.ts:108` (`GET /gpus`) and `:207` (VRAM fit estimation), `studio/routes.ts:173,241,264`, `studio/rig-detection.ts:118`, `runtime-info.ts:104`, and it's re-exported on `AppContext.gpuInfo` (`src/app-context.ts:197,217`).

### `src/modules/system/platform/intel-gpu.ts` (169 lines) — Intel Arc via Linux sysfs

No vendor CLI; reads `/sys/bus/pci/devices` and `/sys/class/drm` directly with synchronous `node:fs`.

- `isIntelComputeGpu` (`:41`) — a PCI device counts if its bound driver is `xe` (the new Intel GPU driver), or device ID is `0xe223` (Arc Pro B70, hardcoded), or its class code starts with `0x03` (display controllers — broad, catches integrated GPUs too).
- `discoverIntelPciGpus` (`:47`) — scans sysfs for vendor `0x8086` (Intel), sorted by PCI address for stable indices.
- `findDrmDevicePaths` (`:72`) — correlates a PCI device with its `/sys/class/drm/cardN/device` node by comparing `realpathSync` of both — a robust way to match symlinks without string parsing.
- `readIntelName` (`:113`) — shells out to `lspci -s <addr>` for a human name, with a hardcoded fallback table of exactly one entry (`0xe223` → "Intel Arc Pro B70", else generic "Intel Arc GPU", `:124`).
- `getGpuInfoFromIntelSysfs` (`:134`) — per GPU: VRAM total/used from `mem_info_vram_{total,used}` (bytes → MB), temperature from hwmon `temp1_input` (millidegrees → °C, `:146`), power from `power1_input`/`power1_cap` (µW → W, `:147-152`). **Utilization is hardcoded 0** (`:161`) — sysfs exposes no cheap per-engine utilization, so Arc always reports 0% busy.

### `src/modules/system/platform/rocm-info.ts` (96 lines) — ROCm toolchain info

- `resolveRocmSmiTool()` (`:18`) — forced env → amd-smi → rocm-smi → null. Synchronous.
- `readRocmVersion()` (`:31`) — reads `/opt/rocm/.info/version*` (tries `version` first, then any `version*` entry, `:42-53`); overridable via `LOCAL_STUDIO_ROCM_VERSION_FILE` (`:32`) for testing/non-standard installs.
- `getRocmInfo(smiTool)` (`:67`) — runs `hipcc --version` (3 s timeout; parses `HIP version: X.Y` from stdout *or* stderr, `:75-78`) and `rocminfo` (extracts all `gfxXXXX` arch strings via regex into a deduped list, `:81-87`), plus `upgrade_command_available` from `isUpgradeCommandConfigured(ROCM_UPGRADE_ENV)` — i.e. whether `LOCAL_STUDIO_ROCM_UPGRADE_CMD` is set (`src/modules/engines/runtimes/upgrade-config.ts:49,59`). Spawn failures are swallowed by `runCommandAsyncEffect` (status null → fields stay null). Consumed by `runtime-info.ts:120`, `engines/runtime-routes.ts:213`, `runtimes/runtime-upgrade.ts:66`.

### `src/modules/system/platform/amd-gpu.ts` (323 lines) — AMD GPU telemetry parsers

The largest file; half of it is defensive parsing of two very different tool output formats.

**amd-smi path (JSON):**
- `parseAmdSmiMetricJson` / `parseAmdSmiStaticJson` (`:84`, `:96`) — exported, tolerant JSON parsers: `JSON.parse` in try/catch, then structural checks (`isRecord`, `gpu_data` array) rather than schema validation. Bad input → `[]`, never throws.
- `readAmdSmiValueMb` (`:55`) — handles the `{value, unit} | "N/A" | null` union amd-smi emits, converting GB/GiB to MB.
- `getGpuInfoFromAmdSmi()` (`:206`) — runs **two** commands, `amd-smi metric --json -g all` and `amd-smi static --json -g all` (5 s each, sequential), and joins them by GPU index to get `asic.market_name` for the display name. Gotcha: if the *static* call fails, the whole function returns `[]` (`:219`) even though the metrics were fine — the name lookup is treated as mandatory. `power_limit` is hardcoded 0 (`:271`).

**rocm-smi path (text):**
- `parseRocmSmiText` (`:141`) — a line-oriented state machine over the human-readable `GPU[N] : <label> : <value>` format, accumulating per-index partial records in a `Map`. Label matching is substring-based and brittle by necessity (`"total vram"`, `"gpu use"`, `"average" + "power" + "(w)"`, `:159-182`); `enrichUnitFromLabel` (`:130`) recovers units like `(MiB)` from the label when the value lacks one. Exported (testable pure function).
- `getGpuInfoFromRocmSmi()` (`:277`) — runs one multi-flag query (`--showproductname --showmeminfo vram --showuse --showtemp --showpower`); on non-zero exit retries with **bare `rocm-smi`** (`:291-293`) and parses whatever comes back on stdout+stderr combined (`:295`) — older rocm-smi versions print summaries to stderr.

### `src/modules/system/usage/pi-sessions.ts` (458 lines) — Pi agent session-log aggregator

Parses a *different* program's logs: the Pi coding agent writes JSONL session transcripts to `$PI_CODING_AGENT_DIR/sessions` or `~/.pi/agent/sessions` (`piSessionsRoot`, `:53`). This lets the Local Studio UI show "how much have your local models been used by the agent" alongside its own stats.

- `collectJsonlFiles(root)` (`:74`) — recursive directory walk collecting `{path, mtimeMs, size}` for every `.jsonl`. `Effect.tryPromise` + `Effect.catch` at both the `readdir` and `stat` level so permission errors on subtrees are skipped, not fatal.
- **Two-level caching** is the key design feature:
  - `fileRecordCache` (`:100`) — per-file parsed records, invalidated by `(mtimeMs, size)` (`:107`). Since session files are append-mostly, unchanged files are never re-parsed. Stale entries for deleted files are pruned on each run (`:328-330`).
  - `resultCache` (`:292`) — whole-result memo with 30 s TTL (`RESULT_TTL_MS`, `:291`), keyed by `root + \u0000 + sorted knownModels` (`:300`).
- `parseFileRecords` (`:105`) — streams the file line-by-line: `Effect.acquireRelease` creates a `createReadStream` + `readline` pair and guarantees `reader.close(); input.destroy()` on completion *or interruption* (`:120-130`); the reader is adapted into an Effect `Stream` via `Stream.fromAsyncIterable` and consumed with `Stream.runForEach`. Files over 256 MB (`LARGE_FILE_BYTES`, `:71`) just get a warning log — streaming keeps memory flat regardless. Each line is `JSON.parse`d then validated with `Schema.decodeUnknownSync(JsonObjectSchema)` (`:140`) — a `Schema.Record(String, Unknown)` check (`:72`); malformed lines are skipped silently.
  - Tracks session state across lines: `type:"session"` events replace the session id (`:144`), `type:"model_change"` events set the current model (`:146`) — later assistant messages inherit it.
- `parseAssistantUsage` (`:256`) — only `type:"message"` events with `role:"assistant"` count. Accepts two usage field namings (`input`/`prompt_tokens`, `output`/`completion_tokens`, `totalTokens`/`total_tokens`, `:272-274`); records with `total <= 0` are dropped (`:275`).
- `addAssistantUsage` (`:198`) — folds one record into the `UsageAccumulator`: totals, per-model, per-day, per-(day,model) (key joined with `\u0000`, `:229`), per-UTC-hour, and rolling windows (last hour / last 24 h / previous 24 h for the day-over-day delta, `:237-244`). **Cache semantics**: `cacheRead > 0` counts as a cache *hit*, `cacheWrite > 0` as a *miss* (`:218-225`) — an approximation of prompt-cache hit rate from Anthropic-style usage fields.
- `getUsageFromPiSessions(root?, now?, knownModels?)` (`:294`) — the public entry. `knownModels` filters records to a whitelist (`:342`), but note **no caller passes it**: the route (`usage-routes.ts:61`) invokes the function with all defaults, so the parameter and its cache-key complexity are currently dead weight in production.
- The returned `Omit<UsageStats, "controller">` is **partially synthetic**: session logs contain no latency, TTFT, failure, or weekly data, so `success_rate` is hardcoded 100 (`:376`), all latency/TTFT percentiles are 0 (`:390-391`), and `week_over_week` is zeros (`:413-417`). `by_model` is capped at top-25 by tokens (`:358-360`), peaks at top-5 (`:368-375`).

### `src/modules/system/usage/usage-utilities.ts` (67 lines) — shared usage helpers

- `calcChange(current, previous)` (`:3`) — percent change rounded to 0.1, `null` when `previous` is 0/undefined (avoids ÷0 and meaningless "∞%").
- `emptyResponse()` (`:8`) — a fully-zeroed `Omit<UsageStats, "controller">`. Used as the fallback body by both routes so the frontend always gets a well-shaped payload.

### `src/modules/system/usage-routes.ts` (74 lines) — HTTP endpoints

- `USAGE_CACHE_TTL_MS = 15_000` (`:10`); `usageCache` is a `let` **inside the `defineRoutes` closure** (`:24`) — per-registration mutable state shared across requests, no locking needed because the cache is only written after the aggregate completes (JS single thread + Effect semantics make the read-modify-write benign; a slow aggregate can race with concurrent requests, worst case duplicate work).
- `withControllerUsage` (`:12`) — optionally merges live controller-side stats (`controllerRequestStore.aggregateEffect()`) into the body when `?include_controller=true`. The merge happens *after* the cache read, so the 15 s cache correctly doesn't key on the flag.
- `GET /usage` (`:27`) — serves `inferenceRequestStore.aggregateEffect()` (SQLite aggregation over proxy'd requests), wrapped in `observeControllerFunction` (`:36`) which records duration/success of the call itself into the controller store (`src/core/function-observability.ts:17`). Cached 15 s; on error logs and returns `emptyResponse()` (`:45-48`).
- `GET /usage/pi-sessions` (`:54`) — calls `getUsageFromPiSessions` (defaults only), `null` → `emptyResponse()`, errors → logged + empty response (`:64-69`). Both routes are registered into the system router at `src/modules/system/routes.ts:312`.

---

## 3. How data/control flows

**GPU snapshot flow (metrics tick / `GET /gpus`):**
```
metrics-collector.ts:52 (or routes.ts:108)
  → gpu.ts:222 getGpuInfo
    → gpu.ts:157 collectGpuInfo
      → smi-tools.ts:20 forced? → vendor getter
      → else cascade: gpu.ts:129 nvidia → amd-gpu.ts:206/277 rocm → intel-gpu.ts:134 intel
        → each shells out via core/command.ts:107 runCommandAsyncEffect
          (spawn → boundedTail output caps → SIGTERM/SIGKILL on timeout)
      → gpu.ts:195 darwin/arm64 fallback: synthetic Apple GPU
    → gpu.ts:225 empty? warn-once via console.warn
  → JSON / metrics store
```

**Runtime info flow (`GET /system/runtime`, `GET /compat`):**
```
runtime-info.ts:36 getSystemRuntimeInfo (30 s cache + Semaphore(1) + in-flight fiber dedup, :31-69)
  → runtime-info.ts:79 computeSystemRuntimeInfo
    → Effect.all unbounded (:91): queryNvidiaSmiSnapshot (gpu.ts:109),
      backend specs, getTorchBuildInfo (torch-info.ts:34), getGpuInfo (gpu.ts:222)
    → runtime-info.ts:113 detectPlatformKind (forced → torch_hip → torch_cuda → smi presence → apple)
    → kind==="rocm" ? getRocmInfo (rocm-info.ts:67)
    → probeGpuMonitoring (compatibility-report.ts:31) unless already answered
system/routes.ts:112 GET /compat
  → getSystemRuntimeInfo + TCP port check
  → buildCompatibilityReport (compatibility-report.ts:83) → checks[]
```

**Usage flow (`GET /usage`):**
```
usage-routes.ts:30 effectHandler (runs Effect via ControllerRuntime, http/effect-handler.ts:31)
  → 15 s closure cache hit? → withControllerUsage → ctx.json
  → else observeControllerFunction("usage.aggregateInferenceRequests")
      → stores.inferenceRequestStore.aggregateEffect() (SQLite)
  → usage ?? emptyResponse() → cache → optional controller merge → ctx.json
  → on error: log + emptyResponse()
```

**Pi-sessions flow (`GET /usage/pi-sessions`):**
```
usage-routes.ts:57 → pi-sessions.ts:294 getUsageFromPiSessions
  → 30 s resultCache? return
  → collectJsonlFiles (:74) recursive walk of ~/.pi/agent/sessions
  → per file: parseFileRecords (:105) — mtime/size cache → stream JSONL lines
      → session/model_change state → assistant usage records
  → addAssistantUsage (:198) fold into accumulator
  → shape into UsageStats (synthetic latency/ttft/week fields) → cache → ctx.json
```

---

## 4. Key patterns & idioms

- **Effects as values, errors as data.** Nothing in this slice throws across boundaries (except the intentionally strict parser in `nvidia-compute-processes.ts:33`, immediately caught by `Effect.try`). Most functions return `Effect<A>` with `E = never` and encode failure in the success type: `null`, `[]`, `{available: false}`, or all-null structs (`EMPTY_TORCH`). Only `queryNvidiaComputeGpuUuids` uses a real error channel (`Effect<_, Error>`), because its caller wants to distinguish "no telemetry" from "broken telemetry".
- **`runCommandAsyncEffect` is the universal process boundary** (`src/core/command.ts:107`). Built on `Effect.callback`, it: caps captured output with a ring buffer (`boundedTail`, `command.ts:93`), enforces timeouts with SIGTERM → 5 s grace → SIGKILL → 5 s exit-confirmation (`command.ts:143-167`), and its *canceler* is itself an Effect that terminates the child on interruption (`command.ts:202-214`). Every probe in this slice passes an explicit `timeoutMs` (2–5 s) — a hung vendor tool can never wedge a request.
- **Graceful degradation by construction.** `resolveBinary` returns `string | null` and every caller branches on null instead of catching spawn errors; `runCommandAsyncEffect` itself converts spawn failure into `status: null` rather than failing. Combined, a machine with zero GPU tools still answers every endpoint.
- **Env-var override layer.** `*_SMI_PATH` for binary locations, `LOCAL_STUDIO_GPU_SMI_TOOL` to force the vendor, `LOCAL_STUDIO_ROCM_VERSION_FILE` for the version file, `PI_CODING_AGENT_DIR` for the session root. Detection logic is the default, not the only path.
- **Manual TTL caches over Effect's cache utilities.** Three independent `Map`-plus-timestamp caches: `fileRecordCache` (content-addressed by mtime+size), `resultCache` (30 s), route-level `usageCache` (15 s). Plus `runtime-info.ts`'s more elaborate cache upstream: `Semaphore.makeUnsafe(1)` + a shared in-flight `Fiber` so concurrent requests join one computation instead of stampeding (`runtime-info.ts:31-69`) — worth studying as the "fancy" version of the same idea.
- **Dependency injection by parameter object** (`nvidia-compute-processes.ts:9-21`) — pass `{resolveBinary, execute}` to swap in fakes; default parameter keeps production call-sites clean.
- **Schema-lite validation.** `Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))` (`pi-sessions.ts:72,140`) is used as a cheap "is this a plain object" gate after `JSON.parse`, not for deep validation — deep checks are hand-rolled (`recordValue`, `numberValue`, `textValue`).
- **Resource safety for streams.** `Effect.acquireRelease` + `Stream.scoped` (`pi-sessions.ts:118-133`) guarantees the readline interface and file stream are closed even if the fiber is interrupted mid-file — the idiomatic Effect replacement for try/finally around Node streams.
- **Hono wiring.** `defineRoutes((app, context) => mergeRoutes(...))` captures the shared `AppContext` in a closure; `documentRoute` attaches OpenAPI metadata; `effectHandler` (`src/http/effect-handler.ts:31`) bridges Effect → Promise for Hono, running through the scoped `ControllerRuntime` and rethrowing failures.
- **Self-observability.** `observeControllerFunction` wraps aggregations so the controller records its own function timings into the same store that `include_controller=true` later reads back (`usage-routes.ts:36`, `function-observability.ts:17`).

---

## 5. Connections

**Depends on (outside the slice):**
- `src/core/command.ts` — `runCommandAsyncEffect`, `resolveBinary`, result types. The single most important dependency; read it first.
- `src/modules/models/types.ts:58` — `GpuInfo` (= contracts `GPU` minus `id`, power fields required) and re-exports of all `Runtime*`/`Compatibility*` types from `@local-studio/contracts/system`.
- `src/modules/engines/runtimes/upgrade-config.ts:49,59` — `ROCM_UPGRADE_ENV`, `isUpgradeCommandConfigured` (rocm-info.ts only).
- `@local-studio/contracts/usage` — `UsageStats` shape the usage files must fill.
- `src/app-context.ts` — `AppContext.stores.{inferenceRequestStore, controllerRequestStore}`, `logger`; `usage-routes.ts` reads stores through it.
- `src/http/{route-registrar,effect-handler}.ts`, `src/core/function-observability.ts` — HTTP/Effect plumbing for the routes.

**Depended on by:**
- `src/main.ts:21` — `detectGpuMonitoringTool` at boot.
- `src/modules/engines/runtimes/runtime-info.ts` — heaviest consumer: `getGpuInfo`, `queryNvidiaSmiSnapshot`, `getTorchBuildInfo`, `probeGpuMonitoring`, `getRocmInfo`, `resolveRocmSmiTool`, `resolveNvidiaSmiBinary`.
- `src/modules/system/routes.ts` — `getGpuInfo` (`/gpus`, VRAM fit estimate), `buildCompatibilityReport` (`/compat`), mounts `registerUsageRoutes` (`:312`).
- `src/modules/system/metrics-collector.ts:52` + `metrics-routes.ts:53` — periodic GPU telemetry.
- `src/modules/studio/{routes.ts,rig-detection.ts}` — hardware-aware model fitting and rig detection.
- `src/modules/engines/runtime-routes.ts:213` + `runtimes/runtime-upgrade.ts:65-66` — ROCm info for runtime install/upgrade UI.
- `src/modules/speech/service.ts:356` — `queryNvidiaComputeGpuUuids` to avoid busy GPUs.
- `src/app-context.ts:28,197,217` — `getGpuInfo` re-exposed as `context.gpuInfo`.

**Tests:** none cover this slice. The only nearby test file, `src/modules/engines/runtimes/runtime-info.test.ts`, exercises the upstream cache/platform-kind logic, not these files — despite `amd-gpu.ts` and `nvidia-compute-processes.ts` exporting parser functions clearly shaped for unit tests.

---

## 6. How to read this code

Suggested order, easiest context build-up first:

1. **`src/core/command.ts`** (neighbor, ~50 lines of it) — `CommandResult`, `runCommandAsyncEffect`, `resolveBinary`. Every file in the slice speaks this vocabulary; understanding `status: null` vs non-zero, `exitConfirmed`, and output capping decodes all the error handling.
2. **`smi-tools.ts`** — trivial, but establishes the env-override convention and the `string | null` binary idiom.
3. **`torch-info.ts`** — the smallest complete example of the slice's core pattern: build args → run with timeout → parse tolerantly → return a null-filled struct on any failure.
4. **`amd-gpu.ts`** — the meatiest parsers. Read `parseRocmSmiText` (`:141`) and `parseAmdSmiMetricJson` (`:84`) as pure functions first, then the two `getGpuInfoFrom*` wrappers that feed them.
5. **`gpu.ts`** — now the cascade in `collectGpuInfo` (`:157`) reads as orchestration of things you already know. Pay attention to the forced-tool short-circuit and the Apple fallback.
6. **`intel-gpu.ts`, `rocm-info.ts`, `nvidia-compute-processes.ts`** — independent satellites; read in any order. Note intel's sysfs-realpath trick and nvidia's DI seam.
7. **`compatibility-report.ts`** — pure function over everything above; read alongside `system/routes.ts:112-136` to see it served.
8. **`runtime-info.ts`** (neighbor) — see how the slice is consumed: the 30 s cache + semaphore + in-flight fiber dedup (`:31-69`) and `detectPlatformKind` (`:165`).
9. **`usage-utilities.ts` → `pi-sessions.ts` → `usage-routes.ts`** — the usage half. In `pi-sessions.ts`, read bottom-up: `parseAssistantUsage` (one record) → `addAssistantUsage` (fold) → `parseFileRecords` (streaming + caching) → `getUsageFromPiSessions` (orchestration). Finish at the routes to see the HTTP/cache/observability wrapper.

First things to look for in any new file here: which env vars it honors, what its timeout is, and how it encodes "unavailable" (null, empty, or error channel) — those three choices define each module's contract.
