# Slice walkthrough: `engines/process` + `engines/downloads`

Scope: `src/modules/engines/process/` (7 files), `src/modules/engines/downloads/` (4 files + 2 tests), and the top-level `src/modules/engines/{download-routes,runtime-routes,observed-process}.ts`. All paths below are relative to `/Users/sero/projects/vllm-studio/controller`.

---

## 1. Purpose

This slice is the **operating-system edge** of the controller: everything that touches real child processes, Docker containers, and the filesystem when a model is launched, stopped, or downloaded. `engines/process/` turns a `Recipe` into an argv (host Python or `docker run`), spawns the inference engine, watches its stdout, and knows how to kill the whole process tree (including containers) — even after a controller restart, thanks to an environment-variable ownership marker. `engines/downloads/` downloads model weights from Hugging Face with resume, pause/cancel, backpressure, and a SQLite record of each download. The top-level route files expose downloads and runtime management over HTTP.

---

## 2. File-by-file walkthrough

### `src/modules/engines/process/launch-state.ts` (25 lines)

- Exports `LaunchStateSnapshot`, `LaunchState`, `createLaunchState()` (`launch-state.ts:13`).
- A tiny mutable singleton: one `{ phase: "idle" | "launching", recipeId }` cell guarded by nothing (single-threaded JS makes this fine). It exists so that **route handlers can reject a second concurrent launch** (`lifecycle-routes.ts:26-28`) and so status endpoints can report "currently launching X" (`system/routes.ts:97`, `metrics-collector.ts:67`).
- Note: the writer (`lifecycle-routes.ts:63,84-85`) guards its own `markIdle` with `getLaunchingRecipeId() === recipeId` to avoid clobbering a newer launch's state.

### `src/modules/engines/process/launch-failure-budget.ts` (79 lines)

- Crash-loop circuit breaker. In-memory sliding-window failure counter per recipe: **3 failures in 10 minutes** blocks further launches (`LAUNCH_FAILURE_LIMIT`, `LAUNCH_FAILURE_WINDOW_MS`, `launch-failure-budget.ts:18-19`).
- `createLaunchFailureBudget()` (`:25`) returns a closure-based object; `prune()` (`:31`) evicts timestamps older than the window, `snapshot()` (`:42`) computes `reset_at` as *oldest failure + window*.
- `isBlocked()` (`:59`) returns the snapshot only when blocked; `formatLaunchFailureBudgetMessage()` (`:21`) builds the user-facing error string.
- Consumed by `EngineCoordinator` (`engine-coordinator.ts:183-189` checks before launch, `:204`/`:233` records failures, `:226` resets on ready, `:360` exposes manual reset). Pure in-memory — the budget evaporates on controller restart (intentional: a restart is also a fix opportunity).

### `src/modules/engines/process/model-runtime-defaults.ts` (90 lines)

- Model-name heuristics that pick SGLang/vLLM parser defaults from the model ID string. Lowercases `served_model_name || model_path` (`:10-12`) and substring-matches against hardcoded tag lists (`:5-8`: GLM 4.x/5.x, MiniMax M2, Qwen MoE…).
- `getDefaultReasoningParser()` (`:39`): MiniMax-M2 → `minimax_m2_append_think`, Intellect-3/MiroThinker/Qwen3-thinking → `deepseek_r1`, GLM → `glm45`, plain qwen3 → `qwen3`.
- `getDefaultToolCallParser()` (`:60`): note MiroThinker explicitly gets `undefined` (`:63-65`), GLM5 → `glm47`, Intellect3 → `qwen3_xml`.
- `shouldEnableExpertParallel()` (`:81`): explicit override wins; requires `tensor_parallel_size > 1`; auto-enables only for known MoE models (MiniMax-M2, Qwen MoE).
- Consumed by the engine specs (`specs/vllm-spec.ts:26-30`, `specs/sglang-spec.ts:11`) when building argv, and by the streaming proxy (`modules/proxy/chat-completions-stream.ts:7`) — so the *same* parser decision is made at launch time and at stream-parse time.

### `src/modules/engines/process/backend-builder.ts` (279 lines)

Recipe → argv translation, shared by all engine specs.

