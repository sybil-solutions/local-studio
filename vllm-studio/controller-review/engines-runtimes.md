# Code Walkthrough: `src/modules/engines/runtimes/` — engines runtimes slice

Scope: `/Users/sero/projects/vllm-studio/controller/src/modules/engines/runtimes/`
(13 source files + 2 test files, ~2,390 lines total)

---

## 1. Purpose

This slice is the **runtime discovery, installation, and upgrade subsystem** for the four
inference backends (vLLM, SGLang, llama.cpp, MLX). It answers three questions for the rest of
the controller: (1) *what runtimes exist on this machine* — scanning running processes, venvs,
system Pythons, Docker images, and bundled wheels into a unified `RuntimeTarget[]` list;
(2) *how do I install or upgrade one* — via an in-memory job registry (`EngineJob`) that forks
background Effect fibers, serializes installs per-backend with a file lock, and reports
progress; and (3) *what platform am I on* — CUDA/ROCm/Metal detection, GPU/torch/driver info,
cached and single-flighted for HTTP and metrics consumers.

---

## 2. File-by-file walkthrough

### `engine-jobs.ts` (340 lines) — the job registry and runner

The operational heart of the slice. Maintains three module-level maps
(`engine-jobs.ts:42-44`): `jobs` (id → `EngineJob` record), `jobChildren` (id → spawned
`ChildProcess`, so a job can be killed), and `jobRuns` (id → running `Fiber`).

- `createEngineJob` (`engine-jobs.ts:258`) — the public entry point. Builds a queued job record
  (`createJobRecord`, `:56`), prunes old finished jobs, then **forks the job body as a detached
  fiber** via `Effect.forkDetach({ startImmediately: true })` (`:275`) and returns the job
  record immediately. The HTTP caller gets a job id back synchronously and polls for progress.
  `Effect.ensuring` (`:269`) guarantees the fiber/child bookkeeping is cleaned up when the fiber
  ends for any reason.
- `runJob` (`engine-jobs.ts:154`) — the job body. Flow: flip `queued → running` → resolve the
  `RuntimeTarget` if a `targetId` was given (`getRuntimeTarget`, failing with
  `EngineOperationError` if missing or if `!target.capabilities.canUpdate` for non-inspect jobs,
  `:178`) → for backend `vllm` with no explicit target, fall back to `getDefaultRuntimeTarget`
  (`:187`, asymmetric vs sglang/mlx which proceed with `target = null` → managed venv) → run
  either `runPlatformUpgrade` (cuda/rocm) or `runEngineInstall` → map the
  `RuntimeUpgradeResult` onto the job record (status `success`/`error`, `outputTail` capped at
  4,000 chars by `tailOutput`, `:46`). The whole body is wrapped in `Effect.catch` (`:224`) that
  converts any typed or untyped failure into an `error`-status job update — jobs never propagate
  errors to the caller after forking.
- `runEngineInstall` (`engine-jobs.ts:112`) — acquires the per-backend install lock
  (`acquireEngineInstallLock`), with two callbacks wired into the lock: `onWait` updates the job
  message to "waiting for in-progress install…", and `shouldContinue` aborts the wait if the job
  was cancelled. The lock is then held across the actual install via
  `Effect.acquireUseRelease` (`:130`) — acquire/succeed, use (`getEngineSpec(backend).install(...)`),
  release (`heldLock.release()` + drop child handle). Inside `use`, progress and spawn events are
  bridged back into the job record via `onProgress`/`onSpawn` callbacks (`:140-143`) — this is
  how the long-running `uv`/`pip` child becomes killable by job id.
- `cancelEngineJob` (`engine-jobs.ts:313`) — marks the job `cancelled`, then
  `terminateJobChild` (`:285`) does a graceful-then-hard kill: SIGTERM, poll every 100 ms for up
  to 2 s, then SIGKILL, poll another 2 s (`pidExists` guards against PID reuse), then
  `Fiber.interrupt` the run fiber. Note the interplay with `updateRunningJob` (`:75`), which
  only mutates jobs still in `running` status — once cancelled, the fiber's later completion
  updates become no-ops, so a cancelled job can never flip back to success.
