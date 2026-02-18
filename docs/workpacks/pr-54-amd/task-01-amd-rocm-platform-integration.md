<!-- CRITICAL -->
# Task 01 — AMD/ROCm Platform Integration (Foundational)

## 1) Task Intent

Make AMD/ROCm a first-class runtime target in vLLM Studio so operators can:

- Detect platform capabilities deterministically,
- Collect GPU telemetry from ROCm-native tools,
- Understand compatibility failures from one place,
- See platform/runtime status in the dashboard without guessing.

This is the base dependency for every other modality task in this work pack.

---

## 2) Why This Task Exists

The upstream PR (`#54`, branch `amd`) mixes many features together. AMD support exists in that branch, but as part of a broad prototype. We need a production-grade, isolated task that can ship independently.

Without this task, the system suffers from:

- Ambiguous platform detection (`cuda` vs `rocm` vs unknown),
- Weak diagnostics when ROCm setup is incomplete,
- Inconsistent dashboard observability,
- Fragile operator experience during bring-up.

---

## 3) PR Evidence (Source Material)

Primary files from PR #54:

- `controller/src/services/amd-gpu.ts`
- `controller/src/services/rocm-info.ts`
- `controller/src/services/runtime-info.ts`
- `controller/src/services/compatibility-report.ts`
- `controller/src/routes/system.ts`
- `controller/src/routes/runtime.ts`
- `controller/src/routes/system-openapi.ts`
- `controller/src/routes/system-gpus-amd.test.ts`
- `controller/src/services/amd-gpu.test.ts`
- `controller/src/services/rocm-info.test.ts`
- `controller/src/tests/runtime-platform.test.ts`
- `controller/src/tests/compatibility-report.test.ts`
- `frontend/src/components/compatibility/compatibility-panel.tsx`
- `frontend/src/components/dashboard/control-panel/status-line.tsx`
- `frontend/tests/rocm-dashboard-platform.spec.ts`
- `docs/rocm-mi300x-playbook.md`

---

## 4) In Scope

### 4.1 Platform Detection

Implement deterministic platform classification:

- `platform.kind` values: `"cuda" | "rocm" | "unknown"`
- Detection priority:
  1. Explicit override (`VLLM_STUDIO_GPU_SMI_TOOL`),
  2. Torch build info (`torch.version.hip` / `torch.version.cuda`),
  3. Available binaries (`nvidia-smi`, `amd-smi`, `rocm-smi`).

### 4.2 ROCm Telemetry Collection

Support dual AMD telemetry paths:

- Primary: `amd-smi` JSON (`metric --json`, `static --json`)
- Fallback: `rocm-smi` text parsing

Normalize telemetry into existing `GpuInfo` shape:

- index, name,
- memory total/used/free (bytes + MB),
- utilization,
- temperature,
- power draw/limit.

### 4.3 Runtime Metadata and Compatibility

Expose runtime details through controller surfaces:

- ROCm version (`/opt/rocm/.info/version*` best effort),
- HIP version (`hipcc --version` parsing),
- GPU arch from `rocminfo` (`gfx*` list),
- Torch build metadata,
- Monitoring tool availability and chosen tool.

Generate `/compat` report with actionable checks and suggested fixes.

### 4.4 UI Surfaces

Render platform and compatibility information in frontend:

- Dashboard status line platform chip (`platform: rocm`),
- Config compatibility panel warnings/errors.

---

## 5) Out of Scope

- ROCm driver/package installation automation,
- Performance benchmarking/tuning,
- Multi-node AMD cluster orchestration,
- Model selection policy.

---

## 6) Functional Requirements

### FR-01: ROCm Tool Resolution

Controller must resolve ROCm monitoring tool in this order:

1. `VLLM_STUDIO_GPU_SMI_TOOL` if set to `amd-smi` or `rocm-smi`,
2. `amd-smi` on PATH (or `AMD_SMI_PATH`),
3. `rocm-smi` on PATH (or `ROCM_SMI_PATH`),
4. otherwise `null`.

### FR-02: `amd-smi` Parser

Given valid JSON payloads, parser must extract:

- market name,
- VRAM total/used/free,
- gfx activity,
- hotspot/edge temp,
- socket power.

If malformed JSON or unexpected shape is returned, parser must fail gracefully with empty list.

### FR-03: `rocm-smi` Parser Fallback

