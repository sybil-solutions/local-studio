<!-- CRITICAL -->
# Task 07 — Runtime Telemetry + Charting-Ready Data Plane

## 1) Task Intent

Create a consistent telemetry/event backbone for runtime/platform/service/job visibility that:

- powers current dashboard status features,
- provides stable contracts for future charting/time-series UI.

This task is intentionally about data plumbing and event contracts, not full chart UI.

---

## 2) Why This Task Exists

PR #54 introduces runtime summary SSE and realtime store wiring, but it is embedded with many unrelated changes. We need a dedicated task to define canonical telemetry contracts and frontend synchronization behavior.

---

## 3) PR Evidence (Source Material)

- `controller/src/services/event-manager.ts`
- `controller/src/metrics-collector.ts`
- `controller/src/tests/runtime-summary-events.test.ts`
- `frontend/src/hooks/use-controller-events.ts`
- `frontend/src/hooks/realtime-status-store.ts`
- `frontend/src/hooks/realtime-status-store.runtime-summary.test.ts`
- `frontend/src/hooks/use-controller-events.runtime-summary.test.ts`
- `frontend/src/components/dashboard/control-panel/status-line.tsx`
- `frontend/src/components/dashboard/control-panel/runtimes-panel.tsx`
- `frontend/src/components/dashboard/use-dashboard-data.ts`

---

## 4) In Scope

### 4.1 Controller Event Contract

Add and document low-frequency `runtime_summary` event payload emitted over SSE.

### 4.2 Frontend Realtime Store

Integrate event consumption and normalized store state for:

- runtime summary,
- services list,
- GPU lease,
- jobs,
- status/gpu/metrics continuity.

### 4.3 Poll Fallback Strategy

When SSE is unavailable or stale:

- poll status surfaces,
- hydrate runtime summary from `/compat`,
- avoid high-cost calls in fallback mode.

### 4.4 Dashboard Runtime Visibility

Render and keep synchronized:

- platform label,
- service runtime panel,
- lease holder marker,
- basic runtime counters.

### 4.5 Charting-Ready Schema Definition

Define schema requirements for future timeseries collection (without implementing full chart components in this task).

---

## 5) Out of Scope

- Implementing historical database for long-term metrics,
- building new chart widgets beyond current dashboard elements,
- alerting/notification systems.

---

## 6) Functional Requirements

### FR-01: Runtime Summary Event

Controller must support publishing `runtime_summary` via event manager with stable fields:

- `platform.kind`
- `gpu_monitoring.available/tool`
- backend installation/version summaries.

### FR-02: Frontend Event Subscription

Frontend controller event hook must subscribe to `runtime_summary` and dispatch typed internal events.

### FR-03: Store Consistency

Realtime store must apply deep equality guards to prevent unnecessary re-renders while preserving freshness timestamps.

### FR-04: Fallback Hydration

If no recent SSE events are observed, store must poll and recover state, including runtime summary from `/compat`.

### FR-05: Services + Lease Synchronization

Store must track both service states and current GPU lease holder from events or poll fallback.

---

## 7) Non-Functional Requirements

- **Efficiency:** avoid event storms and unnecessary state churn.
- **Resilience:** recover quickly after tab sleep/network interruptions.
- **Extensibility:** schema should support future charting timeseries snapshots.

---

## 8) Detailed Implementation Plan

### 8.1 Controller

1. Add `publishRuntimeSummary(...)` helper in event manager.
2. Emit summary from metrics/runtime collector path at low frequency.
3. Ensure event payload validation before publish.

### 8.2 Frontend Event Hook

1. Subscribe to `runtime_summary` SSE event.
2. Dispatch browser custom event consumed by store.
3. Validate payload kind values before applying.

### 8.3 Realtime Store

1. Extend snapshot model with runtime summary/services/gpu lease/jobs.
2. Implement equality checks to avoid noisy updates.
3. Add stale-event polling fallback and visibility/page-show refresh hooks.

### 8.4 Dashboard Consumers

1. `use-dashboard-data` surfaces platform/services/lease to UI.
2. Status line shows platform.
3. Runtimes panel shows service states and lease tags.

### 8.5 Charting-Ready Contract (Design Output)

Define follow-up schema (`runtime_sample`) fields for time-series support:

- timestamp,
- platform,
- per-gpu util/memory/power/temp,
- aggregate token throughput,
- active services and lease holder.

This task must produce schema docs even if chart rendering lands later.

---

## 9) Test Plan

### 9.1 Controller Tests

- runtime summary publish path emits at least once,
- payload includes required keys.

### 9.2 Frontend Unit Tests

- event hook subscribes and dispatches runtime summary,
- store updates runtime summary on incoming event,
- equality checks prevent false-positive updates.

### 9.3 Integration/E2E

- dashboard displays `platform: rocm` from mocked runtime_summary,
- fallback poll hydrates summary when SSE unavailable.

---

## 10) Rollout Notes

- No feature flag required; additive telemetry path,
- monitor client-side event handling for regressions in reconnect behavior,
- keep payload backwards compatible.

---

## 11) Risks and Mitigations

- **Risk:** schema drift between controller and frontend.
  - **Mitigation:** centralized type contracts and payload tests.
- **Risk:** stale UI when SSE drops.
  - **Mitigation:** age-based fallback polling.
- **Risk:** future charting blocked by missing fields.
  - **Mitigation:** explicit schema artifact in this task output.

---

## 12) Deliverables

- Runtime summary event contract implementation,
- frontend realtime synchronization updates,
- charting-ready schema note (doc artifact),
- tests proving event dispatch and store hydration.

---

## 13) Definition of Done

- [ ] `runtime_summary` event emitted from controller
- [ ] Frontend hook/store consume and persist summary
- [ ] Dashboard surfaces platform/services/lease in realtime
- [ ] Poll fallback hydrates runtime summary when SSE blocked
- [ ] Charting-ready schema documented for follow-up task
- [ ] Lint/build/typecheck pass cleanly
