# Chapter 7 — Files to Improve

> Branch: `feat/plop-t3code-with-pi`
> Scope: concrete, file-level refactor proposals — no hand-waving, no speculative cleanup.
> Pair with: [Chapter 6 — Complexity Hotspots](../chapter-06-complexity/) (when written), [CONTROLLER_SCOPE.md](../../CONTROLLER_SCOPE.md), [scope.md](../../scope.md), [MIGRATION.md](../../MIGRATION.md).

This chapter ranks specific files on the branch by the cost of leaving them as-is, and proposes concrete splits. Sizes were verified with `wc -l` at the time of writing; some files differ from earlier estimates (noted inline).

---

## Master ranking

Sorted by impact (biggest LoC + coupling cost first). "Reduction" is the rough delta after splitting/deleting; for splits the total LoC is roughly preserved but every successor file becomes individually testable and replaceable.

| Rank | File | LoC | Impact | Risk | Section | Reduction estimate |
|------|------|----:|--------|------|---------|--------------------|
| 1 | `frontend/src/app/agent/_components/chat-pane.tsx` | 1,231 | **High** | Medium | [A](./giant-ui-files.md#1-chat-panetsx) | split into 8 files; ~0 net LoC |
| 2 | `frontend/src/app/agent/_components/agent-workspace.tsx` | 1,145 | **High** | Medium | [A](./giant-ui-files.md#2-agent-workspacetsx) | split into 7 files; ~0 net LoC |
| 3 | `controller/src/modules/engines/layers/engine-coordinator.ts` | 578 | **High** | High | [B](./giant-controller-files.md#5-engine-coordinatorts) | split into 4 files; ~0 net |
| 4 | `controller/src/modules/engines/layers/backend-builder.ts` | 578 | **High** | Low | [B](./giant-controller-files.md#6-backend-builderts) | split into 6 files; ~0 net |
| 5 | `frontend/src/components/projects-nav-section.tsx` | 516 | High | Low | [A](./giant-ui-files.md#3-projects-nav-sectiontsx) | split into 4 files; ~0 net |
| 6 | `frontend/src/app/agent/_components/filesystem-panel.tsx` | 547 | High | Low | [A](./giant-ui-files.md#4-filesystem-paneltsx) | split into 4 files; ~0 net |
| 7 | `controller/src/modules/system/usage/chat-database.ts` | 531 | **High** | Low | [D](./type-and-route-orphans.md#chat-database-orphan) | likely **delete** (–531) |
| 8 | `controller/src/modules/system/metrics-collector/metrics-collector.ts` | 513 | **High** | Medium | [B](./giant-controller-files.md#13-metrics-collectorts) | –150 LoC after peak-gate move |
| 9 | `frontend/src/lib/agent/pi-runtime.ts` | 444 | **High** | Medium | [C](./pi-runtime-split.md) | split into 5 files; ~0 net |
| 10 | `controller/src/modules/proxy/tool-call-stream.ts` | 423 | **High** | Medium | [B](./giant-controller-files.md#10-tool-call-streamts) | split into 4 files; ~0 net |
| 11 | `controller/src/modules/proxy/openai-routes.ts` | 385 | Medium | Low | [B](./giant-controller-files.md#11-openai-routests) | split into 4 files; ~0 net |
| 12 | `controller/src/modules/engines/layers/download-manager.ts` | 387 | Medium | Low | [B](./giant-controller-files.md#9-download-managerts) | watch-only |
| 13 | `controller/src/modules/engines/routes.ts` | 327 | Medium | Low | [B](./giant-controller-files.md#8-engines-routests) | split into 4 files; ~0 net |
| 14 | `controller/src/modules/engines/layers/runtime-info.ts` | 240 | Medium | Low | [B](./giant-controller-files.md#7-runtime-infots) | split into 3 files; ~0 net |
| 15 | `controller/src/types/chat.ts` | 126 | Medium | Low | [D](./type-and-route-orphans.md#types-chatts-orphan) | likely **delete** (–126) |
| 16 | `controller/src/services/provider-routing.ts` | 105 | Low | Low | [D](./type-and-route-orphans.md#provider-routing-default-flip) | document or revert silent default |
| 17 | `controller/src/http/security-middleware.test.ts` | (deleted) | Medium | Low | [D](./type-and-route-orphans.md#missing-security-middleware-test) | restore tests |
| 18 | `controller/src/modules/jobs/*` | ~497 | Medium | Low | [D](./type-and-route-orphans.md#jobs-orchestrators) | likely **delete** (–~400) |
| 19 | `.factory/threat-model.md` (deleted) | (deleted) | Low | Low | [E](./documentation-drift.md#factory-threat-model-deletion) | restore or migrate to `SECURITY.md` |
| 20 | `docs/**` references to `shared/` | n/a | Low | Low | [E](./documentation-drift.md#stale-shared-references) | scrub 5 files |
| 21 | `cli/vllm-studio` (binary, 60 MB) | n/a | **High** | Low | [F](./repo-hygiene.md#binary-in-repo) | gitignore (immediate) |
| 22 | `MIGRATION.md` / `scope.md` / `plan.md` overlap | n/a | Medium | Low | [F](./repo-hygiene.md#root-design-doc-overlap) | consolidate into `docs/` |
| 23 | `frontend/src/lib/state-machine.ts` ↔ `controller/src/modules/shared/state-machine.ts` (45 LoC each, identical) | 90 | Low | Low | [F](./repo-hygiene.md#duplicated-state-machine) | accept duplication or extract package |
| 24 | `cli/src/api.ts` `X-API-Key` not covered in tests | 198 / 192 | Medium | Low | [G](./test-gaps.md#cli-x-api-key) | +1 test |
| 25 | `controller/src/modules/proxy/tool-call-stream.ts` has no tests | 423 | High | Low | [G](./test-gaps.md#tool-call-stream-tests) | +tests per split file |

---

## Total LoC reduction estimate

| Category | Net LoC delta | Notes |
|----------|--------------:|-------|
| Pure splits (chat-pane, agent-workspace, projects-nav, filesystem-panel, engine-coordinator, backend-builder, runtime-info, engines/routes, tool-call-stream, openai-routes, pi-runtime) | ~0 | Same code, more files; complexity per-file drops drastically. |
| Delete `chat-database.ts` (orphan) | **–531** | Confirm zero writers first. |
| Delete `controller/src/types/chat.ts` | **–126** | Move surviving types to consumer. |
| Collapse `controller/src/modules/jobs/*` (3 orchestrators, 1 workflow) | **–~400** | Per CONTROLLER_SCOPE.md non-goals. |
| `metrics-collector.ts` peak-gate + scrape split | **–~150** | Refactor opportunity. |
| Remove `cli/vllm-studio` binary from git history | **–60 MB on-disk** | Not LoC, but huge for clones/CI. |
| **Total source reduction** | **–~1,200 LoC** | + 60 MB binary blob |

This puts the controller meaningfully closer to the CONTROLLER_SCOPE.md target (21,258 → ~4,500 LoC). It is **not** the full slimming — it's the file-level layer of it.

---

## First 5 things to do

Ordered by ROI (impact ÷ effort):

1. **Delete `cli/vllm-studio` binary + add to `.gitignore`.** 30-second change, removes 60 MB from clones, and ensures CI rebuilds the artifact. See [F](./repo-hygiene.md#binary-in-repo).
2. **Confirm-and-delete `controller/src/modules/system/usage/chat-database.ts` (531 LoC) and `controller/src/types/chat.ts` (126 LoC).** Both are orphans after the chat-module rewrite. Grep for any remaining writers first; if none, delete. See [D](./type-and-route-orphans.md).
3. **Split `chat-pane.tsx` (1,231 LoC).** Highest leverage UI refactor on the branch — every other agent-surface improvement touches this file. See [A](./giant-ui-files.md#1-chat-panetsx).
4. **Split `engine-coordinator.ts` + `backend-builder.ts` (578 + 578 LoC).** These two are the controller's spine; splitting them makes Phase 2 of CONTROLLER_SCOPE.md actually feasible. See [B](./giant-controller-files.md).
5. **Add tests for `cli/src/api.ts` `X-API-Key` header and write split-tests for `tool-call-stream.ts`.** Cheap, high coverage value, and prevents regressions during the bigger refactors above. See [G](./test-gaps.md).

---

## Section index

- [A — Giant UI files (frontend)](./giant-ui-files.md)
- [B — Giant controller files](./giant-controller-files.md)
- [C — Pi runtime split](./pi-runtime-split.md)
- [D — Type & route orphans](./type-and-route-orphans.md)
- [E — Documentation drift](./documentation-drift.md)
- [F — Repo hygiene](./repo-hygiene.md)
- [G — Test gaps](./test-gaps.md)

---

## Cross-references

- Frontend inventory: [Chapter 1](../chapter-01-frontend/index.md)
  - [chat-pane deep dive](../chapter-01-frontend/chat-pane-deep-dive.md)
  - [agent-workspace deep dive](../chapter-01-frontend/agent-workspace-deep-dive.md)
  - [pi-runtime](../chapter-01-frontend/pi-runtime.md)
- Controller inventory: [Chapter 2](../chapter-02-controller/index.md)
  - [engines module](../chapter-02-controller/engines-module.md)
  - [system module](../chapter-02-controller/system-module.md)
  - [proxy module](../chapter-02-controller/proxy-module.md)
- CLI inventory: [Chapter 3](../chapter-03-cli/)
- Anything else: [Chapter 4](../chapter-04-anything-else/index.md)
  - [shared package dissolution](../chapter-04-anything-else/shared-package-dissolution.md)
  - [factory config removal](../chapter-04-anything-else/factory-config-removal.md)
  - [root docs and plans](../chapter-04-anything-else/root-docs-and-plans.md)
