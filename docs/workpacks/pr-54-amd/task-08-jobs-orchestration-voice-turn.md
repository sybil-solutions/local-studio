<!-- CRITICAL -->
# Task 08 — Jobs & Orchestration Vertical Slice (Voice Assistant Turn)

## 1) Task Intent

Introduce durable multi-step job orchestration with a concrete workflow (`voice_assistant_turn`) that can run via Temporal when available and fall back to in-memory execution when not.

This task provides the orchestration substrate for future multi-modality pipelines.

---

## 2) Why This Task Exists

PR #54 adds jobs/services/orchestration concepts in a broad prototype. We need one narrowly scoped, production-quality vertical slice proving:

- durable job lifecycle,
- progress/log visibility,
- orchestrator abstraction,
- practical workflow behavior.

---

## 3) PR Evidence (Source Material)

- `controller/src/routes/jobs.ts`
- `controller/src/routes/jobs.test.ts`
- `controller/src/services/jobs/job-manager.ts`
- `controller/src/services/jobs/auto-orchestrator.ts`
- `controller/src/services/jobs/memory-orchestrator.ts`
- `controller/src/services/jobs/temporal-orchestrator.ts`
- `controller/src/services/jobs/job-reporter.ts`
- `controller/src/services/jobs/orchestrator.ts`
- `controller/src/workflows/voice-assistant-turn.ts`
- `controller/src/activities/voice-assistant.ts`
- `controller/src/stores/job-store.ts`
- `frontend/src/app/jobs/page.tsx`
- `frontend/src/components/jobs/jobs-panel.tsx`
- `frontend/src/lib/api/jobs.ts`
- `docs/orchestration.md`

---

## 4) In Scope

### 4.1 Jobs API

Implement/port:

- `GET /jobs`
- `GET /jobs/:jobId`
- `POST /jobs` (currently only `voice_assistant_turn`)

### 4.2 Durable Job Store

Persist job records with:

- id/type/status/progress,
- input/output/error,
- timestamps,
- log trail.

### 4.3 Orchestrator Abstraction

Support orchestrator modes:

- `temporal` (preferred when reachable),
- `memory` fallback,
- `auto` selection semantics.

### 4.4 Workflow: `voice_assistant_turn`

Pipeline stages:

1. optional STT (audio input path),
2. LLM completion,
3. optional TTS synthesis.

### 4.5 Frontend Jobs UI

- basic job creation form for voice turn,
- realtime jobs panel showing status/progress/logs.

---

## 5) Out of Scope

- generic DAG builder,
- workflow composition UI,
- retry policy editor,
- cross-tenant isolation controls.

---

## 6) Functional Requirements

### FR-01: Job Creation Contract

`POST /jobs` must validate payload and reject unsupported `type` values.

### FR-02: Job State Progression

Jobs transition through lifecycle states with monotonic progress updates and terminal status (`completed|failed|cancelled`).

### FR-03: Activity Logging

Workflow activities append meaningful operational logs to job record for troubleshooting.

### FR-04: Orchestrator Fallback

If Temporal is unavailable and mode is auto, job still executes via memory orchestrator.

### FR-05: Realtime Visibility

Jobs updates are surfaced to frontend via event stream/store integration.

---

## 7) Non-Functional Requirements

- **Durability:** job state survives controller restarts where durable store is used.
- **Determinism:** workflow progress semantics predictable across orchestrators.
- **Observability:** logs and error payloads sufficient for diagnosis.

---

## 8) Detailed Implementation Plan

### 8.1 Job Manager + Store

1. Implement create/get/list APIs against store.
2. Enforce type validation and input normalization.
3. Persist updates from reporter/activity hooks.

### 8.2 Orchestrator Layer

1. Define orchestrator interface.
2. Implement memory orchestrator baseline.
3. Implement Temporal client/worker orchestration path.
4. Implement auto selector logic and status reporting.

### 8.3 Voice Workflow Activities

1. Decode/prepare optional audio input.
2. Run STT adapter when needed.
3. Call LLM manager for response text.
4. Run TTS adapter when requested.
5. Emit progress and logs at each stage.

### 8.4 Jobs Routes

1. Bind create/list/get routes.
2. Start workflow from create route.
3. Return current job representation after start.

### 8.5 Frontend Jobs Page

1. Provide minimal voice job start form.
2. Display jobs table/panel with recent logs and progress.
3. Integrate with realtime status store jobs slice.

---

## 9) API Contract

### Create Job

`POST /jobs`

```json
{
  "type": "voice_assistant_turn",
  "input": {
    "text": "Hello",
    "tts_model": "en_US-amy.onnx"
  }
}
```

### List Jobs

`GET /jobs` → `{ "jobs": [...] }`

### Get Job

`GET /jobs/:id` → `{ "job": {...} }`

Job record includes:

- `id`, `type`, `status`, `progress`,
- `input`, `result`, `error`,
- `logs[]`, `created_at`, `updated_at`.

---

## 10) Test Plan

### 10.1 Controller Tests

- route validation for unsupported types,
- create/list/get correctness,
- workflow reaches terminal states,
- orchestrator fallback behavior.

### 10.2 Integration Tests

- mocked STT/TTS + mock inference path for deterministic completion,
- progress/log updates emitted during run.

### 10.3 Frontend Tests

- jobs panel rendering,
- progress/status formatting,
- live list updates from store.

---

## 11) Rollout Notes

- ship as an explicit “vertical slice” label,
- keep supported job types constrained to avoid premature expansion,
- capture operational metrics before adding more workflow types.

---

## 12) Risks and Mitigations

- **Risk:** Temporal connectivity issues during startup.
  - **Mitigation:** clear auto fallback + health reporting.
- **Risk:** drift between memory and temporal behavior.
  - **Mitigation:** shared workflow contract and common tests.
- **Risk:** unbounded logs growth.
  - **Mitigation:** cap stored logs per job or apply truncation policy.

---

## 13) Definition of Done

- [ ] Jobs create/list/get endpoints are stable
- [ ] `voice_assistant_turn` workflow completes across orchestrators
- [ ] Durable job state + logs/progress are persisted and visible
- [ ] Frontend jobs page/panel show live state updates
- [ ] Tests cover lifecycle and fallback semantics
- [ ] Lint/build/typecheck pass cleanly