- **Extra-argument serialization** (`:33-67`): `appendSerializedArguments` iterates `recipe.extra_args`, skips internal keys (`isInternalRecipeKey` from contracts) and flags already present, converts `snake_case` keys to `--kebab-case` flags. `serializeExtraArgument` (`:47`) handles booleans (`true` → bare flag; `false` → bare flag **except** `enable_expert_parallelism` which is dropped — a quirk of SGLang/vLLM flag semantics), JSON-stringified objects with `-` → `_` key normalization (`normalizeJsonArgument`, `:15`), and strings that *contain* JSON for whitelisted keys (`isJsonStringArgumentKey`).
- `getPythonPath()` (`:69`): recipe's explicit `python_path` if it exists, else `<venv_path>/bin/python` from extra args.
- **Custom launch command** (`getLaunchCommandOverride`, `:138`): reads `launch_command`/`custom_command` from extra args, but **ignores it unless `LOCAL_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND=true`** — this is arbitrary code execution as the controller user, so it's opt-in (comment at `:145-149`). `splitLaunchCommand` (`:93`) is a hand-rolled shell-ish tokenizer (quotes, backslash escapes, `\`-continuations, leading `+` from shell `set -x` traces).
- **Docker helpers**:
  - `DOCKER_ENV_SKIP_KEYS` (`:164`): env keys never forwarded into containers (e.g. `CUDA_VISIBLE_DEVICES` must come from `--gpus`, not `-e`); the comment at `:156-163` explains why `NCCL_GRAPH_FILE` is deliberately *not* skipped (a specific vendor NCCL build treats empty as fatal).
  - `buildDockerGpuFlags()` (`:194`): resolves GPU UUIDs via `resolveRecipeGpuUuids` (from `system/gpu-leases`), emits `--gpus "device=<uuids>"` plus `CUDA_VISIBLE_DEVICES`, or `--gpus all`.
  - `buildDockerRunArguments()` (`:225`): the shared `docker run` shape for every engine — `--rm`, foreground, `--network host`, `--ipc host`, `--shm-size 32g`, memlock/stack ulimits, model path bind-mounted read-only (`:257`), container named `local-studio-<sanitized recipe id>` (`sanitizeDockerName`, `:170`). Foreground is deliberate: the process-manager's stop path (SIGTERM + `--rm`) then works uniformly for host and containerized engines.
- `buildBackendCommand()` (`:266`): the entry point used by the process manager. Custom override wins (but is rejected if the coordinator is managing GPU selection, `:273-275`); otherwise delegates to `getEngineSpec(recipe.backend).buildCommand(recipe, config)`.

### `src/modules/engines/process/process-inventory.ts` (46 lines)

- Wraps `ps -eo pid=,ppid=,pgid=,stat=,args=` into typed `ProcessInventoryEntry` records (`:31-46`), via the injectable `ProcessRunner` from `core/command.ts` (so tests can fake `ps`).
- `splitCommand()` (`:12`) splits the `args` column on whitespace respecting double quotes — used to reconstruct an argv from a ps line.
- Everything here is synchronous and fail-soft: any error or non-zero exit → `[]` (`:43-45`).

### `src/modules/engines/process/process-utilities.ts` (157 lines)

Assorted process/env helpers used by the manager, coordinator, runtimes, and jobs.

- `detectBackend(args)` (`:15`): which engine owns a given argv (via `detectEngineFromArguments` from `engine-spec.ts`).
- `listProcesses()` (`:20`): pid + argv pairs from the inventory.
- `buildEnvironment(recipe, config)` (`:25`): **the env construction for every launch**. Starts from a copy of `process.env`, forces `FLASHINFER_DISABLE_VERSION_CHECK=1` (`:30`), prepends the managed venv's `bin/` to `PATH` when the recipe runtime is `managed_venv` or a path-like `system`/`binary` ref (`resolveVenvBinForRecipe`, `:109`), merges `recipe.env_vars` then extra-args `env_vars` (snake or camel, `:46-54`), and resolves GPU visibility: the recipe's `visible_devices` (five accepted spellings, `:64-69`) is mapped to `CUDA_VISIBLE_DEVICES` and/or `HIP_`/`ROCR_VISIBLE_DEVICES` depending on which vendor tool is available — with `LOCAL_STUDIO_GPU_SMI_TOOL` as a test/debug override (`:77-83`). Unknown platform → sets all three (`:92-96`).
- `pidExists(pid)` (`:126`): `process.kill(pid, 0)`; treats `EPERM` as "exists" (process owned by another user — matters because engines may run under sudo/docker).
- `buildProcessTree()` / `collectChildren()` (`:135-157`): ppid→children map and recursive descendant collection, the basis for tree-kill.