- Housekeeping: `pruneFinishedJobs` (`:241`) keeps at most `MAX_FINISHED_JOBS = 50` finished
  jobs, evicting oldest by `startedAt`. `shutdownEngineJobs` (`:335`) cancels all
  queued/running jobs; called from `app-context.ts` on shutdown.
- Notable: jobs are **purely in-memory** — a controller restart loses all job history. Also,
  platform backends (`cuda`/`rocm`) are recorded with `backend: "vllm"` in the job record
  (`:58`) because `EngineJob.backend` is typed as `EngineBackend`.

### `runtime-targets.ts` (539 lines) — runtime discovery and selection

Builds the unified `RuntimeTarget[]` list shown in the UI. Everything funnels into
`getRuntimeTargets` (`:447`), which is cached for `TARGET_CACHE_TTL_MS = 300_000` ms (`:36`),
keyed by `config.data_dir`.

- Collectors (all produce `RuntimeTarget` via `makeRuntimeTarget` and merge with `addTarget`):
  - `collectRunningTargets` (`:89`) — scans live processes (`listProcesses`), classifies args
    with `detectBackend`, extracts the python/binary path from the command line
    (`parseCommandPython`/`parseCommandBinary`), marks the currently-served process `active`.
  - `collectPythonTargets` (`:160`) — for vllm/sglang/mlx: merges (a) running targets,
    (b) *configured* candidates from config fields and env vars
    (`LOCAL_STUDIO_RUNTIME_PYTHON`, `LOCAL_STUDIO_VLLM_PYTHONS`, etc., `:172-184`),
    (c) *discovered* venvs by scanning well-known roots (`collectVenvPythonFiles`, `:118` —
    cwd `runtime/venvs`, `venvs`, `.venv`, data-dir equivalents, `/opt/venvs`),
    (d) system `python3`/`python`, (e) a system CLI binary if the engine spec declares one.
    Each candidate is probed with `probePythonRuntime`; probing runs with
    `concurrency: "unbounded"` (`probePythonCandidates`, `:149`).
  - `collectLlamacppTargets` (`:279`) — analogous, but binary-based: configured `llama_bin`,
    the managed build output (`managedLlamaServerPath`), and system `llama-server`.
  - `collectDockerTargets` (`:334`) — runs `docker images` and `docker ps` (3 s timeouts) and
    regex-matches image names per backend (`:340-345`); skippable with
    `LOCAL_STUDIO_RUNTIME_SKIP_DOCKER=1`.
  - `collectBundledTargets` (`:396`) — vLLM only: `vllm-*.whl` files under `runtime/wheels`,
    version parsed from the filename.
- `addTarget` (`:68`) — dedup/merge by target id. When two sources yield the same id, fields
  merge with a source priority (`running > configured > bundled > discovered`, `:61`): the
  higher-priority source keeps its `label`/`source`, while `active`, `installed`, `version`,
  and an `ok` health status are OR-ed/preferred across both.
- `withSelection` (`:426`) — overlays the user's persisted selection
  (`selected_runtime_target_ids` in persisted config) onto `active`.
- `sortTargets` (`:435`) — backend order (vllm, sglang, llamacpp, mlx), then active, installed,
  semver-descending (`compareVersions`), then label.
- Public API: `getRuntimeTargets` (`:447`), `getRuntimeTarget` (`:484`, find by id),
  `selectRuntimeTarget` (`:493`, persists choice and **busts the cache**, `:508`),
  `getDefaultRuntimeTarget` (`:512`, active → newest installed → configured → first),
  `runtimeTargetToBackendInfo` (`:533`, adapter to the legacy `RuntimeBackendInfo` shape).
- `clearRuntimeTargetsCache` (`:47`) is called by `engine-jobs.ts` after any successful/failed
  install or update so the next listing re-probes.

### `runtime-target-probes.ts` (273 lines) — the probing toolkit

Pure(ish) utilities that turn "a path" into "what is installed there".

