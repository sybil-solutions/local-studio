# Slice walkthrough: speech + audio + services

Scope: `controller/src/modules/speech/*`, `controller/src/modules/audio/*`, `controller/src/services/*`. All paths below are relative to `/Users/sero/projects/vllm-studio/controller`.

## 1. Purpose

This slice implements Local Studio's entire audio surface. It has two halves: (a) a **managed, GPU-resident voice-cloning TTS stack** ("speech") that installs a pinned Chatterbox Turbo Python environment, leases an NVIDIA GPU, spawns a sandboxed Python worker, and stores consent-gated voice profiles encrypted at rest; and (b) a **bring-your-own-CLI audio layer** ("audio" + "services") that shells out to `whisper-cli` for speech-to-text and `piper` for basic TTS behind OpenAI-compatible `/v1/audio/*` endpoints. `services/provider-routing.ts` is unrelated to audio — it parses `provider/model` strings for the OpenAI proxy and only shares a directory.

## 2. File-by-file walkthrough

### `src/modules/speech/routes.ts` (259 lines) — HTTP surface for the managed speech stack

Exports `registerSpeechRoutes(app, context)` (`routes.ts:164`) and the `SpeechRoutesContext` interface (`routes.ts:21`). Registers seven routes, all under `/v1/audio/`:

- `GET /v1/audio/status` (`routes.ts:169`) — returns `SpeechService.getStatus()`.
- `POST /v1/audio/install` (`routes.ts:179`) — kicks off the Chatterbox install; returns **202 when the install phase is `installing`, 200 otherwise** (`routes.ts:189`). Body is parsed by `installInput` (`routes.ts:61`): bounded to **1 KB** (`INSTALL_REQUEST_LIMIT`, `routes.ts:16`), empty body is legal and means `{}`, otherwise JSON-decoded and validated against `InstallRequestSchema` (`{ repair?: boolean }`, `routes.ts:17`).
- `POST /v1/audio/install/cancel` (`routes.ts:195`) — cancels, then re-reads status.
- `GET /v1/audio/voices` / `POST /v1/audio/voices` / `DELETE /v1/audio/voices/:voiceId` (`routes.ts:208-244`) — voice profile CRUD. Delete returns **204 on success, 404 otherwise** (`routes.ts:232-239`).
- `POST /v1/audio/runtime/stop` (`routes.ts:245`) — stops worker + releases GPU.

Key mechanics:

- `SpeechRoutesContext` uses `Pick<SpeechService, ...>` (`routes.ts:23-32`) so routes depend on a narrow, mockable slice of the service.
- `createVoice` (`routes.ts:92-143`) is a strict multipart validation pipeline: `reference` must be a `File`, ≤ 20 MB (`MAX_VOICE_UPLOAD_BYTES`), `name` 1–80 chars, and `consent` must equal `VOICE_CONSENT_VERSION` — the consent check happens in the route *and* again in the store. The whole request is bounded at 21 MB (`VOICE_REQUEST_LIMIT`, `routes.ts:15`).
- `speechError` (`routes.ts:35-51`) maps the three typed errors (`SpeechServiceError`, `VoiceReferenceError`, `VoiceProfileError`) to `{status, code, message}`, and `RequestBodyTooLargeError` to a hardcoded 413.
- `handleSpeechRoute` (`routes.ts:145-162`) is the error boundary for every route: known errors become structured JSON; anything unknown is logged and becomes a **generic 500 with no detail leak**.

### `src/modules/speech/worker.py` (241 lines) — the Python TTS worker

Not TypeScript, but it is half of the speech protocol. Runs inside the managed venv, talks **JSON-lines on stdin/stdout**.

- `PROTOCOL_OUTPUT = sys.stdout; sys.stdout = sys.stderr` (`worker.py:24-25`) — a crucial trick: the real stdout fd is saved for protocol frames, then `sys.stdout` is rebound to stderr so any library that `print()`s cannot corrupt the protocol stream.
- `os.umask(0o077)` (`worker.py:14`) — every file the worker creates (model cache, outputs) is owner-only by default.
- `bind_parent_lifetime` (`worker.py:29-54`) — suicide-on-orphan logic. On Linux it uses `prctl(PR_SET_PDEATHSIG, SIGKILL)`; elsewhere a daemon thread polls `getppid()` every 0.5 s and self-kills when the parent changes. If the parent is already PID 1 at startup it kills itself immediately. This guarantees the GPU-hogging worker never outlives the controller.
- `require_single_cuda` (`worker.py:62-70`) — refuses to run unless `CUDA_VISIBLE_DEVICES` is exactly one **full GPU UUID** matching `GPU_UUID_PATTERN` (`worker.py:23`) and torch sees exactly one device. Combined with `require_package_version` (`worker.py:73-76`), the worker hard-pins `chatterbox-tts==0.1.7`.
- `snapshot` (`worker.py:79-87`) — `huggingface_hub.snapshot_download` with pinned repo + revision (`ResembleAI/chatterbox-turbo` @ `749d1c1a…`, `worker.py:18-19`) and an `allow_patterns` allowlist. `--prefetch` mode (`worker.py:90-103`) downloads without loading the model — this is what the installer runs.
- `request_lines` (`worker.py:123-143`) — hand-rolled buffered line reader over raw `os.read`, enforcing a 64 KB max frame (`MAX_LINE_BYTES`, `worker.py:21`); an unterminated trailing frame on EOF is an error.
- `synthesis_request` (`worker.py:153-172`) — defense-in-depth validation of every frame: non-empty text ≤ 4096 chars, `voice_path` must be an existing absolute file, `output_path` must be absolute, `.wav`, inside an existing directory, and **must not already exist** (prevents the TS side from making the worker overwrite arbitrary files).
- `synthesize` (`worker.py:175-190`) — `torch.inference_mode()`, `model.generate(text, audio_prompt_path=voice)`, saved via `torchaudio` then `chmod 0o600`.
- `serve` (`worker.py:193-221`) — loads the model, emits one `ready` frame, then loops: `synthesize` → emit result frame, `shutdown` → ack and return, anything else → error frame. Every exception becomes an `{"type":"error","id":...}` frame; the loop keeps serving after per-request errors.
- `main` (`worker.py:224-237`) — `--prefetch` → download-only mode; extra args are rejected; top-level failure emits an error frame with `id: None` and exits 1.