### `src/modules/engines/process/process-manager.ts` (711 lines) — the heart of the slice

Exports the `ProcessManager` interface (`:29-37`) and `makeProcessManager()` (`:705`) which returns an `Effect` building the closure-based implementation (`buildProcessManager`, `:189`). Injected: `Config`, `Logger`, optional `EventManager`, and a `ProcessRunner` (defaults to the real one, fakeable in tests).

**Ownership marker** (`:58-117`): the controller computes `sha256(data_dir + "\0" + inference_port)[:32]` (`ownershipMarkerFor`, `:79`) and stamps it into every launch: as an env var for host processes and as `docker run --env LOCAL_STUDIO_ENGINE_OWNER=...` inserted into the argv (`commandWithOwnershipMarker`, `:85` — note it splices into the middle of the command). This lets a *restarted* controller find and reap processes its previous incarnation spawned: `markedProcessInventory` (`:95`) reads `/proc/<pid>/environ` on Linux, or greps `ps eww` output elsewhere; `markedDockerContainerNames` (`:127`) inspects each running container's env. Zombie processes (`stat` contains `Z`) are excluded at `:96`.

**Resource tracking** (`LaunchResources`, `:43-56`): per launched child — the spawn handle, pid set, docker container name, an Effect `Queue<string | null>` of log lines, readline interfaces, log file stream, listeners, and the fiber draining the queue. `activeResources` (`:196`) is the registry; `releaseResources` (`:227`) is idempotent (the `released` flag) and closes readers, shuts down the queue, and closes the log stream via `Effect.callback` (`closeLogStream`, `:200`).

