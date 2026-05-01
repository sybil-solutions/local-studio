# Chapter 8 — Things to merge

> **Scope:** duplications, parallel implementations, and near‑twins on
> `feat/plop-t3code-with-pi`. Each candidate names both halves and proposes a
> consolidated successor. This chapter complements Chapter 7 (which is about
> *splitting*); here we are looking for surface area we can *delete* without
> losing functionality.

This chapter only lists merges; it does **not** propose new features and does
**not** repeat the file‑splits documented in Chapter 7.

## Ranking table

Effort: **S** ≤ ½ day, **M** ≤ 2 days, **L** > 2 days. Risk reflects the
chance of a runtime regression at the boundary being merged.

| #  | Merge                                                       | Effort | Risk | LoC saved (est.) | Page |
|---:|-------------------------------------------------------------|:------:|:----:|-----------------:|------|
| 1  | Re‑introduce a tiny `@vllm-studio/shared` types package      | M      | low  | ~250             | [shared-types-package.md](./shared-types-package.md) |
| 2  | Collapse `metrics.ts` + `metrics-store.ts` + `metrics-collector/` into `telemetry/{collector,metrics-store}.ts` | M | med | ~200 | [metrics-and-usage-collapse.md](./metrics-and-usage-collapse.md) |
| 3  | Single `usage/` store with two ingestion paths (chat vs pi)  | M      | med  | ~200             | [metrics-and-usage-collapse.md](./metrics-and-usage-collapse.md) |
| 4  | Delete `controller/src/modules/audio/` outright              | S      | low  | ~340             | [delete-audio-module.md](./delete-audio-module.md) |
| 5  | Collapse `jobs/{auto,memory,}orchestrator.ts` → 1 helper or delete | S | low  | ~120             | [collapse-jobs-orchestrators.md](./collapse-jobs-orchestrators.md) |
| 6  | Unify `frontend/desktop/logic/projects-store.ts` and `frontend/src/lib/agent/projects-store.ts` | M | med | ~120 | [projects-store-merge.md](./projects-store-merge.md) |
| 7  | Derive `launchState` from `engineService.getState()`; complete the `processManager`/`downloadManager` migration off `AppContext` | M | med | ~80 | [engine-state-merge.md](./engine-state-merge.md) |
| 8  | Move `controller/src/stores/{job-store,sqlite}.ts` into the modules that own them | S | low | ~10 (deletes a directory) | [controller-stores-collocation.md](./controller-stores-collocation.md) |
| 9  | Co‑locate `use-machine.ts` + `use-model-lifecycle.ts` (and frontend lifecycle hooks) under `hooks/lifecycle/`; derive `vllm-runtime-panel-machine` from controller events | M | med | ~50 | [ui-hooks-cohesion.md](./ui-hooks-cohesion.md) |
| 10 | One logger; remove the few residual `console.*` calls       | S      | low  | ~10              | [logger-uniformity.md](./logger-uniformity.md) |
| 11 | Extract a `firstExisting(candidates)` helper in `pi-runtime.ts` | S | low | ~30 | [pi-runtime-helpers.md](./pi-runtime-helpers.md) |
| 12 | Delete `controller/src/types/chat.ts`; rename `DEFAULT_CHAT_PROVIDER` → `DEFAULT_PROVIDER` | S | low | ~120 | [chat-leftover-cleanup.md](./chat-leftover-cleanup.md) |
| 13 | Re‑integrate `cli/` as a workspace package consuming the shared types | M | med | (no LoC; delete a `bun.lock` + `node_modules`) | [cli-workspace-integration.md](./cli-workspace-integration.md) |

## Top‑5 merges that most reduce repo size while preserving function

1. **Re‑introduce a tiny `@vllm-studio/shared` workspace package** (#1) —
   eliminates four cross‑runtime duplicates (`state-machine.ts`,
   `controller-events.ts`, `recipe-types.ts`, `system-types.ts`). These are
   the *protocol* between frontend and controller; deduping them is the only
   structural fix for silent drift.
2. **Delete `controller/src/modules/audio/`** (#4) — the agent surface does
   not consume STT/TTS. ~340 LoC plus a chunk of test code, gone for free.
3. **Collapse the metrics quartet → 2 files in `telemetry/`** (#2) — the
   merge already specified in CONTROLLER_SCOPE.md §6.2. Pure restructuring.
4. **Single `usage/` store with two ingestion paths** (#3) — kills the
   parallel `chat-database` / `pi-sessions` / `usage-utilities` triad and
   leaves one route file behind.
5. **Collapse `jobs/{auto,memory,}orchestrator.ts`** (#5) — three files,
   ~120 LoC of overlapping responsibility, exactly as called out in
   CONTROLLER_SCOPE.md §1. Either flatten to one helper or delete.

> Together, candidates #1–#5 remove on the order of **1,000+ LoC** and
> eliminate two parallel data paths (metrics, usage) and the only remaining
> cross‑runtime drift surface (the shared types).

## Cross‑references

- Chapter 6 — Complexity. Most of the candidates here came from complexity
  hot‑spots noted there.
- Chapter 7 — Files to *split*. The opposite move: when one file does too
  much, Chapter 7 splits it; when two files do the same thing, Chapter 8
  merges them.
- `MIGRATION.md` — describes the dissolution of the old `shared/` package
  and confirms `processManager` / `downloadManager` were retained on
  `AppContext` "for backward compatibility with consumers not yet migrated."
- `CONTROLLER_SCOPE.md` §6 — explicit migration phases for #2, #3, #4, #5.
