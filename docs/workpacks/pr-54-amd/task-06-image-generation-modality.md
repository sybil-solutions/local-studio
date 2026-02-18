<!-- CRITICAL -->
# Task 06 — Image Generation Modality (Controller + UI)

## 1) Task Intent

Ship image generation as a first-class modality through an OpenAI-style API surface, controller-managed integration adapter, and operator-facing UI.

This task expands beyond text/voice into visual generation while preserving lease safety.

---

## 2) Why This Task Exists

PR #54 includes viable image generation plumbing but bundled with unrelated features. We need an isolated production task that can be released independently and tested thoroughly.

---

## 3) PR Evidence (Source Material)

- `controller/src/routes/images.ts`
- `controller/src/routes/images.test.ts`
- `controller/src/services/integrations/image/index.ts`
- `controller/src/services/integrations/image/stable-diffusion-cpp-adapter.ts`
- `controller/src/services/integrations/image/types.ts`
- `frontend/src/app/images/page.tsx`
- `frontend/src/lib/api/images.ts`
- `docs/image-generation.md`

---

## 4) In Scope

### 4.1 Controller API Endpoint

Implement/port:

- `POST /v1/images/generations`
- OpenAI-like response shape with `data[].b64_json`

### 4.2 Model Resolution and Adapter Execution

- Resolve image model via request `model` or env fallback `VLLM_STUDIO_IMAGE_MODEL`.
- Execute stable-diffusion CLI adapter with explicit parameters.
- Persist output image artifact and return base64 payload.

### 4.3 Lease-Aware Service Start

Before generation:

- start `image` service via service manager,
- honor strict/best_effort modes,
- return 409 lease conflict payload for strict conflicts.

### 4.4 Frontend Image Page

Provide minimal but production-safe page:

- prompt input,
- optional model input,
- generate action,
- result preview,
- conflict modal with replace/best-effort options.

---

## 5) Out of Scope

- Inpainting/outpainting,
- multi-image batch jobs,
- prompt history and gallery system,
- advanced parameter UI (samplers, CFG tuning, etc.) beyond baseline request fields.

---

## 6) Functional Requirements

### FR-01: Request Validation

Reject invalid requests with `400`:

- missing prompt,
- missing resolved model,
- model path not found.

### FR-02: Parameter Support

Support core generation parameters:

- `prompt`,
- `negative_prompt` (optional),
- `width`, `height`,
- `steps`,
- `seed` (optional),
- `mode`, `replace` (for lease semantics).

### FR-03: Output Contract

Return JSON payload:

- `created` (unix timestamp),
- `data` array with one object containing `b64_json` string.

### FR-04: Conflict Handling

Strict lease conflicts return standardized `gpu_lease_conflict` payload with actionable modes.

### FR-05: UI Conflict Actions

Image UI must provide:

- cancel,
- replace current lease holder,
- best-effort attempt.

---

## 7) Non-Functional Requirements

- **Reliability:** output file handling must be atomic enough for request scope.
- **Safety:** adapter invocation uses argument arrays, no shell string injection.
- **Operator clarity:** errors show whether failure is model, lease, or execution related.

---

## 8) Detailed Implementation Plan

### 8.1 Controller Route

1. Parse and validate JSON body.
2. Resolve model path and verify existence.
3. Acquire/start `image` service with provided mode flags.
4. Generate artifact path under data artifacts directory.
5. Execute image adapter and read result bytes.
6. Encode bytes as base64 and return OpenAI-like response.

### 8.2 Image Adapter

1. Resolve CLI binary (`VLLM_STUDIO_IMAGE_CLI` / PATH).
2. Build deterministic CLI args from request options.
3. Enforce timeout and return clear errors.

### 8.3 Frontend Page

1. Build simple generation form.
2. Track busy/error/result states.
3. Integrate GPU lease modal and retry actions.

---

## 9) API Contract

### Request

`POST /v1/images/generations`

```json
{
  "model": "model.gguf",
  "prompt": "a clean technical diagram",
  "negative_prompt": "blurry",
  "width": 1024,
  "height": 1024,
  "steps": 30,
  "seed": 12345,
  "mode": "strict",
  "replace": false
}
```

### Success

```json
{
  "created": 1739160000,
  "data": [{ "b64_json": "..." }]
}
```

### Conflict

- HTTP 409, `gpu_lease_conflict` payload.

---

## 10) Test Plan

### 10.1 Controller Tests

- request validation,
- model path resolution,
- successful base64 response shape,
- strict conflict response and payload.

### 10.2 Frontend Tests

- generate button flow,
- error rendering,
- lease modal action path handling.

### 10.3 E2E/Smoke

- end-to-end generate on known model,
- image preview renders from base64 response.

---

## 11) Rollout Notes

- launch with minimal UI (operator oriented),
- gate larger UX investments until API/adapter stability is proven,
- monitor lease conflict rates and generation failures.

---

## 12) Risks and Mitigations

- **Risk:** model/CLI incompatibility.
  - **Mitigation:** baseline known-good model recommendation in docs.
- **Risk:** large base64 payload pressure.
  - **Mitigation:** start with single-image response; plan artifact URL mode later.
- **Risk:** GPU contention with LLM.
  - **Mitigation:** mandatory lease path and explicit replace/best-effort options.

---

## 13) Definition of Done

- [ ] `/v1/images/generations` implemented with validation and lease semantics
- [ ] Adapter execution stable with deterministic output contract
- [ ] Image page supports generate + conflict actions + preview
- [ ] Tests cover route and UI core behavior
- [ ] Lint/build/typecheck pass cleanly