**`launchModel()`** (`:447-652`) — the main flow:
1. Rewrite the recipe with the controller's `inference_port` and optional GPU UUIDs (`recipeForLaunch`, `:60` — injects both `env_vars.CUDA_VISIBLE_DEVICES` and `extra_args.visible_devices`).
2. Build argv (`:457`); failures return a structured `LaunchResult` instead of throwing.
3. **`cleanupMarkedOwnedProcesses()` first** (`:476`): before launching anything new, kill all processes/containers still wearing our ownership marker; refuse to launch if they won't die (`:477-483`). This is the "single engine at a time" enforcement that survives restarts.
4. Re-stamp the marker into the command (`:484`), pre-remove a stale same-named container (`:485`), rotate logs excluding the file we're about to open (`:488-491`), build env + marker (`:492-493`).
5. `runner.spawnDetached(entry, args, { env, stdio: "pipe" })` (`:507`) — detached so the engine forms its own process group and `unref()`ed (`:591`) so it doesn't hold the controller's event loop open.
6. Log pipeline (`:520-589`): readline on stdout+stderr → `captureLine` (`:563`) → ring buffer of last 60 lines (for crash messages), append to the log file, and offer into a sliding queue of 256 (`:521` — backpressure policy: drop oldest). A detached fiber (`:553-562`) drains the queue into `eventManager.publishLogLine` for SSE; it exits when it takes `null` (offered on child exit, `:526-528`). The fiber is forked with `Effect.ensuring(releaseResources(...))` so resource cleanup is tied to fiber termination.
7. Wait 3 s (`:593`): spawn error → kill and fail; **early exit** → join the log fiber, include the last ~20 non-empty output lines in the failure message (`:607-613`), publish an SSE error event, kill, fail. Otherwise success with `{ pid, log_file }`.
8. `Effect.onExit` at `:642`: if the launch effect is **interrupted** (e.g. the coordinator's switch lock was preempted), the just-spawned process is killed rather than orphaned.

**`killProcessEffect()`** (`:288-366`) — graceful-then-force tree kill with two ownership modes:
- "owned" (controller-spawned) vs "observed" (a foreign process found by port scanning). Resolved at `:294-295` — a pid present in `ownedProcessGroups` is always treated as owned.
- Collects the target's process-group members (`processGroupMembers`, `:146`), the tracked owned pids, and the full ppid-tree (`:318-322`), feeds the expanded set back into `resources.ownedPids` (`:323-325`).
- Stops associated Docker containers *first* (`:327`; names discovered from tracked state, argv `--name`, or Linux cgroups — `dockerContainerNameForPid`, `:160`), then SIGTERM (or SIGKILL when `force`) to every pid (`:329-332`), polls every 250 ms up to 10/15 s (`:336-342`), escalates to SIGKILL + `docker kill` with a 5 s deadline (`:344-356`), and releases log resources once stopped (`:360-364`).
- `sendSignal` (`:411`) falls back to `sudo -n kill` when `kill()` throws (EPERM); `runDockerCommand` (`:119`) similarly falls back to `sudo -n docker`.

**Other surface**: `findInferenceProcess(port)` (`:260`) scans the process inventory for any argv that looks like an engine bound to the port (the `--port` flag, with the vLLM-default-8000 special case at `:271`), extracting model path/name via the engine spec. `shutdown()` (`:654`) kills every owned pid and interrupts every log fiber. `confirmOwnedProcessStopped` (`:676`) is used by the coordinator's liveness monitor.

### `src/modules/engines/downloads/huggingface-api.ts` (140 lines)

- `FetchEffect` type (`:20`): an injectable fetch returning `Effect<Response, EngineOperationError>`. `fetchEffect` (`:31`) wraps global `fetch` in `Effect.tryPromise` and **marries the Effect interruption signal with any caller-provided `AbortSignal`** via `AbortSignal.any` (`:36`) — this is what makes pause/cancel interrupt an in-flight HTTP read.
- `fetchHuggingFaceModelInfo()` (`:56`): GETs `https://huggingface.co/api/models/<id>?blobs=true`, optional `revision` and bearer token, decodes the response through an Effect `Schema` (`:41-52`) — only `modelId`, `sha`, and `siblings[].rfilename/size` are kept.
- `buildHuggingFaceFileList()` (`:91`): filters siblings by allow/ignore globs (`compileGlob`, `:7` — only `*` supported, case-insensitive). The interesting business rule (`:97-118`): with **no** allow patterns, if the repo contains more than one GGUF "family" (shard suffixes `-00001-of-00002` normalized away, `mmproj`/projector/adapter/draft files excluded), it **throws** and forces the user to pick one — a 200 GB accidental multi-variant download is refused up front.

### `src/modules/engines/downloads/download-store.ts` (139 lines)

- SQLite persistence for downloads: one table `model_downloads(id, data JSON, created_at, updated_at)` (`:69-76`), whole record serialized as JSON (`save`, `:114` — upsert via `ON CONFLICT(id) DO UPDATE`).
- `ModelDownloadSchema` (`:13-28`) validates the JSON blob on read (`decodeDownload`, `:42`); note the **fail-soft reads**: `list()` decodes each row with `Effect.option` and silently drops corrupt rows (`:92-96`), and `get()` catches decode failures to `null` (`:110`).
- `make()` (`:54`) migrates on open and closes the DB if migration fails (`:60-63`). Opened once in `app-context.ts:145` and closed on scope release.

### `src/modules/engines/downloads/stream-backpressure.ts` (45 lines)

Two tiny adapters between Node stream events and Effect:
- `waitForWriterDrain(writer)` (`:12`): `Effect.callback` that resumes on `drain`, fails on `error`, and unregisters listeners as its cancellation finalizer (returned `Effect.sync(cleanup)`).
- `trackWriterFailure(writer)` (`:31`): attaches a persistent `error` listener and returns `{ dispose, throwIfFailed }` — because a write-stream error can surface *between* `write()` and `drain`, the download loop polls `throwIfFailed()` before and after every read/write.

### `src/modules/engines/downloads/download-manager.ts` (649 lines)

The orchestrator. Class with private constructor; `DownloadManager.make()` (`:164`) runs `rehydrate()` (`:178`) — any download left in `downloading`/`queued` by a previous process is flipped to `paused` with `"Restart required"`, since in-flight HTTP streams don't survive restarts.

- **Start** (`start`, `:201`): validates `model_id`, merges default ignore filenames (`.gitattributes`, `.gitignore` from `configs.ts:11`), resolves the target directory with **path-traversal protection** (`resolveDownloadRoot`, `:76` — sanitizes each segment, rejects anything escaping `models_dir`), checks the models dir is writable with a settings-hint error message (`:258-273`), fetches HF metadata, builds the file list (fails if empty), and then **dedupes**: `findReusableDownload` (`:48`) returns an existing record with the same model+dir+exact file set, preferring completed > active > paused. Only otherwise does it insert a new `queued` record and `launchRun()` (`:346`), which forks the download into a detached fiber tracked in `active: Map<id, { AbortController, fiber }>` (`:154`).
- **Pause/resume/cancel** (`:275-317`): mutate status in the store first, then abort the controller + interrupt the fiber. Resume just re-queues and forks a new run; per-file byte state makes it actually resumable.
- **`runDownload()`** (`:365-443`): per-download loop. Ownership check (`stillOwner`, `:375`) guards every mutation so a stale fiber can't overwrite a newer run's state. Iterates files sequentially, skipping completed ones, then finalizes: all complete → `completed`, else `failed`. The `Effect.catch` at `:407` distinguishes *aborted* (leave paused/canceled, don't log) from *failed* (record `error.message`, log). `Effect.ensuring` at `:426` and `:437` both remove the active entry — belt and suspenders.
- **`downloadFile()`** (`:445-586`): the resumable single-file download:
  - Downloads to `<path>.part`, renames on completion (`:455`, `:581`) so a final file is always whole.
  - If the final file already exists at full size → mark complete, skip (`:462-467`). If a `.part` exists → send `Range: bytes=N-` (`:473`).
  - HTTP 416 handling (`:479-490`): if the partial is already complete, just rename; else fail.
  - If the server answers 200 to a ranged request (no resume support) → restart the file from zero (`:499-506`).
  - The copy loop (`:520-567`): `reader.read()` → `writer.write()`; if `write()` returns false, `waitForWriterDrain` applies backpressure; `writerFailure.throwIfFailed()` is polled around every step. Progress is persisted and published at most every `DOWNLOAD_PROGRESS_THROTTLE_MS = 750` ms (`configs.ts:12`; check at `:545`).
  - The reader is wrapped in `Effect.acquireUseRelease` (`:520`) whose release cancels the stream and releases the lock; the writer is closed in `Effect.onExit` (`:568-572`) so every exit path (done, error, interruption) closes the file descriptor.
  - Short read (server closed early) → `error` status + failure (`:574-580`).
- **Persistence granularity**: `persistFileUpdate` (`:588`) re-reads the record from the store, replaces one file entry, recomputes `downloaded_bytes`/`total_bytes` (`sumDownloadedBytes`/`sumTotalBytes`, `:29-37` — total is `null` until every file size is known), and saves. Events: `DOWNLOAD_PROGRESS` (per file) and `DOWNLOAD_STATE` (per status change) over the shared `EventManager` (`:610-648`).
- **Schemas**: `DownloadRequestSchema`/`DownloadTokenSchema` (`:89-100`) live here and are imported by the routes — note `hf_token` is an *optional per-request* field, never stored on the download record.

### `src/modules/engines/download-routes.ts` (97 lines)

Thin Hono layer over `DownloadManager`: `GET/POST /studio/downloads`, `GET /studio/downloads/:id`, `POST .../pause|resume|cancel`. Each handler is `effectHandler((ctx) => ...)` — the Hono handler runs the returned Effect on the controller runtime (`http/effect-handler.ts:31`), so typed failures like `EngineOperationError` or `notFound()` propagate to HTTP error responses. Bodies are validated with `decodeJsonBody(ctx, Schema)`. Token resolution (`resolveHfToken`, `:8`): body > `x-hf-token`/`x-huggingface-token` header > `LOCAL_STUDIO_HF_TOKEN`/`HF_TOKEN`/`HUGGINGFACE_TOKEN` env.

### `src/modules/engines/runtime-routes.ts` (240 lines)

Runtime (engine installation) management endpoints — the slice's read/write surface for "which vLLM/SGLang/llama.cpp/MLX is installed":
- `GET /runtime/targets` + `POST /runtime/targets/:targetId/select` (`:62-90`): enumerate/select runtime targets (delegates to `runtimes/runtime-targets`).
- Engine jobs (`/runtime/jobs*`, `:92-142`): create/list/get/cancel background install/update jobs via `runtimes/engine-jobs`. The body schema (`:35-43`) explicitly declares `command` and `args` as `Schema.Never` — **a request can never inject an arbitrary command** into an engine job; jobs are constructed only from typed backend/type/version fields.
- Info endpoints (`:144-215`): `/runtime/vllm`, `/runtime/vllm/config`, `/runtime/llamacpp[/config]`, `/runtime/sglang`, `/runtime/mlx`, `/runtime/cuda`, `/runtime/rocm` — each delegates to a spec/runtime module, most needing the currently observed process.
- `POST /runtime/:backend/upgrade` (`:217-238`): validates the backend against `RUNTIME_JOB_BACKENDS` (`:24`) and creates an `update` job.
- Almost every route starts with `getObservedProcess("<route label>")` — see next file.

### `src/modules/engines/observed-process.ts` (11 lines)

- `createGetObservedProcess(context)` (`:4`) returns `(label) => Effect`: calls `engineService.getCurrentProcess()` wrapped in `observeControllerFunction` (`core/function-observability.ts:17`), which times the call and records success/failure into `controllerRequestStore` for the observability UI. The per-route label (e.g. `runtime.jobs.getCurrentProcess`) is what makes slow `ps` scans attributable in the metrics.

### Tests (one-line note)

`downloads/download-manager.test.ts` covers `findReusableDownload` preference order and GGUF-variant non-reuse; `downloads/huggingface-api.test.ts` covers the multi-GGUF-family rejection and shard/allow-pattern selection in `buildHuggingFaceFileList`. No tests in `process/` — process-manager relies on the injectable `ProcessRunner` seam being exercised elsewhere.

---

## 3. How data/control flows

**Model launch** (the write path):

```
POST /studio/lifecycle/... (lifecycle-routes.ts, out of scope)
  → launchState.markLaunching(recipeId)                      [launch-state.ts:18]
  → EngineCoordinator.setActiveRecipe(recipe)                [engine-coordinator.ts:70]
      semaphore-guarded, intent-serial preempted
    → launchFailureBudget.isBlocked(recipeId)                [launch-failure-budget.ts:59]
    → processManager.launchModel(recipe, { gpuUuids })       [process-manager.ts:447]
        buildBackendCommand(recipe, config)                  [backend-builder.ts:266]
          → custom override? OR getEngineSpec(backend).buildCommand  [engine-spec.ts:54]
        cleanupMarkedOwnedProcesses()                        [process-manager.ts:424]
        spawnDetached(entry, args, { env, stdio: "pipe" })   [process-manager.ts:507]
        stdout/stderr → captureLine → log file + Queue(256)  [process-manager.ts:563]
          → fiber → eventManager.publishLogLine (SSE)        [process-manager.ts:557]
        sleep 3s → early-exit? fail with log tail            [process-manager.ts:604]
    → waitForReady: poll engine /health every 2s             [engine-coordinator.ts:290]
      → ready: budget.reset(recipeId)                        [engine-coordinator.ts:226]
      → crash/timeout: killOwnedProcess + budget.recordFailure
```

**Model stop/evict**: coordinator finds the running process (`findInferenceProcess(port)`, `process-manager.ts:260`), maps it back to a recipe, then `killProcess(pid, force)` (`:288`) → docker stop → SIGTERM tree → poll → SIGKILL escalation → resource release → `confirmInferenceStopped` before the GPU lease is released (`engine-coordinator.ts:492-504`).

**Download**:

```
POST /studio/downloads { model_id, ... }            [download-routes.ts:47]
  → decodeJsonBody(DownloadRequestSchema)           [download-manager.ts:89]
  → downloadManager.start(request)                  [download-manager.ts:201]
      resolveDownloadRoot (traversal-safe)          [:76]
      fetchHuggingFaceModelInfo → file list         [huggingface-api.ts:56,91]
      findReusableDownload? return existing         [:48]
      store.save(queued) → launchRun → forkDetach   [:346]
        runDownload fiber:                          [:365]
          per file: Range-resume fetch → .part      [:445]
          stream loop w/ drain backpressure,        [:520]
          throttled store.save + SSE progress (750ms)
          rename .part → final                      [:581]
          finalize: completed | failed | (aborted → paused/canceled)
  ← SSE: DOWNLOAD_PROGRESS / DOWNLOAD_STATE events  [:610-648]
  pause/resume/cancel: POST endpoints → abort + fiber interrupt
```

**Runtime info**: `GET /runtime/*` → `createGetObservedProcess(context)(label)` (`observed-process.ts:4`) → `engineService.getCurrentProcess()` (instrumented) → target/job/info module → JSON.

---

## 4. Key patterns & idioms

- **Effect without services/layers**: this codebase uses Effect as a *structured concurrency + typed error* tool, not DI. Dependencies are plain constructor parameters (`buildProcessManager(config, logger, eventManager, runner)`); errors flow through the `E` channel as `EngineOperationError` (a `Schema.TaggedErrorClass`, `engine-spec.ts:41`). Almost everything is `Effect.gen(function* () { ... yield* ... })`.
- **`Effect.try` / `Effect.tryPromise` wrapping**: the local `attempt()` helper (duplicated in `download-manager.ts:117` and `download-store.ts:36`) tags every synchronous throw with an operation name, so error messages read like `"open-download-writer: EACCES ..."`.
- **Node events ↔ Effect**: `Effect.callback` is the bridge (`closeLogStream` process-manager.ts:200, `waitForWriterDrain`, `closeWriter`). Always return a cleanup `Effect.sync` that removes listeners — that's Effect's cancellation finalizer.
- **Resource safety without `acquireRelease` scopes**: this slice prefers manual idempotent release (`released` flag, `releaseResources` at process-manager.ts:227) tied to fiber lifecycles via `Effect.ensuring`, because resources are owned by long-lived detached fibers rather than a lexical scope. Compare `Effect.acquireUseRelease` used where the scope *is* lexical (download stream reader, download-manager.ts:520).
- **Detached fibers + explicit registries**: `Effect.forkDetach` for log drainers (process-manager.ts:562) and download runs (download-manager.ts:352), each registered in a `Set`/`Map` so `shutdown()` can interrupt them. Ownership re-check (`stillOwner`) before every store write avoids stale-fiber writes.
- **Backpressure via sliding queue + writer drain**: log lines use `Queue.sliding(256)` (drop-oldest; log streaming must never block the engine); file downloads use honest backpressure (wait for `drain`).
- **`Queue.offerUnsafe` / `Semaphore.makeUnsafe`**: escape hatches from callback-land (Node event handlers) into Effect primitives.
- **Fail-soft OS probing**: every `ps`/`docker`/environ read returns `[]`/`null` on error — process detection must never crash the controller.
- **Schema-at-the-boundary**: HTTP bodies (`DownloadRequestSchema`) and DB blobs (`ModelDownloadSchema`) are decoded with Effect Schema; internal code then trusts the types.
- **Security guardrails worth noticing**: custom launch commands are env-gated (`backend-builder.ts:148`), download destinations are traversal-checked (`download-manager.ts:76-87`), engine-job bodies forbid `command`/`args` (`runtime-routes.ts:41-42`), model paths are mounted read-only into containers (`backend-builder.ts:257`), and HF tokens are per-request (never persisted).
- **Sudo fallbacks**: `runDockerCommand` (process-manager.ts:119) and `sendSignal` (`:411`) retry with `sudo -n` — non-interactive; fails cleanly if no sudoers rule.

---

## 5. Connections

**Depends on (incoming imports):**
- `core/command.ts` — `ProcessRunner`/`SpawnedProcess`/`realProcessRunner`, the test seam for all OS process interaction.
- `core/log-files.ts` — `primaryLogPathFor`, `cleanupLogFiles`, cleanup defaults.
- `core/logger.ts`, `system/event-manager.ts` — logging and SSE event bus (`Event`, `CONTROLLER_EVENTS`).
- `engine-spec.ts` + `specs/*` — per-backend `buildCommand`, `detectInvocation`, `extractModelPath`, health paths; `EngineOperationError` defined there and used everywhere here.
- `argument-utilities.ts` — `extractFlag`, `getExtraArgument` (exists specifically to break an engine-spec ↔ process-utilities import cycle).
- `system/gpu-leases.ts` — `resolveRecipeGpuUuids` for `--gpus` flags.
- `runtimes/managed-venv.ts` — `isManagedPythonBackend`, `managedVenvPython` for PATH construction.
- `stores/sqlite.ts` — `openSqliteDatabase` for the download store.
- `config/env.ts` (`Config`), `models/types.ts` (`Recipe`, `LaunchResult`, `ProcessInfo`), `@local-studio/contracts` (`isInternalRecipeKey`, `isJsonStringArgumentKey`, event names, shared DTO types).
- `http/effect-handler.ts`, `http/route-registrar.ts`, `core/validation.ts`, `core/errors.ts`, `core/function-observability.ts` — the Hono/Effect plumbing for the route files.

**Depended on by (outgoing):**
- `engine-coordinator.ts` — the sole consumer of `ProcessManager.launchModel/kill*/findInferenceProcess`, `LaunchFailureBudget`, `pidExists`; orchestrates launch/evict/leases.
- `app-context.ts:177-207` — wires `createLaunchState`, `createLaunchFailureBudget`, `makeProcessManager`, `DownloadStore.make`, `DownloadManager.make` into the scoped boot, with `download-manager.shutdown`/`download-store.close` releases.
- `lifecycle-routes.ts`, `system/routes.ts`, `metrics-collector.ts`, `recipe-routes.ts` — read `launchState`.
- `specs/vllm-spec.ts`, `sglang-spec.ts`, `llamacpp-spec.ts`, `mlx-spec.ts` — import `buildDockerRunArguments`, `appendExtraArguments`, `getPythonPath`, `sanitizeDockerName`, and the `model-runtime-defaults` parser pickers.
- `runtimes/runtime-targets.ts`, `runtimes/engine-jobs.ts`, `runtimes/install-lock.ts` — `listProcesses`/`detectBackend`/`pidExists`.
- `proxy/chat-completions-stream.ts` — `getDefaultReasoningParser`.
- `routes.ts:4-5` — mounts `registerDownloadRoutes` and `registerRuntimeRoutes` into the engine route tree.

---

## 6. How to read this code

Suggested order for a newcomer:

1. **`launch-state.ts` + `launch-failure-budget.ts`** (100 lines total) — two tiny state machines; learn the closure-based module pattern and the crash-loop policy.
2. **`engine-spec.ts`** (neighbor, 87 lines) — understand the `EngineSpec` interface and `EngineOperationError`; everything else talks to these.
3. **`process-inventory.ts` → `process-utilities.ts`** — the OS probing layer; note the injectable `ProcessRunner` and fail-soft returns.
4. **`backend-builder.ts`** — read `buildBackendCommand` first (`:266`), then drill into serialization and Docker helpers as needed.
5. **`process-manager.ts`** — read the `ProcessManager` interface (`:29`), then `launchModel` (`:447`) top to bottom, then `killProcessEffect` (`:288`), then the ownership-marker helpers (`:58-187`). Keep `LaunchResources` (`:43`) open in a split — every cleanup path refers to it.
6. **`engine-coordinator.ts`** (neighbor) — see *why* the manager's API looks the way it does: budget checks, GPU leases, readiness polling, liveness monitor.
7. **Downloads, inside out**: `stream-backpressure.ts` (45 lines) → `huggingface-api.ts` → `download-store.ts` → `download-manager.ts` (`start` → `launchRun` → `runDownload` → `downloadFile`, in that order) → `download-routes.ts`.
8. **`observed-process.ts` + `runtime-routes.ts`** last — they're thin once you know `getCurrentProcess` and the jobs module.

First things to anchor on: the ownership marker mechanism (process-manager.ts:79) — it's the key to the whole restart-safety design — and `Effect.gen`/`yield*` fluency, since every function in the slice is written in that style.