- `probePythonRuntime` (`:81`) — two-stage probe: `python --version` (2 s) to check
  runnability, then `python -c <probe>` where the probe is a small inline Python script
  (`PYTHON_VERSION_PROBES`, `:18-23`) that imports the backend package and prints
  `{"version": ..., "python": sys.executable}` as JSON. The JSON is validated with an Effect
  `Schema.Struct` (`:25`, decoded at `:109`) — a good example of `Schema.decodeUnknownSync`
  used as a parser guard. Failures degrade gracefully: not runnable → not installed →
  unparseable, each with a human `message`.
- `probeBackendRuntime` (`:130`) — tries a list of candidate Pythons in order; returns the
  first installed probe, else the first runnable one (so the UI can still show "python exists
  but vllm not installed"), else a synthetic failure.
- `parseCommandPython` (`:51`) — reverse-engineers the interpreter from a process arg vector:
  either argv[0] looks like python, or it finds `-m vllm.entrypoints.openai.api_server` /
  `sglang.launch_server` / `mlx_lm.server` and walks back two tokens. Used to attribute running
  processes to venvs. `parseCommandBinary` (`:67`) is the trivial binary variant.
- `resolvePythonFromScript` (`:187`) — reads the shebang of an entry-point script (handles
  `#!/path/to/python` and `#!/usr/bin/env python3`) to map a `vllm` CLI back to its venv
  interpreter.
- `probeBinaryRuntime` (`:205`) — for llama-server: `--version`, fallback `--help`; version
  parsed by `parseLlamaVersion` (`:167`, regex over "version: …" else first line).
- `probeVllmBinaryRuntime` (`:240`) — vLLM CLI variant; adds shebang-derived `pythonPath` and
  `parsePackageVersion` (`:172`, generic semver-ish regex).
- `compareVersions` (`:177`) — null-safe semver comparison via `semver.coerce`/`compare`,
  falling back to lexicographic for unparseable strings. Drives all "newest first" sorting.
- `normalizePackageSpec` (`:10`) — turns a version hint into `name==version`, passing through
  specs that already contain `==` or end in `.whl`.
- `splitEnvironmentList` (`:43`) — comma-separated env list parser.
- `probeRunningProcessPython` (`:156`) — `ps -p <pid> -o args=` → `parseCommandPython`; used by
  the sglang/mlx specs (outside this slice) to identify a live server's interpreter.

### `runtime-target-factory.ts` (144 lines) — `RuntimeTarget` construction

Single export `makeRuntimeTarget` (`:101`) plus helpers. This is where raw probe data becomes
the contract type shared with the frontend.

- `targetId` (`:18`) — deterministic id: `${backend}:${kind}:${base64url(key)}` where `key` is
  the python path / binary path / docker image. Determinism matters: the frontend persists
  selected ids, and `addTarget` dedups on them.
- `createCapabilities` (`:21`) — the capability matrix. `canUpdate` is the interesting one:
  vLLM/SGLang/MLX can only be updated **in a venv** (never a system Python), SGLang and
  llama.cpp additionally allow updates when an env override command is configured
  (`isUpgradeCommandConfigured`). `canInspectOptions` excludes sglang/mlx.
- `createHealth` (`:46`) — `installed → "ok"`, running source always `ok`, otherwise `warning`
  with the probe message.
- `updateMetadata` (`:71`) — builds the `update` block the UI shows (current vs target version,
  package spec, release-notes URL per backend `:57`, human-readable `changes` list, and a hint
  to set `LOCAL_STUDIO_VLLM_UPGRADE_VERSION` when unpinned).

### `install-lock.ts` (125 lines) — per-backend install serialization

A PID-tracked file lock at `$data_dir/runtime/locks/<backend>.install.lock` (`:28`).

- `tryAcquireInstallLock` (`:59`) — atomic create via `writeFileSync(..., { flag: "wx" })`
  (fails with EEXIST if held). On contention, `isStaleLock` (`:42`) reads the lock file,
  Schema-validates `{ pid }`, and considers it stale if unreadable, malformed, or the recorded
  PID no longer exists (`pidExists`); stale locks are deleted and creation retried once (a
  second EEXIST loses the race and returns null — correct under concurrency).
- `acquireEngineInstallLock` (`:114`) — poll loop (`:91`): try, sleep `pollMs` (default 3 s),
  repeat until `timeoutMs` (default `ENGINE_INSTALL_TIMEOUT_MS` = 30 min). `onWait` fires once
  (so the job message doesn't spam), `shouldContinue` lets a cancelled job bail out of the wait
  early. Returns `null` on timeout/abort rather than failing — callers map null to a typed
  result (`installLockFailure` in engine-jobs).
- `installLockTimeoutMessage` (`:121`) — shared user-facing timeout text.

### `runtime-upgrade.ts` (75 lines) — CUDA/ROCm platform upgrades

- `runPlatformUpgrade` (`:25`) — looks up the operator-provided shell command
  (`LOCAL_STUDIO_CUDA_UPGRADE_CMD` / `LOCAL_STUDIO_ROCM_UPGRADE_CMD`), runs it with
  `RUNTIME_UPGRADE_TIMEOUT_MS` (10 min), then re-probes the platform to report the new version
  (`getCudaInfo` or `getRocmInfo`). No command configured → immediate structured failure naming
  the env var to set. `_options` is accepted but unused (`:27`).
- **Gotcha:** the env command string is passed to `runCommandAsyncEffect(command, [], ...)`
  (`:40`), which `spawn()`s it **without a shell** — so the env var must be a single executable
  path (e.g. a script), not a compound shell command. Same for
  `runEnvironmentUpgradeCommand` in `upgrade-config.ts:13`.
- Line `:20` re-exports `getSglangRuntimePython` from `../specs/sglang-spec` — nothing imports
  it from here; dead re-export.

### `vllm-runtime.ts` (140 lines) — vLLM-specific info, config help, install

- `collectPythonCandidates` (`:25`) — interpreter search order: `LOCAL_STUDIO_RUNTIME_PYTHON`
  env → python behind the `vllm` CLI script (shebang) → canonical path
  (`resolveVllmPythonPath`) → system `python3`/`python` (unless
  `LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM=1`).
- `resolveBundledWheel` (`:47`) — newest `vllm-*.whl` by mtime under `runtime/wheels`, version
  parsed from the filename.
- `getVllmRuntimeInfo` (`:74`) — aggregated vLLM status (installed/version/python/bin/bundled
  wheel); served at `GET /runtime/vllm`.
- `getVllmConfigHelp` (`:95`) — runs `vllm serve --help` (or the module form) with a 5 s
  timeout to give the UI the full CLI option list.
- `installVllmRuntime` (`:117`) — the vLLM `EngineSpec.install` implementation. Priority:
  (1) env override command (`LOCAL_STUDIO_VLLM_UPGRADE_CMD`) → run it verbatim;
  (2) bundled wheel when `preferBundled !== false`; (3) `vllm==<version>` where version comes
  from the job or `LOCAL_STUDIO_VLLM_UPGRADE_VERSION`. Delegates to `installIntoManagedVenv`,
  choosing the timeout by situation: 10 min (`VLLM_UPGRADE_TIMEOUT_MS`) for upgrades into an
  existing python, 30 min (`ENGINE_INSTALL_TIMEOUT_MS`) for first installs (`:129` — large
  torch/CUDA wheels).

### `managed-venv.ts` (190 lines) — the generic venv installer

Shared by the vllm/sglang/mlx specs. Also defines the managed-venv layout:
`$data_dir/runtime/venvs/<backend>-latest` (`managedVenvName` `:18`, `managedVenvPath` `:20`,
`managedVenvPython` `:25`).

- `installIntoManagedVenv` (`:188`, body `:115`) — the pipeline:
  1. Resolve a base `python3`/`python` (`:119`); fail fast if none.
  2. Create the venv if missing and no explicit `pythonPath` was given (`createVenvEffect`,
     `:57`) — existing venvs are reused (returns `null` = no failure).
  3. Pick the installer (`resolveInstallerEffect`, `:85`): prefer `uv`
     (`uv pip install --python <venv> --upgrade <spec>`), else the venv's own pip after a 10 s
     preflight check; if neither works, fail with a hint to install uv (`:102`).
  4. Run the install with streamed output: `onOutput` keeps a rolling 4,000-char tail and
     **throttles progress callbacks to 1 Hz** (`JOB_OUTPUT_THROTTLE_MS`, `:50`), creeping
     `progress` from 0.2 toward 0.9 (`:158`) — indeterminate-but-moving progress for the UI.
  5. Verify by re-probing (`probePythonRuntime`, `:178`): success is defined as "the package
     imports afterwards", not "pip exited 0" — a post-install sanity gate.
- `InstallProgressUpdate` (`:30`) is the callback shape consumed by engine-jobs.
- Timeout error messages are deliberately actionable, e.g. "large torch/CUDA wheels are the
  usual cause" (`:172`).

### `managed-llamacpp.ts` (119 lines) — llama.cpp managed source build

`installManagedLlamacpp` (`:33`) builds `llama-server` from source under
`$data_dir/runtime/llamacpp` (`:13-17`): requires `git`+`cmake` (else `missingTool` error with
setup hints, `:19`), shallow-clones or `git pull --ff-only`s ggml-org/llama.cpp, configures with
cmake (`-DGGML_CUDA=ON` when `nvcc` is found on PATH or at `/usr/local/cuda/bin/nvcc`, `:27`),
builds with `cpus()-1` parallel jobs (`:92`), verifies the binary exists, and reports
`llama-server --version`. Single 45-minute timeout for every step
(`MANAGED_BUILD_TIMEOUT_MS`, `:11`). Noteworthy: the `git pull` result is intentionally
ignored (`:77`) — a failed update falls through to building whatever source is on disk.

### `runtime-info.ts` (265 lines) — aggregated platform/runtime snapshot

- `getSystemRuntimeInfo` (`:36`) — the `SystemRuntimeInfo` aggregate used by system routes and
  the metrics collector. It's a **single-flight cache**: 30 s TTL (`:31`), guarded by a
  module-level `Semaphore.makeUnsafe(1)` (`:34`); while one computation is in flight, concurrent
  callers join the same in-flight fiber instead of re-computing (`:47`). The cached value is
  also returned through a fiber (`Effect.forkChild(Effect.succeed(...))`, `:45`) so both paths
  end in `Fiber.join`. `shutdownRuntimeInfo` (`:71`) interrupts the in-flight fiber at shutdown.
- `computeSystemRuntimeInfo` (`:79`) — fans out with `Effect.all(..., { concurrency:
  "unbounded" })`: nvidia-smi snapshot, vLLM info (forked once, joined twice — the second join
  feeds `getTorchBuildInfo` a python path, `:99-103`), per-backend runtime info via
  `getEngineSpec(...).getRuntimeInfo`, GPU list. Then `detectPlatformKind` classifies the
  platform, and ROCm/CUDA detail + GPU-monitoring capability are resolved conditionally on the
  detected kind (`:120-144`).
- `detectPlatformKind` (`:165`) — pure, testable priority chain: forced
  `LOCAL_STUDIO_GPU_SMI_TOOL` → torch HIP build → torch CUDA build → nvidia-smi present →
  rocm-smi present → Apple Silicon → `unknown`.
- `getCudaInfo` (`:232`) — driver version from `nvidia-smi --query-gpu`, CUDA version parsed
  from full `nvidia-smi` output (`extractCudaVersion`), fallback to `nvcc --version`
  (`extractNvccVersion`, `:226`).
- `getLlamacppRuntimeInfo` (`:191`) — llama-server version probing with the
  `--version` → `--help` fallback; duplicated `parseLlamaVersion` here (`:183`) vs
  runtime-target-probes `:167` (minor duplication).

### `upgrade-config.ts` (60 lines) — env-var contract for upgrades

Central registry of the operator-facing env vars: `LOCAL_STUDIO_{VLLM,SGLANG,LLAMACPP,CUDA,ROCM}_UPGRADE_CMD`
and `LOCAL_STUDIO_VLLM_UPGRADE_VERSION` (`:45-50`), plus `runEnvironmentUpgradeCommand`
(`:13`, 10-min default timeout) and `isUpgradeCommandConfigured` (`:59`). Reading upgrade
behavior starts here — almost every "can this be upgraded?" decision bottoms out in one of
these env checks.

### `vllm-python-path.ts` (34 lines) — canonical vLLM interpreter resolution

`resolveVllmPythonPath` (`:22`) — first existing of: `LOCAL_STUDIO_RUNTIME_PYTHON` →
`DEFAULT_CANONICAL_PYTHON_PATH` (`/opt/venvs/active/vllm-latest/bin/python`, from
`../configs.ts:14`) → the managed venv python (if `data_dir` is provided). Purely synchronous;
used by the vllm and sglang specs.

### `cuda-version.ts` (5 lines) — one regex

`extractCudaVersion` (`:1`) — pulls `CUDA Version: X.Y` (tolerating "UMD") out of nvidia-smi
text. Used by `runtime-info.ts`.

### Tests (one-line notes)

- `runtime-info.test.ts` — covers `detectPlatformKind`: Apple-Silicon→metal and forced
  `nvidia-smi`→cuda priority.
- `runtime-target-factory.test.ts` — covers `makeRuntimeTarget` capabilities: system Python is
  not updatable; managed vllm/mlx venvs are updatable with correct `packageSpec`.

---

## 3. How data/control flows

### Flow A — install/update job (the write path)

```
POST /runtime/jobs  (runtime-routes.ts:92)
  → parseRuntimeJobBody (Schema-validated, runtime-routes.ts:45)
  → createEngineJob (engine-jobs.ts:258)  → returns queued EngineJob immediately
      └─ forks detached fiber → runJob (engine-jobs.ts:154)
           → getRuntimeTarget / getDefaultRuntimeTarget (runtime-targets.ts:484/512)
           → validate target.capabilities.canUpdate (engine-jobs.ts:178)
           → acquireEngineInstallLock (install-lock.ts:114)   [poll ≤30 min, cancellable]
           → Effect.acquireUseRelease → getEngineSpec(backend).install (engine-jobs.ts:134)
                → e.g. installVllmRuntime (vllm-runtime.ts:117)
                     → installIntoManagedVenv (managed-venv.ts:188)
                          → python -m venv … → uv/pip install … → probePythonRuntime verify
                → onProgress/onSpawn callbacks → updateRunningJob (engine-jobs.ts:75)
           → clearRuntimeTargetsCache (engine-jobs.ts:196)
           → final job record: success/error + outputTail
GET /runtime/jobs/:jobId  (runtime-routes.ts:119)  → polls the in-memory record
POST /runtime/jobs/:jobId/cancel (runtime-routes.ts:130)
  → cancelEngineJob (engine-jobs.ts:313): SIGTERM→SIGKILL child, interrupt fiber
```

### Flow B — runtime target listing (the read path)

```
GET /runtime/targets (runtime-routes.ts:62)
  → getRuntimeTargets (runtime-targets.ts:447)   [5-min cache, keyed by data_dir]
      → per backend (unbounded concurrency):
           collectPythonTargets / collectLlamacppTargets   (running → configured → venv scan → system)
           + collectDockerTargets + collectBundledTargets
      → every candidate through probePythonRuntime / probeBinaryRuntime (runtime-target-probes.ts)
      → makeRuntimeTarget (runtime-target-factory.ts:101): id, capabilities, health, update metadata
      → addTarget merge by id (runtime-targets.ts:68)
      → withSelection (persisted choice) → sortTargets → cache → JSON
POST /runtime/targets/:targetId/select (runtime-routes.ts:74)
  → selectRuntimeTarget (runtime-targets.ts:493): persists id, clears cache
```

### Flow C — platform/runtime info

```
GET /system/... and metrics collector
  → getSystemRuntimeInfo (runtime-info.ts:36)   [30 s TTL + single-flight fiber]
      → Effect.all unbounded: nvidia-smi snapshot, vllm info, per-backend spec info, torch, gpus
      → detectPlatformKind (runtime-info.ts:165) → conditional ROCm/CUDA detail
CUDA/ROCm upgrade job → runPlatformUpgrade (runtime-upgrade.ts:25)
  → env command → re-probe getCudaInfo/getRocmInfo for the new version
```

---

## 4. Key patterns & idioms (for an Effect newcomer)

- **Everything returns `Effect.Effect<Success, Error>`** — a lazy description, not a running
  computation. `Effect.gen(function* () { const x = yield* step(); ... })` is async/await for
  Effects. Nothing executes until the HTTP handler layer (`effectHandler`) or a `fork` runs it.
- **Concurrency via fibers, not promises.** `Effect.forkDetach` (engine-jobs `:275`,
  runtime-info `:62`) starts a background fiber; `Fiber.join` awaits it; `Fiber.interrupt`
  cancels it (cancellation is the primitive behind job cancel and shutdown). `Effect.all([...],
  { concurrency: "unbounded" })` is `Promise.all` with structured concurrency.
- **Resource safety**: `Effect.acquireUseRelease(acquire, use, release)` (engine-jobs `:130`)
  guarantees the install lock is released even if the install fails or the fiber is
  interrupted. `Effect.ensuring` (`:269`) is `finally`.
- **Errors are typed but mostly avoided here**: `EngineOperationError` is a
  `Schema.TaggedErrorClass` (engine-spec.ts:41) — pattern-matchable, serializable. But most of
  this slice prefers returning `RuntimeUpgradeResult { success, error }` **values** over
  failing the Effect, reserving the error channel for truly exceptional paths (target
  validation). `Effect.catch` (engine-jobs `:224`) is the last-resort mapper to job records.
- **Imperative islands inside Effect**: module-level mutable Maps/caches (jobs, targetsCache,
  systemRuntimeCache) are manipulated inside `Effect.sync`/`Effect.gen` for ordering, but the
  state itself is plain JS. The codebase does not use `Ref`/`SubscriptionRef` here — acceptable
  because access is single-process and effectively serialized by the job/lock structure.
- **Single-flight with `Semaphore.makeUnsafe(1)` + a shared in-flight fiber**
  (runtime-info.ts:33-68) — a recipe worth stealing: callers either get the 30 s cache, join
  the running computation, or become the one that computes.
- **Process execution is wrapped in `core/command.ts`**: `runCommandAsyncEffect` is an
  `Effect.callback` around `spawn` with timeout → SIGTERM → SIGKILL escalation, bounded
  stdout/stderr tails (256 KB), and `onSpawn`/`onOutput` hooks — the hooks are how this slice
  gets killable children (`onSpawn`) and live progress (`onOutput`). `resolveBinary` is a
  PATH-plus-well-known-dirs `which`.
- **Schema as parser guard**: external, untrusted strings (JSON from a `python -c` probe, the
  lock file contents) are decoded with `Schema.decodeUnknownSync` inside try/catch rather than
  cast (runtime-target-probes `:109`, install-lock `:50`).
- **Env-var strategy pattern**: upgrade behavior per backend is selected by the presence of
  `LOCAL_STUDIO_*_UPGRADE_CMD` env vars (upgrade-config.ts) — capabilities, install routing,
  and UI metadata all derive from these checks.

---

## 5. Connections

**Depends on (outside the slice):**
- `core/command.ts` — `resolveBinary`, `runCommandEffect`, `runCommandAsyncEffect` (all process I/O).
- `engines/engine-spec.ts` — `getEngineSpec`, `EngineOperationError`, `InstallOptions`,
  `BinaryProbeResult`; the slice implements the specs' `install`/`getRuntimeInfo` behavior.
- `engines/configs.ts` — timeout constants, `DEFAULT_CANONICAL_PYTHON_PATH`.
- `engines/process/process-utilities.ts` — `pidExists`, `listProcesses`, `detectBackend`.
- `config/persisted-config.ts` — target-selection persistence (runtime-targets).
- `system/platform/*` — `gpu`, `rocm-info`, `smi-tools`, `torch-info`, `compatibility-report`
  (runtime-info, runtime-upgrade).
- `@local-studio/contracts/system` — `RuntimeTarget`, `EngineJob`, `RuntimeUpgradeResult`,
  `SystemRuntimeInfo` (contracts/system.ts:41,73,145,175) shared with the frontend.
- `semver` (npm) — version comparison in probes.

**Depended on by:**
- `engines/runtime-routes.ts` — all `/runtime/*` HTTP endpoints (jobs, targets, backend info).
- `engines/specs/{vllm,sglang,mlx,llamacpp}-spec.ts` — delegate installs
  (`installVllmRuntime`, `installIntoManagedVenv`, `installManagedLlamacpp`), probing helpers,
  `resolveVllmPythonPath`, `getLlamacppRuntimeInfo`.
- `engines/process/process-utilities.ts` — imports `managedVenvPython`/`isManagedPythonBackend`
  (a small import cycle risk with engine-jobs→process-utilities, currently type/value-safe).
- `system/routes.ts`, `system/metrics-collector.ts` — `getSystemRuntimeInfo`.
- `studio/routes.ts` — `getVllmRuntimeInfo`.
- `app-context.ts` — `shutdownEngineJobs`, `shutdownRuntimeInfo` at boot/shutdown.

---

## 6. How to read this code (suggested order)

1. **`contracts/system.ts:37-181`** (outside the slice) — `RuntimeTarget`, `EngineJob`,
   `RuntimeUpgradeResult`, `SystemRuntimeInfo`. These four shapes are the vocabulary of the
   whole slice.
2. **`upgrade-config.ts`** — 60 lines; the env-var knobs everything else keys off.
3. **`runtime-target-probes.ts`** — learn the probing primitives (`probePythonRuntime`,
   `compareVersions`); nothing here has side effects beyond spawning short-lived commands.
4. **`runtime-target-factory.ts`** — see probes turned into targets: id scheme, capability
   matrix, health.
5. **`runtime-targets.ts`** — the big one: read `getRuntimeTargets` (`:447`) first, then each
   collector bottom-up, then `addTarget`'s merge rules (`:68`).
6. **`install-lock.ts`** — small, self-contained; understand the `wx` flag + stale-PID logic.
7. **`managed-venv.ts` → `vllm-runtime.ts` → `managed-llamacpp.ts`** — the three install
   implementations, generic to specific.
8. **`engine-jobs.ts`** — read last; now `runJob` (`:154`) reads as pure orchestration of
   things you already know: resolve target → lock → spec.install → record. Finish with
   `cancelEngineJob` to see the fiber/process teardown.
9. **`runtime-info.ts`** — orthogonal aggregate; study the single-flight cache pattern
   (`:36-69`) and `detectPlatformKind`.
10. Skim **`runtime-routes.ts`** (neighbor) to anchor every export to an HTTP endpoint.

First things to look for in any file: which env vars it reads (behavior switches), which
timeouts apply (`../configs.ts`), and whether it returns errors as values
(`RuntimeUpgradeResult`) or through the Effect error channel (`EngineOperationError`).

---

## Noteworthy / surprising findings

- **Dead re-exports**: `runtime-upgrade.ts:20` (`getSglangRuntimePython`) and
  `engine-jobs.ts:28` (`managedVenvPath`) are re-exported but nothing imports them from those
  modules.
- **Shell-command footgun**: env-configured upgrade commands are `spawn`ed without a shell
  (runtime-upgrade.ts:40, upgrade-config.ts:18) — a value like `"apt update && apt install"`
  fails with ENOENT; only a single executable path works. Undocumented in-code.
- **Job backend masquerade**: cuda/rocm jobs are recorded as `backend: "vllm"`
  (engine-jobs.ts:58) due to the `EngineBackend` type — UI filtering by backend will
  mis-attribute them.
- **Silent staleness**: `git pull --ff-only` failure is ignored in managed-llamacpp.ts:77 —
  the build proceeds with whatever source is on disk.
- **In-memory only**: job history (engine-jobs) and both caches (targets 5 min, runtime info
  30 s) vanish on restart; `outputTail` from pip is not redacted (low risk, but pip output can
  echo proxy URLs with credentials).
- **Unbounded probing concurrency**: `getRuntimeTargets` can spawn dozens of `python -c`
  probes simultaneously (runtime-targets.ts:157,468) — fine on a workstation, noticeable on
  constrained hosts; the 5-min cache amortizes it.
- **Clever trick worth knowing**: `updateRunningJob` (engine-jobs.ts:75) only writes while
  status is `running`, which makes cancellation race-safe — a completed fiber can't resurrect
  a cancelled job. Similarly, `shouldContinue` inside the lock-wait loop lets a cancelled job
  stop waiting for the lock instead of queuing behind a 30-minute install.
- **Minor duplication**: `parseLlamaVersion` exists in both runtime-info.ts:183 and
  runtime-target-probes.ts:167 with slightly different fallback behavior.
