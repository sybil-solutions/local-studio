<!-- CRITICAL -->
# Work Pack: PR #54 ("Amd") Recovery + Scoped Delivery Plan

## Source PR (Recovered)

- **PR**: https://github.com/0xSero/vllm-studio/pull/54
- **Title**: `Amd`
- **Branch recovered locally**: `pr-54-amd`
- **Head commit**: `846da804e1491cd9067d3dfb28ae4ea3091d6bd3`
- **Size**: 196 files, 55 commits, +13,559 / -374

This PR is a large prototype branch combining multiple initiatives into one stream.

---

## Total Scope (Program-Level)

Deliver a **multi-modality local AI runtime platform** that:

1. Runs reliably on **AMD/ROCm** (and still works on CUDA/NVIDIA),
2. Adds **voice in/out** (STT + TTS),
3. Adds **image generation** as a managed modality,
4. Enables **call mode** (hands-free turn loop),
5. Adds **runtime visibility/telemetry surfaces** (platform, services, leases, status; charting-ready),
6. Supports **service orchestration** and split topologies (LLM host vs voice/media host).

The PR proves feasibility, but it is too broad to ship as-is. We should split it into isolated, production-grade tracks.

---

## Delivery Strategy

- One subject area per task.
- Each task must be independently testable and releasable.
- Integrate from `pr-54-amd` by **selective cherry-pick/file-port**, not full merge.
- Keep strict CI gates per repo policy (frontend lint/build + controller typecheck).

---

## Task 1 — AMD/ROCm Platform Integration (Foundational)

### Objective
Make AMD/ROCm a first-class runtime platform for detection, GPU telemetry, compatibility diagnostics, and operator UX.

### PR Evidence
- `controller/src/services/amd-gpu.ts`
- `controller/src/services/rocm-info.ts`
- `controller/src/services/runtime-info.ts`
- `controller/src/services/compatibility-report.ts`
- `controller/src/routes/system.ts`, `controller/src/routes/runtime.ts`, `controller/src/routes/system-openapi.ts`
- `frontend/src/components/compatibility/compatibility-panel.tsx`
- `frontend/src/components/dashboard/control-panel/status-line.tsx`
- `docs/rocm-mi300x-playbook.md`

### Detailed Scope
1. Add dual-tool ROCm telemetry support:
   - `amd-smi` JSON parsing (`metric`, `static`)
   - `rocm-smi` text fallback parsing
2. Add runtime platform detection model:
   - `platform.kind` = `cuda | rocm | unknown`
   - infer via `VLLM_STUDIO_GPU_SMI_TOOL`, torch build metadata, and available binaries
3. Add runtime metadata to config/compat surfaces:
   - ROCm version, HIP version, torch HIP/CUDA fields
   - selected monitoring tool and availability
4. Add `/compat` compatibility checks with explicit operator actions:
   - missing HIP torch build on ROCm
   - missing monitoring tooling
   - inference port conflict
   - no backend installed
5. Frontend display:
   - platform indicator in dashboard
   - compatibility panel warnings/errors with evidence/fix guidance

### Acceptance Criteria
- On ROCm host, `/config` and `/compat` report `platform.kind=rocm` and non-empty ROCm metadata (best effort).
- `/gpus` returns AMD metrics using `amd-smi` or `rocm-smi` fallback.
- Dashboard shows `platform: rocm`.
- Compatibility panel renders actionable checks.
- Tests present for parsers + compatibility checks + dashboard platform rendering.

### Out of Scope
- ROCm performance tuning/benchmarking.
- Automatic driver/tool installation.

---

## Task 2 — Cross-Vendor Device Visibility + Runtime Env Normalization

### Objective
Normalize device-selection behavior so recipes work consistently across CUDA and ROCm.

### PR Evidence
- `controller/src/services/process-utilities.ts`
- `controller/src/tests/build-environment-visible-devices.test.ts`
- `frontend/src/app/recipes/recipe-utils.ts`
- `frontend/src/app/recipes/recipe-command.ts`

