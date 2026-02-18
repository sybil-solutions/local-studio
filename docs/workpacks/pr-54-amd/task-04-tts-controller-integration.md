<!-- CRITICAL -->
# Task 04 — TTS Integration (Controller-Brokered Piper)

## 1) Task Intent

Provide a robust text-to-speech pipeline that converts assistant text into playable audio via controller-managed CLI integration.

This task enables user-initiated playback and serves as a hard dependency for call mode completion loops.

---

## 2) Why This Task Exists

The prototype PR contains working TTS plumbing, but it needs isolated hardening and clean contracts before production merge.

Core problems solved:

- Missing installation/model handling,
- inconsistent response behaviors,
- insufficient lease-conflict UX,
- fragile playback lifecycle in browser UI.

---

## 3) PR Evidence (Source Material)

- `controller/src/routes/audio.ts` (speech route)
- `controller/src/routes/audio.test.ts`
- `controller/src/services/integrations/tts/index.ts`
- `controller/src/services/integrations/tts/piper-adapter.ts`
- `controller/src/services/integrations/tts/types.ts`
- `frontend/src/app/api/voice/speak/route.ts`
- `frontend/src/app/chat/_components/layout/chat-page/use-chat-page-controller.tsx`
- `docs/voice.md`

---

## 4) In Scope

### 4.1 Controller Endpoint

Implement/port:

- `POST /v1/audio/speech`
- JSON input with OpenAI-style shape
- WAV response body (`audio/wav`)

### 4.2 Model Resolution

Model lookup order:

1. request body `model`, else
2. `VLLM_STUDIO_TTS_MODEL`

Path semantics:

- direct path when slash present,
- else resolve under `${VLLM_STUDIO_MODELS_DIR}/tts/<model>`.

### 4.3 Service/Lease Semantics

- start `tts` service before synthesis,
- honor `mode` and `replace`,
- return 409 conflict payload for strict lease failure.

### 4.4 Frontend Playback Wiring

- `/api/voice/speak` relay path with configurable backend target,
- UI “listen” playback for assistant messages,
- reliable cleanup of object URLs and audio handles,
- actionable user error messages on failures.

---

## 5) Out of Scope

- Voice cloning,
- multilingual auto-selection,
- streaming TTS chunk playback,
- SSML support.

---

## 6) Functional Requirements

### FR-01: Input Validation

Endpoint rejects empty/whitespace `input` text with `400`.

### FR-02: Format Support

Only `wav` response format is accepted for this iteration; unsupported formats return `400` with clear reason.

### FR-03: Installation Check

If piper CLI not available, endpoint returns `503` with setup guidance.

### FR-04: Model Existence Validation

Resolved model file must exist before synthesis begins.

### FR-05: Stable Binary Response

Successful synthesis returns binary WAV response with `Content-Type: audio/wav`.

---

## 7) Non-Functional Requirements

- **Reliability:** no resource leaks in browser playback path,
- **Isolation:** CLI execution failures contained to request scope,
- **Latency-aware UX:** clear “busy/error” states for speech requests.

---

## 8) Detailed Implementation Plan

### 8.1 Controller Route

1. Parse JSON body.
2. Validate required input and supported format.
3. Resolve model path and verify existence.
4. Start `tts` service with lease semantics.
5. Execute piper adapter into temp WAV file.
6. Return WAV bytes response.

### 8.2 TTS Adapter

1. Resolve binary path (`VLLM_STUDIO_TTS_CLI` or PATH).
2. Execute synthesis with explicit args (no shell interpolation).
3. Validate output file exists and is readable.

### 8.3 Frontend Route + UI

1. Proxy request from `/api/voice/speak` to selected backend target.
2. In chat controller:
   - fetch audio blob,
   - create object URL,
   - play with browser audio API,
   - cleanup in `onended/onerror/stop` paths.
3. Show lease conflict warnings and hard failures via toasts.

---

## 9) API Contract

### Request

`POST /v1/audio/speech`

```json
{
  "model": "en_US-amy-medium.onnx",
  "input": "hello",
  "response_format": "wav",
  "mode": "strict",
  "replace": false
}
```

### Success

- HTTP 200
- Body: WAV bytes
- Header: `Content-Type: audio/wav`

### Conflict

- HTTP 409
- `gpu_lease_conflict` payload with actions.

---

## 10) Test Plan

### 10.1 Controller Tests

- missing `input`,
- unsupported format,
- missing model/binary,
- strict conflict,
- successful WAV response.

### 10.2 Frontend Tests

- voice target routing,
- listen button behavior,
- playback cleanup and failure paths.

### 10.3 E2E

- assistant response listen button appears and playback path executes in deterministic test mode.

---

## 11) Rollout Notes

- Deploy with docs for piper setup and model placement,
- validate on both single-backend and split-backend configurations,
- monitor 409 conflict frequency to tune UX defaults.

---

## 12) Risks and Mitigations

- **Risk:** stale object URL/audio leaks in browser.
  - **Mitigation:** centralized cleanup helper + tests.
- **Risk:** long synthesis times perceived as failures.
  - **Mitigation:** visible loading and timeout/error messaging.
- **Risk:** model mismatch confusion.
  - **Mitigation:** strict model path checks and clear error text.

---

## 13) Definition of Done

- [ ] `/v1/audio/speech` is validated, lease-aware, and returns WAV
- [ ] Chat listen action is stable with proper cleanup
- [ ] 409 conflicts surface actionable choices
- [ ] Test coverage added for controller + frontend behavior
- [ ] Lint/build/typecheck pass cleanly
