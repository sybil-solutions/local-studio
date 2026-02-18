<!-- CRITICAL -->
# Task 02 — Cross-Vendor Device Visibility + Environment Normalization

## 1) Task Intent

Standardize recipe-driven device selection so one logical setting (`visible_devices`) works predictably on:

- CUDA (`CUDA_VISIBLE_DEVICES`),
- ROCm (`HIP_VISIBLE_DEVICES`, `ROCR_VISIBLE_DEVICES`),
- unknown/mixed environments (safe fallback behavior).

This task removes backend/platform-specific surprises during model launch.

---

## 2) Why This Task Exists

Historically, users configured device pinning via CUDA-centric env keys, which breaks portability on AMD hosts. PR #54 introduces cross-vendor mapping logic but as part of a large branch.

We need a standalone, deeply tested normalization task because this logic impacts every model launch.

---

## 3) PR Evidence (Source Material)

- `controller/src/services/process-utilities.ts`
- `controller/src/tests/build-environment-visible-devices.test.ts`
- `frontend/src/app/recipes/recipe-utils.ts`
- `frontend/src/app/recipes/recipe-command.ts`
- `controller/src/services/backends.ts`

---

## 4) In Scope

### 4.1 Canonical Recipe Field

Support `visible_devices` as canonical recipe intent for cross-vendor GPU selection.

### 4.2 Alias Compatibility

Accept legacy aliases in UI normalization and controller read paths:

- `VISIBLE_DEVICES`
- `CUDA_VISIBLE_DEVICES`
- `cuda_visible_devices`
- `cuda-visible-devices`
- explicit ROCm keys (`hip_visible_devices`, `rocr_visible_devices`)

### 4.3 Runtime Env Projection

Project recipe values to process environment based on platform inference:

- CUDA mode → set `CUDA_VISIBLE_DEVICES`
- ROCm mode → set `HIP_VISIBLE_DEVICES` and `ROCR_VISIBLE_DEVICES`
- Unknown mode → set all three for pragmatic compatibility

### 4.4 Editor/Command Consistency

Ensure recipe editor and command preview:

- persist normalized fields,
- avoid leaking internal keys into visible CLI preview when not applicable,
- maintain backward compatibility for existing stored recipes.

---

## 5) Out of Scope

- Scheduler-level multi-host placement,
- Dynamic per-request device assignment,
- MIG-specific resource partitioning,
- automatic conflict resolution with lease manager (handled elsewhere).

---

## 6) Functional Requirements

### FR-01: Deterministic Env Mapping

Given a recipe and resolved platform mode, env mapping must produce deterministic outputs:

- same inputs always same env key/value set,
- no duplicate contradictory values.

### FR-02: Explicit Override Precedence

If explicit ROCm keys are provided (`hip_visible_devices`, `rocr_visible_devices`), they override generic `visible_devices` projection for their respective keys.

### FR-03: Legacy Field Readability

Controller must read legacy keys from recipe `extra_args` and normalize behavior without requiring manual migration.

### FR-04: Internal Key Filtering for Command Generation

Command preview builders must not render internal env keys as CLI flags where they are not valid runtime arguments.

### FR-05: Safety on Unknown Platform

When platform cannot be determined, set all visibility env keys to reduce bring-up failures during ambiguous environments.

---

## 7) Non-Functional Requirements

- **Backward compatibility:** no breakage for existing recipe DB rows.
- **Transparency:** UI normalization should be predictable and inspectable.
- **Low risk:** changes confined to recipe normalization + env build paths.

---

## 8) Detailed Implementation Plan

### 8.1 Controller — Environment Builder

1. Port/read logic in `buildEnvironment(recipe)`:
   - inspect canonical + alias keys,
   - infer platform from `VLLM_STUDIO_GPU_SMI_TOOL` where available,
   - map values to env keys by platform.
2. Preserve pre-existing `env_vars` merge behavior.
3. Add tests for all platform/override permutations.

### 8.2 Frontend — Recipe Normalization

1. Port alias mapping tables into recipe utils.
2. Normalize legacy values into canonical form in editor state.
3. On save, persist canonical and needed compatibility aliases only where intended.
4. Keep command preview readable and avoid internal key noise.

### 8.3 Backend Command Builders

1. Confirm `visible_devices`-family keys are excluded from extra CLI argument injection.
2. Confirm env vars are the only transport channel for device pinning.

---

## 9) Acceptance Matrix (Mandatory)

| Platform Mode | Input | Expected Env |
|---|---|---|
| cuda | `visible_devices=0` | `CUDA_VISIBLE_DEVICES=0` |
| rocm | `visible_devices=0` | `HIP_VISIBLE_DEVICES=0`, `ROCR_VISIBLE_DEVICES=0` |
| unknown | `visible_devices=0` | all three env vars set to `0` |
| rocm | `visible_devices=0`, `hip_visible_devices=2` | HIP=2, ROCR=0 |
| rocm | `rocr_visible_devices=3` only | ROCR=3 (HIP unchanged unless provided) |

---

## 10) Test Plan

### 10.1 Unit Tests (Controller)

- direct tests around `buildEnvironment()` projection,
- alias input coverage,
- override precedence coverage,
- unknown-platform fallback coverage.

### 10.2 Unit Tests (Frontend)

- recipe normalization from legacy keys,
- serialization back to payload,
- command preview key filtering.

### 10.3 Regression Tests

- existing CUDA recipes continue to launch,
- ROCm recipes launch with expected env keys,
- no unexpected CLI flags introduced.

---

## 11) Rollout Plan

- Ship with compatibility-first behavior (legacy aliases accepted),
- no schema migration required,
- monitor launch logs for env projections during first rollout window.

---

## 12) Risks and Mitigations

- **Risk:** accidental env key conflicts.
  - **Mitigation:** explicit precedence rules + matrix tests.
- **Risk:** user confusion due to hidden key normalization.
  - **Mitigation:** docs + tooltips in recipe UI for canonical field usage.

---

## 13) Definition of Done

- [ ] Canonical `visible_devices` works cross-vendor
- [ ] Legacy aliases remain functional
- [ ] Platform-specific env projection tested via matrix
- [ ] Command preview excludes internal env keys
- [ ] Frontend lint/build and controller typecheck pass cleanly