### `src/modules/speech/worker-client.ts` (768 lines) — TS side of the worker protocol

The most intricate file in the slice. Exports the protocol Schemas, `SpeechWorkerError`, the `SpeechWorkerTransport` abstraction, `spawnNodeSpeechWorker`, and `ChatterboxWorkerClient`.

**Protocol** (`worker-client.ts:29-82`): `SpeechWorkerRequestSchema` = `synthesize | shutdown`; `SpeechWorkerResponseSchema` = `ready | synthesize | shutdown | error`. The `ready` frame is validated with **literal** package version / model revision / `cuda_devices: 1` (`worker-client.ts:47-54`), so a stale venv that somehow starts is rejected at handshake.

**Transport layer** (`spawnNodeSpeechWorker`, `worker-client.ts:194-286`):
- `boundedLineDecoder` (`worker-client.ts:159-192`) — byte-level chunk assembler; a line over the limit is dropped and reported via `onOversize` instead of crashing the stream. Stdout limit 64 KB; stderr 4 KB/line and 64 KB total (`worker-client.ts:19-27`), after which stderr is truncated with a marker line.
- **Pending-frame queues**: protocol lines emitted before any `onLine` listener attaches are buffered (max 8, `MAX_PENDING_PROTOCOL_LINES`); stderr likewise (max 16). This closes the race between process spawn and listener registration. Overflowing the protocol queue kills the worker (`worker-client.ts:207-211`).
- `failTransport` (`worker-client.ts:234-239`) latches the first error, notifies listeners, and SIGKILLs.
- `onError`/`onExit` replay terminal events to late subscribers (`worker-client.ts:275-284`) — no event is ever lost.
- `write` ignores backpressure (`child.stdin.write` return value; `worker-client.ts:256-258`) — acceptable because requests are small and strictly serialized.

**Client** (`ChatterboxWorkerClient`, `worker-client.ts:342-768`):
- A `Semaphore.makeUnsafe(1)` (`worker-client.ts:354`) serializes **all** operations: synthesize, shutdown, terminate. There is at most one in-flight request; `sendRequestEffect` fails fast with "already busy" if `session.pending` is set (`worker-client.ts:606-608`).
- Input hardening before anything is sent: `validatedText` (`worker-client.ts:315-324`) counts **code points** (`Array.from(text).length`) against 4096; `controlledVoicePath` (`worker-client.ts:302-313`) `realpathSync`s both the voice directory and the candidate and requires the candidate to be strictly inside — a symlink-escape guard. The constructor itself throws unless the GPU UUID matches the full-UUID regex (`worker-client.ts:359-361`).
- Output path is derived from the request id (`outputs/<uuid>.wav`, `worker-client.ts:390`); the id is regex-checked so it can't escape the directory (`worker-client.ts:382-384`). On failure the output file is removed (`worker-client.ts:398-402`).
- Sessions spawn lazily: `readySessionEffect` (`worker-client.ts:552-566`) reuses a live session or calls `spawnEffect` (`worker-client.ts:568-599`), then awaits the `ready` Deferred with a 5-minute startup timeout (`DEFAULT_STARTUP_TIMEOUT_MS`, `worker-client.ts:20`). Spawning runs `python -u worker.py` with the whitelist environment from `chatterboxWorkerEnvironment`.
- `receiveLine` (`worker-client.ts:685-730`) is a strict state machine: a second `ready` frame is a protocol violation; an `error` frame with `id: null` (startup failure) or matching the pending id kills the session; **any frame with an unexpected id fails the whole session**. This "one bad frame = dead worker" policy is deliberate — the worker is untrusted after a protocol desync.
- Timeouts are fatal to the session: `awaitWithTimeout` (`worker-client.ts:638-656`) converts a timeout into `failSession(..., kill=true)` so a hung CUDA job never leaves the GPU leased.
- Graceful shutdown (`shutdownEffect`, `worker-client.ts:414-471`): sends a `shutdown` request (10 s timeout), closes stdin, waits `shutdownGraceMs` (2 s) for exit, then SIGKILLs. `settleTerminationEffect` (`worker-client.ts:473-496`) waits up to 5 s for a killed worker to actually exit and *fails* if it doesn't — the caller needs to know the GPU might still be held.
- Every long-running await is wrapped in `Effect.onInterrupt(() => interruptSessionEffect(...))` (`worker-client.ts:466-468`, `545-548`, `654`) so Effect fiber interruption also tears down the OS process.
- `Effect.ensuring` clears `session.pending` after each request (`worker-client.ts:630-634`), and `Deferred`s bridge the callback world to Effect (`completeSuccess`/`completeFailure`, `worker-client.ts:294-300`).
- Effect-flavored method pairs (`synthesizeEffect`/`synthesize`, etc.) exist for API compatibility; the plain names just delegate.