Text parser must parse common line format:

- `GPU[n]: label: value`

Support units conversion for `B/KB/MB/GB/TB` (and `KiB/MiB/GiB/TiB`).

### FR-04: `/compat` Check Semantics

Compatibility report must include checks for:

- no GPUs detected,
- ROCm platform but torch HIP missing (error),
- GPU monitoring unavailable for detected platform (warn),
- inference port in use by unknown process (error),
- no inference backend installed (info).

Each check includes:

- stable check id,
- severity,
- message,
- evidence,
- suggested fix.

### FR-05: Dashboard Platform Display

When realtime store receives `runtime_summary` or `/compat` fallback data, dashboard shows platform label and remains stable across reconnects.

---

## 7) Non-Functional Requirements

- **Resilience:** failures in telemetry collection must not crash the controller.
- **Latency:** runtime summary gathering must be best-effort and non-blocking for critical APIs.
- **Portability:** support Linux variations where ROCm version files differ.
- **Observability:** log enough diagnostic metadata to troubleshoot missing telemetry.

---

## 8) Detailed Implementation Plan

### 8.1 Controller — Telemetry Service Layer

1. Introduce/port `amd-gpu.ts` parser and collectors.
2. Wire collector into existing GPU service selection logic.
3. Guard external command execution with timeouts and empty-result fallback.
4. Preserve existing NVIDIA behavior unchanged.

### 8.2 Controller — Runtime Info and Compatibility

1. Port `rocm-info.ts` and `torch-info.ts` integration points.
2. Extend `runtime-info.ts` to produce `platform` + backend metadata.
3. Add compatibility report builder (`compatibility-report.ts`).
4. Expose report via `GET /compat` route.

### 8.3 Frontend — Runtime Consumption

1. Ensure realtime store consumes `runtime_summary` and/or `/compat` fallback.
2. Render platform indicator in `status-line.tsx`.
3. Render compatibility checks panel on configs page.

### 8.4 Documentation

1. Port ROCm day-0 playbook (`docs/rocm-mi300x-playbook.md`).
2. Add troubleshooting sections for tool path overrides and expected outputs.

---

## 9) API/Data Contracts

### 9.1 Runtime Summary Event (SSE)

`event: runtime_summary` payload must include:

- `platform.kind`
- `gpu_monitoring.available`
- `gpu_monitoring.tool`
- `backends.vllm|sglang|llamacpp` installed/version markers

### 9.2 Compatibility Report (`GET /compat`)

Must include:

- `platform`
- `gpu_monitoring`
- `torch`
- `backends`
- `checks[]`

Where each check has stable fields and machine-readable severity.

---

## 10) Test Plan

### 10.1 Unit Tests

- `amd-smi` JSON parsing edge cases (missing keys, N/A values, units),
- `rocm-smi` text parser unit conversion + malformed lines,
- platform detection matrix (`forced`, `torch`, `binary presence`),
- compatibility check generation matrix.

### 10.2 Integration Tests

- `/gpus` returns AMD data when `amd-smi` mocked,
- fallback to `rocm-smi` when `amd-smi` unavailable,
- `/compat` emits actionable checks.

### 10.3 Frontend/E2E

- mocked SSE `runtime_summary` shows `platform: rocm`,
- fallback poll still hydrates platform when SSE absent.

---

## 11) Rollout and Safety

- Ship behind no feature flag (foundational infra),
- Ensure backward compatibility for CUDA hosts,
- Add logs for tool detection path and telemetry source.

---

## 12) Risks and Mitigations

- **Risk:** vendor CLI output format drift.
  - **Mitigation:** defensive parsing + test fixtures.
- **Risk:** false platform detection on mixed envs.
  - **Mitigation:** deterministic precedence + explicit override env.
- **Risk:** noisy compatibility checks.
  - **Mitigation:** severity tuning and evidence-based messages.

---

## 13) Definition of Done

- [ ] Controller reports `platform.kind` correctly across detection matrix
- [ ] ROCm GPU telemetry works via `amd-smi` and `rocm-smi` fallback
- [ ] `/compat` includes actionable checks with suggested fixes
- [ ] Dashboard displays platform and configs show compatibility panel
- [ ] Unit/integration/e2e tests added and passing
- [ ] Frontend lint/build and controller typecheck pass with zero errors/warnings
