<!-- CRITICAL -->
# Task 03 — STT Integration (Controller-Brokered Whisper.cpp)

## 1) Task Intent

Deliver a production-ready speech-to-text path using controller-managed CLI integration, with lease-aware behavior and stable browser upload handling.

The goal is to make STT work reliably in both manual voice input and call mode prerequisites.

---

## 2) Why This Task Exists

PR #54 includes STT functionality, but it is embedded in a broader prototype and needs to be isolated for quality, security, and operability.

Key problems this task addresses:

- Browser recording formats are not always directly consumable by STT backend,
- Missing model/tool setup yields poor diagnostics,
- GPU lease conflicts need explicit user-actionable handling,
- Split backend topologies (voice backend separate from LLM backend) need clear routing.

---

## 3) PR Evidence (Source Material)

- `controller/src/routes/audio.ts` (transcriptions route)
- `controller/src/routes/audio.test.ts`
- `controller/src/services/integrations/stt/index.ts`
- `controller/src/services/integrations/stt/whispercpp-adapter.ts`
- `controller/src/services/integrations/stt/types.ts`
- `controller/src/services/integrations/cli/cli-runner.ts`
- `frontend/src/app/api/voice/transcribe/route.ts`
- `frontend/src/app/api/voice/voice-target.ts`
- `frontend/src/lib/audio/decode.ts`
- `frontend/src/lib/audio/wav.ts`
- `docs/voice.md`

---

## 4) In Scope

### 4.1 Controller Endpoint

Implement/port:

- `POST /v1/audio/transcriptions`
- Input: multipart form with `file`
- Optional fields: `model`, `language`, `mode`, `replace`
- Output: `{ text: string }`

### 4.2 Model Resolution

Model path resolution rules:

1. explicit request `model`, else
2. env fallback `VLLM_STUDIO_STT_MODEL`

Path resolution:

- if model includes slash => treat as direct path,
- else resolve under `${VLLM_STUDIO_MODELS_DIR}/stt/<model>`.

### 4.3 Audio Format Robustness

- Accept non-WAV uploads from browser recording,
- transcode to mono 16k WAV via `ffmpeg` when needed,
- fail with actionable error if `ffmpeg` is unavailable and non-WAV input is provided.

### 4.4 Lease Handling

Before STT execution:

- call service manager start for `stt` with mode semantics,
- return `409` with `gpu_lease_conflict` payload when strict mode cannot acquire lease.

### 4.5 Frontend Relay Path

- Route `/api/voice/transcribe` to resolved voice target,
- support external voice URL and controller-local voice endpoint,
- avoid injecting incorrect default model for controller-local mode.

---

## 5) Out of Scope

- Streaming partial transcript tokens,
- speaker diarization,
- semantic post-processing of transcripts,
- cloud speech providers.

---

## 6) Functional Requirements

### FR-01: Installation Check

If STT CLI binary is missing (`whisper-cli` or configured path), endpoint returns clear `503` with setup guidance.

### FR-02: Input Validation

Request must fail with `400` for:

- missing `file`,
- missing model after fallback resolution,
- non-existent resolved model file.

### FR-03: Deterministic File Handling

Uploaded files must be written to temporary data directory under controller data root; temporary naming must avoid collisions.

### FR-04: Format Conversion Behavior

If input is non-WAV:

- attempt ffmpeg conversion,
- on failure return explicit conversion error and captured CLI details.

### FR-05: Result Contract

On success, response JSON must include non-empty `text` string.

---

## 7) Non-Functional Requirements

- **Timeout safety:** transcription call should have bounded execution timeout.
- **Fault isolation:** CLI failures must not crash process.
- **Security:** do not execute untrusted shell interpolation; use argument arrays.
- **Traceability:** include enough error details for operator debugging.

---

## 8) Detailed Implementation Plan

### 8.1 Controller Route

1. Validate multipart payload and required fields.
2. Resolve model path.
3. Save upload into temp path.
4. If needed, transcode with ffmpeg to WAV.
5. Start `stt` service using `mode/replace` semantics.
6. Invoke STT adapter with resolved model and audio path.
7. Return normalized JSON response.

### 8.2 STT Adapter

1. Validate binary availability.
2. Build CLI args for whisper.cpp adapter.
3. Parse output into text response.
4. Surface errors with context.

### 8.3 Frontend API Route

1. Resolve voice target (`voiceUrl` or backend fallback).
2. Forward multipart request body.
3. Inject model only when target is external voice backend.
4. Forward conflict and error payloads unchanged where feasible.

---

## 9) API Contract

### Request

`POST /v1/audio/transcriptions` (multipart/form-data)

Fields:

- `file` (required)
- `model` (optional)
- `language` (optional)
- `mode` (`strict` default, `best_effort` optional)
- `replace` (`1|true` optional)

### Success

```json
{ "text": "..." }
```

### Conflict (Strict Lease)

```json
{
  "code": "gpu_lease_conflict",
  "requested_service": { "id": "stt" },
  "holder_service": { "id": "llm" },
  "actions": ["replace", "best_effort"]
}
```

---

## 10) Test Plan

### 10.1 Controller Unit/Route Tests

- missing file/model validation,
- missing model file path,
- non-WAV transcode success and failure,
- strict lease conflict response,
- successful transcription payload.

### 10.2 Frontend Tests

- voice target resolution logic,
- model injection policy for external vs controller target,
- relay error passthrough.

### 10.3 E2E Dependencies

- fake mic path for deterministic browser automation,
- stable STT response path in CI.

---

## 11) Operational Notes

Required env vars for bring-up:

- `VLLM_STUDIO_STT_CLI`
- `VLLM_STUDIO_STT_MODEL`
- `VLLM_STUDIO_MODELS_DIR`

Optional:

- `VLLM_STUDIO_STT_BACKEND`

---

## 12) Risks and Mitigations

- **Risk:** ffmpeg absent on host.
  - **Mitigation:** explicit error text + docs + optional WAV-only fallback policy.
- **Risk:** slow transcode/transcribe under load.
  - **Mitigation:** timeout controls and telemetry.
- **Risk:** user-provided model mismatch.
  - **Mitigation:** strict model file existence checks.

---

## 13) Definition of Done

- [ ] `/v1/audio/transcriptions` is stable and lease-aware
- [ ] Browser non-WAV uploads are handled robustly
- [ ] Frontend relay path supports split voice backend
- [ ] Tests cover validation, conflict, and success scenarios
- [ ] Lint/build/typecheck pass cleanly