### Detailed Scope
1. Support `visible_devices` as canonical recipe input.
2. Map env vars by detected platform:
   - CUDA: `CUDA_VISIBLE_DEVICES`
   - ROCm: `HIP_VISIBLE_DEVICES` + `ROCR_VISIBLE_DEVICES`
   - Unknown: set all for pragmatic compatibility
3. Preserve explicit overrides for `hip_visible_devices` and `rocr_visible_devices`.
4. Hide internal env keys from command preview serialization while preserving persistence behavior.

### Acceptance Criteria
- Unit tests verify env projection across platform modes.
- Recipe editor accepts legacy aliases and normalizes to current format.

### Out of Scope
- Multi-node distributed scheduler integration.

---

## Task 3 — STT Service (Controller-Brokered Whisper.cpp)

### Objective
Ship production-grade speech-to-text endpoint and UI path with deterministic behavior and lease-aware semantics.

### PR Evidence
- `controller/src/routes/audio.ts` (`POST /v1/audio/transcriptions`)
- `controller/src/services/integrations/stt/*`
- `frontend/src/app/api/voice/transcribe/route.ts`
- `frontend/src/lib/audio/decode.ts`, `frontend/src/lib/audio/wav.ts`
- `docs/voice.md`

### Detailed Scope
1. Controller endpoint:
   - multipart file upload
   - model resolution via request or `VLLM_STUDIO_STT_MODEL`
   - optional `mode` + `replace` for lease conflict handling
2. Input normalization:
   - WAV preferred
   - ffmpeg transcode fallback for browser-recorded media
3. Frontend transcription route:
   - resolve target backend/voice backend
   - avoid injecting incompatible default model when using controller-local model files
4. Reliability:
   - timeout + abort behavior
   - clear error surfaces for missing model/tooling

### Acceptance Criteria
- STT succeeds for WAV and browser-recorded audio.
- 409 lease conflicts surfaced with typed payload.
- Deterministic E2E mode supported for CI.

### Out of Scope
- Streaming partial STT hypotheses.
- Diarization / speaker segmentation.

---

## Task 4 — TTS Service (Controller-Brokered Piper)

### Objective
Ship text-to-speech endpoint and chat playback plumbing, including conflict handling and user-facing controls.

### PR Evidence
- `controller/src/routes/audio.ts` (`POST /v1/audio/speech`)
- `controller/src/services/integrations/tts/*`
- `frontend/src/app/api/voice/speak/route.ts`
- `frontend/src/app/chat/_components/layout/chat-page/use-chat-page-controller.tsx`
- `docs/voice.md`

### Detailed Scope
1. Controller endpoint:
   - OpenAI-style TTS request body
   - model resolution via request or `VLLM_STUDIO_TTS_MODEL`
   - WAV response transport
2. Frontend speech relay:
   - backend target resolution
   - binary response playback
3. Chat UX:
   - per-message “listen” action
   - robust playback cleanup and error handling

### Acceptance Criteria
- TTS endpoint returns playable WAV for configured voice model.
- UI listen button works for assistant responses.
- Lease conflicts produce user-actionable warning path.

### Out of Scope
- Voice cloning / multi-speaker synthesis.

---

## Task 5 — Call Mode (Hands-Free STT→LLM→TTS Loop)

### Objective
Add end-to-end conversational call mode that continuously records, transcribes, sends, speaks, and resumes listening.

### PR Evidence
- `frontend/src/app/chat/_components/input/tool-belt.tsx`
- `frontend/src/app/chat/_components/input/tool-belt-toolbar.tsx`
- `frontend/src/app/chat/_components/layout/chat-page/use-chat-page-controller.tsx`
- `frontend/tests/voice-call-mode-proof.spec.ts`

### Detailed Scope
1. UX controls:
   - call mode toggle (requires model selected)
   - recording/transcribing indicators
2. Auto-stop logic:
   - silence detection in call mode
   - max recording window guardrails
3. Turn loop:
   - STT transcript auto-send
   - assistant response TTS auto-play
   - post-playback mic re-open