### `src/modules/speech/runtime.ts` (489 lines) — installer for the Chatterbox venv + model

Exports `CHATTERBOX_PACKAGE_SPEC`, `chatterboxRuntimePaths`, `chatterboxWorkerEnvironment`, and `ChatterboxRuntime`.

- `ChatterboxRuntimeState` (`runtime.ts:38-53`) — discriminated union: `not_installed | installing{stage,progress} | installed{...} | error{message}`. Stage names feed the UI progress messages in `service.ts`.
- `chatterboxRuntimePaths` (`runtime.ts:113-135`) — the venv directory is **versioned** (`runtime/venvs/chatterbox-0.1.7`), so a package bump naturally creates a fresh venv. Install record is `runtime/speech/chatterbox-0.1.7.json`.
- `chatterboxWorkerEnvironment` (`runtime.ts:137-163`) — a **whitelist** environment: only `PATH`, `HOME`, temp dirs and `LD_LIBRARY_PATH`/`DYLD_LIBRARY_PATH` are inherited; then `CUDA_DEVICE_ORDER=PCI_BUS_ID`, `CUDA_VISIBLE_DEVICES=<full GPU UUID>`, `HF_HOME` pointed at the managed cache, telemetry and user site-packages disabled. Nothing else from the user's shell leaks into the worker.
- `readInstalledState` (`runtime.ts:179-191`) — "installed" requires both the venv python to exist *and* the install record to decode against `InstallRecordSchema`, whose package version and model revision are **Schema literals** (`runtime.ts:25-30`). Any version/revision bump invalidates the old install automatically.
- `startInstall` (`runtime.ts:225-292`) — returns the current state immediately if already installing, or installed without `repair`. `repair` deletes the install record (`runtime.ts:245-253`). Otherwise it sets state to `installing`, creates an `AbortController`, and **forks** `installEffect` wrapped in: an install `Semaphore(1)`, `Effect.match` that folds success/failure into `this.state` (abort → "cancelled" message), and `Effect.ensuring` guarded by a generation counter so a stale fiber can't clear a newer install's controller. `Effect.forkDetach({ startImmediately: true })` returns the `installing` state synchronously.
- `cancelInstall` (`runtime.ts:309-329`) — aborts the controller (kills the child process via `runCommandAsyncEffect`'s signal handling) *and* interrupts the fiber, then overwrites state to a "cancelled" error.
- `installEffect` (`runtime.ts:354-488`) — the staged pipeline, updating progress as it goes: `creating_runtime` (0.15) — `uv venv --python 3.11` preferred, `python3.11 -m venv` fallback; `installing_package` (0.35) — `uv pip install --torch-backend=cu124 chatterbox-tts==0.1.7`, or a manual three-step pip path installing `torch==2.6.0+cu124`/`torchaudio==2.6.0+cu124` from the PyTorch CUDA index first; `prefetching_model` (0.75) — runs `worker.py --prefetch`, which also validates the package version and single-GPU setup. Finally writes the install record **atomically** (`.tmp` + rename + chmod 0600, `runtime.ts:467-485`).
- `commandEffect` (`runtime.ts:335-352`) — treats `exitConfirmed === false` (runner couldn't prove the child died) as a distinct `CommandTerminationError`, and uses stderr/stdout tail as the failure message otherwise. Install commands have 30 min timeout, prefetch 60 min (`runtime.ts:22-23`).

### `src/modules/speech/reference-audio.ts` (280 lines) — voice upload normalization

Exports `MAX_VOICE_UPLOAD_BYTES` (20 MB), `VoiceReferenceError`, `NormalizedVoiceReference`, and `normalizeVoiceReference`.

Pipeline (`reference-audio.ts:196-280`): reject empty/oversized input → sniff container format **by magic bytes** (`detectedFormat`, `reference-audio.ts:145-161`: RIFF/WAVE, OggS, fLaC, FORM+AIFF/AIFC, caff, ftyp, matroska EBML, ID3/MPEG sync) → require ffmpeg (`LOCAL_STUDIO_FFMPEG_CLI` or `ffmpeg` on PATH) → write an empty placeholder with `flag: "wx"` and `0600` → transcode → re-validate.

- The ffmpeg invocation (`reference-audio.ts:55-135`) is a little security profile: `-nostdin`, `-protocol_whitelist pipe` (no file/URL protocols), `-max_alloc 67108864` (64 MB allocation cap), single-threaded, reads the upload from **stdin** (`-i pipe:0`), first audio stream only, strips video/subtitles/data, and outputs **mono 24 kHz 16-bit PCM WAV truncated at 20.1 s**.
- `transcode` uses `Effect.callback` with a `settled` latch (`reference-audio.ts:93-97`) so exactly one of `error`/`close`/cancellation resumes the Effect; the cancellation finalizer (`reference-audio.ts:121-126`) destroys stdin and SIGKILLs ffmpeg. A 60 s `Effect.timeoutOrElse` (`reference-audio.ts:127-135`) maps hangs to 504.
- After transcoding: size must be ≤ 1.1 MB (`MAX_NORMALIZED_BYTES`, `reference-audio.ts:10`), then `wavDuration` (`reference-audio.ts:163-191`) **hand-parses the RIFF chunk list** — it refuses anything that isn't PCM/mono/24 kHz/16-bit and computes duration from the `data` chunk size ÷ byte rate. Duration must be 6–20 s (`reference-audio.ts:266-274`).
- `Effect.acquireUseRelease` guarantees the temp wav is unlinked even on failure/cancellation (`reference-audio.ts:235-279`).
- The injectable `VoiceReferenceDependencies` (`reference-audio.ts:29-37`) is the test seam.

### `src/modules/speech/voice-vault.ts` (169 lines) — encryption at rest for voice audio

- Key management (`voice-vault.ts:27-64`): `LOCAL_STUDIO_VOICE_MASTER_KEY` (hex or base64, must decode to 32 bytes) wins; otherwise a random 32-byte `master.key` is created with `flag: "wx"` (no clobber) + `0600`, inside a `0700` directory. Loaded on **every** read/write — no caching, fine at this volume.
- Encryption (`voice-vault.ts:66-102`): AES-256-GCM, random 12-byte nonce, and the **profile id as AAD** — a ciphertext blob cannot be swapped between profiles undetected. On-disk format: `[1-byte version][nonce][16-byte tag][ciphertext]`; decryption rejects wrong version or truncated blobs.
- `writeAtomic` (`voice-vault.ts:104-127`): writes to a random `.tmp` sibling then `rename`s, wrapped in `Effect.acquireUseRelease` so the temp file is always cleaned up.
- `delete` treats ENOENT as success (`voice-vault.ts:160-168`) — idempotent deletion.
- `VoiceVaultError` (`voice-vault.ts:11-15`) is a `Schema.TaggedErrorClass` with an `operation` literal union — the pattern used for typed errors throughout the slice.

### `src/modules/speech/voice-store.ts` (293 lines) — voice metadata (SQLite) + encrypted audio

- Constants: `VOICE_CONSENT_VERSION = "self_voice_v1"` (`voice-store.ts:10`) — bumping it invalidates all existing consents; `VOICE_ID_PATTERN = /^voice_[a-f\d]{32}$/` (`voice-store.ts:11`), and `validId` turns a malformed id into a **404, not a 400** (`voice-store.ts:55-60`) so ids are unguessable/unprobeable.
- Table `speech_voice_profiles` (`voice-store.ts:93-102`): metadata only (id, name, duration_ms, consent_version, consented_at, created_at). The audio itself lives in the `VoiceVault` (`dataDirectory/speech/vault`).
- A `Semaphore.makeUnsafe(1)` named `mutation` (`voice-store.ts:84`) serializes create/delete, since SQLite writes here are synchronous but vault I/O is not.
- `create` (`voice-store.ts:140-202`): validates consent **again** (defense in depth), name, duration; writes the vault blob **first**, then INSERTs — and on INSERT failure it **compensates by deleting the vault blob** (`voice-store.ts:194-198`). Note the asymmetry: `delete` (`voice-store.ts:204-226`) removes the vault blob *before* the DB row; if the DB delete then failed, the row would point at a missing blob (in practice SQLite delete of an existing row won't fail).
- `withPlaintext` (`voice-store.ts:228-266`) — the bridge to the worker, which needs a real file path: decrypts the blob to a random-named temp wav (`0600`, inside a `0700` dir), runs the caller's `use(path)` effect, and **always** unlinks it via `Effect.acquireUseRelease`. Plaintext voice audio exists on disk only for the duration of a synthesis.
- `consentRecord` (`voice-store.ts:268-285`) exposes the consent audit fields without exposing audio.

### `src/modules/speech/storage.ts` (44 lines) — directory hygiene

- `secureSpeechDirectory` (`storage.ts:16-20`): `mkdir -p` with `0700`, verifies it's a real directory, then re-chmods — repairs permissive modes on pre-existing dirs.
- `prepareChatterboxStorage` (`storage.ts:29-39`): secures all five runtime dirs, then **deletes leftover UUID-named files** in `uploads/` and `outputs/` (`removeOwnedFiles`, `storage.ts:22-27`) — orphans from a previous crash are wiped at startup. The regexes only match `uuid.input|uuid.wav`, so foreign files are untouched.
- `prepareVoicePlaintextStorage` (`storage.ts:41-44`) — same for the plaintext temp dir used by `withPlaintext`.

### `src/modules/speech/service.ts` (1074 lines) — the coordinator ("the brain")

`SpeechService` ties together: GPU telemetry, the GPU lease registry, the running LLM engine, the installer (`ChatterboxRuntime`), the worker (`ChatterboxWorkerClient`), and the voice store. Everything above it is policy-free; all policy lives here.

**Dependency seams** (`service.ts:60-152`): `SpeechEngineState`, `SpeechRuntime`, `SpeechWorker`, `SpeechVoiceStore` interfaces plus constructor options let tests fake every collaborator. `SpeechGpuLeaseGuard` (`service.ts:83-89`) is branded with a `unique symbol` so only this module can mint a lease token.

**GPU targeting** (`resolveTarget`, `service.ts:523-576`):
- If `LOCAL_STUDIO_SPEECH_GPU_UUID` is set it must be a full NVIDIA UUID (`FULL_NVIDIA_UUID`, `service.ts:40-41`), canonicalized to lowercase (`canonicalUuid`, `service.ts:154`), and must exist in telemetry.
- Otherwise it **auto-selects only if exactly one GPU's name matches `/\bRTX\s+3090\b/i`** (`service.ts:42`, `555-562`). Zero or multiple matches → 503 telling you to set the env var. This hardcoded product name is the most opinionated line in the slice.

**Leasing** (`activateSpeech`, `service.ts:596-656`):
1. Fail if the worker is quarantined (see below).
2. Resolve target GPU; refuse to switch GPUs while a lease is held (`service.ts:615-623`).
3. If an install is running and already holds the same lease, reuse it.
4. `assertComputeGpuIdle` (`service.ts:658-680`) — queries `nvidia-smi`-style compute processes (`queryNvidiaComputeGpuUuids`) and refuses if the GPU has an **unmanaged** compute process. Checked *before claiming* and *again after claiming* (`service.ts:651-653`), releasing the lease if the second check fails — a TOCTOU double-check.
5. `reconcileModelLeases` (`service.ts:716-786`) — the trickiest interplay: it reads the engine's current process, then **re-reads it and requires the same pid** (`service.ts:734-743`) to detect a model swap mid-check; resolves the running recipe's GPU selectors to UUIDs (`resolveRecipeGpuUuids`) and atomically `replace`s the `llm` owner's leases — this both pins the model's leases to reality and surfaces a conflict (409 `model_gpu_conflict`) if the model overlaps the speech GPU.
6. `gpuLeaseRegistry.claim("speech", [uuid])` — conflict → 409 `speech_gpu_busy`.
7. Mint the branded guard with a bumped generation and remember it as `liveLease`.

`assertLiveLease` (`service.ts:682-698`) re-validates a guard against the registry **snapshot** on every use — leases can be revoked externally, and a stale guard immediately 409s and clears local state.

**Install orchestration** (`install`, `service.ts:391-426`): under the `activation` semaphore — no-op if already installing/installed; on `repair`, stop the worker first; disk check (`assertInstallCapacity`, `service.ts:578-594`) requires **32 GiB + 8 GiB reserve = 40 GiB** free (`service.ts:43-45`, surfaced as a 507); acquire lease; start the runtime install; then `startInstallCompletion` (`service.ts:1017-1073`) forks a completion fiber that awaits install end and **releases the GPU lease if no worker was ever started** (the lease is only needed during install to pin the GPU choice). Failures land in `workerError`, visible via status.

**Synthesis** (`synthesize`, `service.ts:465-488`; `synthesizeOne`, `service.ts:853-916`):
- Admission control: `acceptingSynthesis` gate + queue cap of 4 queued + 1 running (`MAXIMUM_QUEUED_SYNTHESIS`, `service.ts:47`) → 429 when full; a `pendingSynthesis` counter is decremented in `Effect.ensuring`.
- **Epoch pattern**: `synthesisEpoch` is captured before queueing; `assertSynthesisEpoch` (`service.ts:924-926`) is checked before, between, and after the worker call. `stopRuntime` bumps the epoch, which retroactively fails every queued/in-flight operation with 409 `speech_stopping` — a cheap generation-based invalidation instead of tracking individual fibers.
- `synthesizeOne`: validate text → `voiceStore.withPlaintext` (decrypt voice to temp file) → `ensureWorker` → worker synthesizes → validate the output path is inside the outputs dir (`outputChildPath`, `service.ts:201-209`) → `readBoundedWave` → delete the output file in `ensuring`.
- `readBoundedWave` (`service.ts:224-278`) is a TOCTOU-hardened reader: opens with `O_NOFOLLOW` (no symlinks), caps size at 32 MB, reads in a loop, **re-stats after reading and requires the size to be unchanged**, then `validatedWave` (`service.ts:211-222`) checks the RIFF/WAVE header *and* that the header's declared size matches the actual file length. The worker is treated as an untrusted writer even though we spawned it.

**Failure policy — quarantine** (`quarantineWorker`, `service.ts:918-922`): any worker error during synthesis marks the service `quarantined`, phase `failed`. While quarantined, `activateSpeech`/`ensureWorker` refuse to start a new worker (503 `speech_worker_quarantined`), because a misbehaving CUDA process might still hold GPU memory; the only way out is an explicit stop (`stopWorker`, `service.ts:941-955`), which `terminate`s the worker and *requires confirmed exit* — `terminateWorker` (`service.ts:928-939`) converts unconfirmed exit into a 503 and keeps the GPU reserved.

**Stopping** (`stopRuntime`, `service.ts:957-1001`): under a dedicated `stopping` semaphore — flips `acceptingSynthesis` off and bumps the epoch, optionally cancels the install and joins its fiber, stops the worker (terminating any "late worker" that appeared mid-stop, `service.ts:946-948`), releases the lease, and restores flags in `ensuring` unless fully closed. `stop()` (`service.ts:490-501`) refuses with 409 while an install fiber exists; `shutdown()` (`service.ts:508-512`) sets `closed` and also closes the voice store on exit.

**Status** (`getStatus`, `service.ts:359-389`): assembles the `SpeechStatus` contract — install phase/progress, worker phase and queue depth (`pendingSynthesis - 1`), GPU target (null on any telemetry failure — status never errors because of GPU lookup), prerequisites (ffmpeg presence, python3.11/uv, disk capacity), voice count.

**Voice creation** (`createVoice`, `service.ts:432-459`): normalization is serialized through a semaphore and capped at 2 concurrent pending requests (`MAXIMUM_PENDING_NORMALIZATION`, `service.ts:48`) → 429 `voice_queue_full` beyond that.

### `src/modules/audio/routes.ts` (289 lines) — OpenAI-compatible audio endpoints

Exports `registerAudioRoutes(app, context, dependencies?)` (`routes.ts:98`). Two routes, each wrapped in `Effect.scoped` so temp files registered via `temporaryPath` (`routes.ts:49-52`, an `Effect.acquireRelease`) are deleted when the request scope closes.

**`POST /v1/audio/transcriptions`** (`routes.ts:108-202`):
1. `boundedFormData` with a 101 MB cap (100 MB upload + 1 MB slack, `routes.ts:31-32`).
2. `file` field required; `mode` parsed (`strict` default); `language` optional; model path resolved.
3. `ensureServiceLease` — GPU conflict check (see helpers).
4. Upload is written to `tmp/audio/<uuid><ext>`; if not WAV (magic-byte check), transcoded to 16 kHz mono WAV via ffmpeg.
5. `transcribeAudio` (whisper-cli); empty transcript → 502 `stt_empty_result`; returns `{ text }`.

**`POST /v1/audio/speech`** (`routes.ts:204-287`):
1. JSON body bounded to **64 KB**, validated by `TtsRequestSchema` (`routes.ts:35-41`); `input` must be non-empty; only `response_format: "wav"` is accepted.
2. **Dispatch**: if `model === "chatterbox-turbo"` (`CHATTERBOX_BACKEND`), the request is handed to the managed stack — `voice` (a voice profile id) is required and `context.speechService.synthesize({ text, voiceId })` produces the bytes (`routes.ts:234-251`). This is the single bridge between the two halves of the slice.
3. Otherwise it's the piper path: resolve model, lease check, synthesize to a temp wav, read it back, return `audio/wav`.

**Error mapping** (`audioErrorResponse`, `routes.ts:54-96`): 413 for oversized bodies; `Stt/TtsIntegrationError` keep their `details` object in the response, while `SpeechServiceError`/`VoiceProfileError` are deliberately stripped to `{code, error}` (`routes.ts:80-83`). Note: the catch-all 500 **does** include `details: String(error)` (`routes.ts:88-95`) — inconsistent with the speech module's generic 500 and a minor information-leak inconsistency.

### `src/modules/audio/helpers.ts` (174 lines) — shared audio route logic

- `parseField` / `parseMode` (`helpers.ts:13-25`) — trim-or-undefined form parsing; mode must be `strict|best_effort` else 400.
- `looksLikeWav` (`helpers.ts:27-32`) — RIFF/WAVE magic check on the first 12 bytes.
- `resolveAudioModelPath` (`helpers.ts:41-71`) — model selection: request field wins, then env (`LOCAL_STUDIO_STT_MODEL` / `LOCAL_STUDIO_TTS_MODEL`); a value containing `/` is treated as an explicit path, otherwise resolved under `models_dir/<stt|tts>/`; must exist on disk. `resolveSttModelPath`/`resolveTtsModelPath` are thin wrappers injecting the right error class.
- `ensureServiceLease` (`helpers.ts:97-120`) — asks `processManager.findInferenceProcess(inference_port)` whether an LLM runtime holds the inference port. In `strict` mode a holder yields a structured 409 body (`gpu_lease_conflict`, with `actions: ["best_effort"]` telling the client how to proceed); `best_effort` mode returns `null` and lets the CLI run anyway — the caller accepts degraded/contended GPU behavior explicitly.
- `defaultTranscodeToWav` (`helpers.ts:131-174`) — ffmpeg to mono 16 kHz WAV with a 60 s timeout; timeout → 504, non-zero exit → 400 with stderr attached.

### `src/modules/audio/interfaces.ts` (18 lines)

`AudioRouteDependencies` — optional injectable `transcribe`, `transcodeToWav`, `synthesize` so route tests never touch the filesystem or CLIs.

### `src/services/stt.ts` (139 lines) — whisper.cpp wrapper

- `SttIntegrationError` (`stt.ts:21-38`) — the `{status, code, message, details}` error shape used across the audio routes (note the custom convenience constructor taking positional args, unlike the pure-Schema pattern in `VoiceVaultError`).
- `transcribeWithWhisperCpp` (`stt.ts:63-117`): CLI resolution order: `LOCAL_STUDIO_STT_CLI` → `whisper-cli` on PATH (`resolveBinary`); args `-m <model> -f <file> -nt` (no timestamps) plus `--language` when set; 180 s default timeout. Timeout → 504; non-zero exit → 502 with full stdout/stderr/command details; success → `parseWhisperOutput`.
- `parseWhisperOutput` (`stt.ts:42-61`) — whisper-cli prints diagnostics to **both** stdout and stderr, so both are concatenated, `[...]` timestamp prefixes are stripped, and known noise lines (`main:`, `whisper_`, `system_info:`, "processing samples", "failed to", …) are filtered; the rest is joined into one normalized string. Heuristic, but scoped and documented by its filter list.
- `transcribeAudio` (`stt.ts:119-139`) — Schema-validates the request, then dispatches on `LOCAL_STUDIO_STT_BACKEND` (only `whispercpp` supported; anything else is a 400 listing supported backends).

### `src/services/tts.ts` (114 lines) — piper wrapper

Mirror image of stt.ts: `LOCAL_STUDIO_TTS_CLI` → `piper` on PATH; text is passed via **stdin** (`runCommandAsyncEffect`'s `stdin` option, `tts.ts:54-57`) with `--model` and `--output_file`; 300 s timeout; after exit 0 it verifies the output file actually exists (`tts.ts:79-92`) → 502 `tts_output_missing` otherwise. Backend switch on `LOCAL_STUDIO_TTS_BACKEND` with only `piper` supported.

### `src/services/provider-routing.ts` (51 lines) — OpenAI proxy helper (not audio)

- `parseProviderModel` (`provider-routing.ts:19-35`) — splits `provider/model` on the **first** `/`; a bare model defaults to provider `"openai"` (`DEFAULT_CHAT_PROVIDER`, `provider-routing.ts:3`). Edge cases: empty string → `{provider: "openai", modelId: ""}`; a trailing-slash model (`"foo/"`) falls through to being treated as a bare model id.
- `resolveConfiguredProviderConfig` (`provider-routing.ts:37-44`) — case-insensitive lookup in persisted provider config, requiring `enabled` and a non-empty `api_key`; returns `{baseUrl, apiKey}` or null.
- Consumed only by `src/modules/proxy/openai-routes.ts:10-12` to route `/v1/chat/completions` to upstream providers.

### Tests

There are **no `*.test.ts` files** in `speech/`, `audio/`, or `services/` — notable because the code is full of dependency-injection seams (`AudioRouteDependencies`, `VoiceReferenceDependencies`, `SpeechWorkerSpawner`, all the `SpeechServiceOptions` interfaces) that exist precisely to enable tests. Either tests live elsewhere or the seams are aspirational.

## 3. How data/control flows

**A. Install flow** — `POST /v1/audio/install` → `routes.ts:179` → `installInput` (1 KB bound, `routes.ts:61`) → `SpeechService.install` (`service.ts:391`) → disk check (`service.ts:578`) → `activateSpeech` (GPU resolve → compute-idle check → model-lease reconcile → registry claim, `service.ts:596-656`) → `ChatterboxRuntime.startInstall` (`runtime.ts:225`) forks the install fiber → route returns **202** with status. The install fiber runs venv creation → package install → `worker.py --prefetch` (`runtime.ts:354-488`) → writes the install record. A completion fiber (`service.ts:1017`) releases the GPU lease when done if no worker exists. `GET /v1/audio/status` polls progress.

**B. Voice onboarding** — `POST /v1/audio/voices` (multipart) → route validation (`routes.ts:92-143`) → `SpeechService.createVoice` (queue cap + semaphore, `service.ts:432`) → `normalizeVoiceReference` (magic-byte sniff → sandboxed ffmpeg → RIFF re-validation, `reference-audio.ts:196`) → `VoiceStore.create` (`voice-store.ts:140`): consent re-check → encrypt into vault (`voice-vault.ts:140`) → SQLite INSERT with compensation on failure. Response: 201 + profile metadata.

**C. Managed TTS** — `POST /v1/audio/speech` with `model: "chatterbox-turbo"` → `routes.ts:234` → `SpeechService.synthesize` (epoch + queue admission, `service.ts:465`) → `synthesizeOne` (`service.ts:853`): `withPlaintext` decrypts the voice to a temp wav (`voice-store.ts:228`) → `ensureWorker` (`service.ts:788`): verify install state → `activateSpeech` → construct `ChatterboxWorkerClient` → client lazily spawns `python -u worker.py`, awaits the `ready` frame (`worker-client.ts:552-599`) → JSON-lines `synthesize` frame in, response frame out (`worker-client.ts:515-550`) → worker writes `outputs/<id>.wav` → TS validates containment + reads the wav defensively (`service.ts:201-278`) → temp plaintext voice and output wav deleted in `ensuring` → bytes returned as `audio/wav`.

**D. CLI STT** — `POST /v1/audio/transcriptions` → bounded multipart → lease check (`helpers.ts:97`) → save upload → ffmpeg transcode if non-WAV (`helpers.ts:131`) → `whisper-cli -m model -f file -nt` (`stt.ts:79`) → output scrubbed by `parseWhisperOutput` → `{ text }`. Temp files cleaned by `Effect.scoped`.

**E. Stop / shutdown** — `POST /v1/audio/runtime/stop` → `SpeechService.stop` (`service.ts:490`, refuses during install) → `stopRuntime` (`service.ts:957`): epoch bump strands queued syntheses → graceful worker `shutdown` frame → 2 s grace → SIGKILL → exit confirmation → lease release → status 200.

## 4. Key patterns & idioms

- **Effect basics a newcomer needs**: an `Effect<A, E, R>` is a lazy description of a computation; routes end in `effectHandler` which runs it. `Effect.gen(function* () { ... })` with `yield*` is do-notation. Errors are typed values in the `E` channel and handled with `Effect.catch`/`Effect.mapError`/`Effect.match`; `Effect.try`/`Effect.tryPromise` wrap throwing/Promise code into typed errors. `Effect.acquireUseRelease`/`Effect.acquireRelease` = bracket/RAII (temp files, vault plaintext, file handles). `Effect.scoped` ties `acquireRelease` cleanups to a request scope. `Semaphore.makeUnsafe(1).withPermit(effect)` is a mutex around an effect. `Deferred` is a one-shot awaitable cell used to bridge Node callbacks into Effect. `Effect.forkDetach` starts a background fiber; `Fiber.interrupt`/`Fiber.await` control it; `Effect.onInterrupt` registers cleanup when a fiber is cancelled; `Effect.ensuring` is `finally`.
- **`Schema.TaggedErrorClass`** — every typed error (`SpeechServiceError`, `VoiceReferenceError`, `VoiceProfileError`, `SttIntegrationError`, …) is a Schema-backed class with a `_tag`, so `instanceof` narrowing works and errors serialize cleanly. Routes map them to `{status, code, message}` HTTP responses in exactly one place per module.
- **Two error shapes**: `{status, code, message}` (speech family, no details) vs `{status, code, message, details}` (stt/tts family, details forwarded to clients). The audio route deliberately strips details for speech errors.
- **Hono wiring**: `documentRoute` attaches OpenAPI metadata; `effectHandler` adapts Effect programs to Hono handlers; `mergeRoutes` chains typed registrars so the app type accumulates routes.
- **Semaphore-per-concern**: `SpeechService` holds four semaphores (`activation`, `synthesis`, `voiceNormalization`, `stopping`) plus `VoiceStore.mutation` and one each inside the runtime and worker client. Concurrency is never managed with ad-hoc locks.
- **Generation counters / epochs**: `synthesisEpoch`, `installGeneration` (twice — service and runtime), and `leaseGeneration` all implement "invalidate stale async work without tracking it individually".
- **Nominal branding**: `SpeechGpuLeaseGuard`'s `unique symbol` brand (`service.ts:83`) makes lease tokens unforgeable at the type level.
- **Defense in depth at trust boundaries**: consent checked in route *and* store; GPU UUID validated in service, client constructor, *and* the Python worker; text length checked in service and worker; output path containment checked in client (`realpathSync`), service (`outputChildPath`), and worker (absolute + must-not-exist). Every layer assumes the layer below it is compromised.
- **Permissions discipline**: everything speech-related is `0700` dirs / `0600` files, `umask 0o077` in the worker, atomic write-then-rename everywhere (vault, install record, normalization output).
- **Untrusted-process hygiene**: bounded frames, bounded stderr, kill-on-timeout, kill-on-protocol-violation, confirmed-exit semantics (`exitConfirmed`), parent-death binding, whitelist environments.

## 5. Connections

**Depends on (incoming imports):**
- `@local-studio/contracts/speech` (`contracts/speech.ts`) — shared constants (`CHATTERBOX_BACKEND`, package version, model revision) and the `SpeechStatus` DTO used by the frontend.
- `../../core/command` — `resolveBinary`, `runCommandAsyncEffect`, `CommandTerminationError`.
- `../../http/{bounded-body, effect-handler, route-registrar}` — request size limiting and Hono/Effect plumbing.
- `../../stores/sqlite` — `openSqliteDatabase` (Bun SQLite).
- `../system/gpu-leases` — `GpuLeaseRegistry` (`claim`/`replace`/`release`/`snapshot`), `GpuLeaseConflict`, `resolveRecipeGpuUuids`.
- `../system/platform/nvidia-compute-processes` — `queryNvidiaComputeGpuUuids` (unmanaged compute detection).
- `../models/types` — `ProcessInfo`, `Recipe`, `GpuInfo`.
- `../../app-context` (audio routes) — the full `AppContext` bag: `config`, `logger`, `processManager`, `speechService`.

**Depended on by:**
- `src/http/app.ts:15-16, 95-96` — registers both route modules.
- `src/app-context.ts:44, 208-221` — constructs `SpeechService` (with `EngineCoordinator` as `SpeechEngineState`, the shared `gpuLeaseRegistry`, `getGpuInfo`, and the shared SQLite `dbPath`) and shuts it down via `Effect.acquireRelease`.
- `src/modules/proxy/openai-routes.ts:10-12` — the only consumer of `services/provider-routing.ts`.
- Nothing outside the slice imports `worker-client.ts`, `runtime.ts`, `voice-*.ts`, `reference-audio.ts`, or `storage.ts` directly — they are private to the speech module, reachable only through `SpeechService`'s defaults.

## 6. How to read this code

Suggested order, building from leaf to coordinator:

1. **`contracts/speech.ts`** (47 lines) — the DTOs and pinned versions everything else references.
2. **`src/modules/speech/storage.ts`** — trivial; establishes the permissions + filename conventions.
3. **`src/modules/speech/worker.py`** — read it as a protocol spec: note the stdout rebinding (`worker.py:24-25`), the parent-death binding (`worker.py:29-54`), and the exact frame shapes in `emit()` calls.
4. **`src/modules/speech/worker-client.ts`** — the hardest file; now you know the protocol it speaks. Read the Schemas (29-82), then `spawnNodeSpeechWorker` (194-286), then the client top-down: `synthesizeEffect` → `readySessionEffect` → `spawnEffect` → `sendRequestEffect` → `receiveLine` (685-730) → shutdown/settle/fail paths (414-509, 742-768).
5. **`src/modules/speech/runtime.ts`** — the installer; focus on the state union (38-53) and `startInstall`/`installEffect` (225-292, 354-488).
6. **`src/modules/speech/voice-vault.ts` → `voice-store.ts` → `reference-audio.ts`** — the voice pipeline: encryption, metadata+consent, upload normalization.
7. **`src/modules/speech/service.ts`** — the coordinator; read the GPU-target/lease section (523-786) slowly, then `synthesizeOne` (853-916), then the stop/quarantine logic (918-1001).
8. **`src/modules/speech/routes.ts`** — now trivial; confirm how errors map to HTTP.
9. **`src/services/stt.ts` → `services/tts.ts` → `src/modules/audio/helpers.ts` → `src/modules/audio/routes.ts`** — the CLI half; much simpler, ends at the `model === "chatterbox-turbo"` dispatch (`routes.ts:234`) that bridges into the managed stack.
10. **`src/services/provider-routing.ts`** — 30 seconds; unrelated to audio, consumed by the OpenAI proxy.

What to look for first in any file here: the **constants block at the top** (limits, timeouts, regexes — the security posture is declared there), the **error class definitions**, and **who owns cleanup** (every temp file / process / lease has exactly one `ensuring`/`acquireUseRelease`/`onInterrupt` that releases it).