4. Safety:
   - duplicate transcript guard
   - non-blocking behavior if TTS fails
   - E2E fake mic path for deterministic tests

### Acceptance Criteria
- User can run a full hands-free voice turn loop.
- Call mode recovers gracefully from STT/TTS failures.
- Playwright proof test is stable in CI.

### Out of Scope
- WebRTC low-latency duplex calling.
- Interruptible barge-in semantics.

---

## Task 6 — Image Generation Modality (Service + UI)

### Objective
Deliver controller-brokered image generation as a first-class, lease-aware modality.

### PR Evidence
- `controller/src/routes/images.ts` (`POST /v1/images/generations`)
- `controller/src/services/integrations/image/*`
- `frontend/src/app/images/page.tsx`
- `docs/image-generation.md`

### Detailed Scope
1. OpenAI-style image generation endpoint with base64 output.
2. Stable-diffusion CLI adapter execution + artifact storage.
3. Service lease semantics:
   - strict conflict mode with 409
   - replace/best-effort choices from UI modal
4. Simple operator UI for prompt + model + result preview.

### Acceptance Criteria
- Endpoint generates image and returns `b64_json`.
- UI can generate and render image output.
- Lease conflict path works with replace/best-effort flows.

### Out of Scope
- Advanced canvas editing / inpainting UI.
- Batch pipelines and queue prioritization.

---

## Task 7 — Runtime Telemetry Surfaces + Charting-Ready Data Plane

### Objective
Create a consistent telemetry/event layer that supports dashboard status now and charting extensions next.

### PR Evidence
- `controller/src/services/event-manager.ts` (`runtime_summary`)
- `controller/src/metrics-collector.ts`
- `frontend/src/hooks/use-controller-events.ts`
- `frontend/src/hooks/realtime-status-store.ts`
- `frontend/src/components/dashboard/control-panel/*`

### Detailed Scope
1. Add low-frequency `runtime_summary` SSE event.
2. Wire frontend realtime store for:
   - platform summary
   - services list
   - GPU lease state
   - jobs list
3. Dashboard updates:
   - platform chip
   - services/runtimes panel
   - lease holder visibility
4. Define charting contract:
   - event schema for timeseries snapshots
   - retention window + sampling cadence (follow-up implementation)

### Acceptance Criteria
- SSE `runtime_summary` reaches frontend store and UI.
- Fallback poll path still hydrates summary when SSE is blocked.
- Tests cover event dispatch/store update path.

### Out of Scope
- Full historical chart UI implementation (new task after schema freeze).

---

## Task 8 — Jobs/Orchestration Vertical Slice (Voice Assistant Turn)

### Objective
Ship durable job orchestration for multi-step modalities, starting with one concrete workflow.

### PR Evidence
- `controller/src/routes/jobs.ts`
- `controller/src/services/jobs/*`
- `controller/src/workflows/voice-assistant-turn.ts`
- `controller/src/activities/voice-assistant.ts`
- `docs/orchestration.md`
- `frontend/src/app/jobs/page.tsx`, `frontend/src/components/jobs/jobs-panel.tsx`

### Detailed Scope
1. Jobs API:
   - create/list/get job records
2. Orchestration backends:
   - Temporal when available
   - in-memory fallback
3. Initial workflow: `voice_assistant_turn`
   - optional STT
   - LLM run
   - optional TTS
4. Frontend jobs panel:
   - live status/progress/log tail from realtime updates

### Acceptance Criteria
- Jobs can be created and progress to terminal state.
- Status is durable in store and visible in UI.
- Temporal and memory orchestrators both pass tests.

### Out of Scope
- Arbitrary DAG builder.
- Multi-tenant workflow isolation.

---

## Recommended Rollout Order

1. Task 1 (AMD/ROCm)
2. Task 2 (env normalization)
3. Task 7 (telemetry backbone)
4. Task 3 (STT)
5. Task 4 (TTS)
6. Task 5 (call mode)
7. Task 6 (image generation)
8. Task 8 (jobs/orchestration)

This order minimizes integration risk and gives us platform confidence before modality expansion.
