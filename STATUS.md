# vLLM Studio Cleanup Mission Status

## Mission

Clean up vLLM Studio without changing runtime functionality or UI unless a later checklist item explicitly requires it. Every slice must be validated, committed, and released when appropriate.

## Current Turn

- [x] Inspect remaining package cleanup gates.
- [x] Remove unused CLI-local `husky` dependency discovered by `cli` check.
- [x] Remove stale CLI `.husky` dead-code ignore and redundant comments.
- [x] Refresh the CLI Bun lockfile.
- [x] Validate CLI check, typecheck, lint, and whitespace.
- [x] Commit this slice.

## Backlog

- [ ] Add frontend e2e coverage for agent flows: splitting, leaving and reconnecting sessions, forking, compacting, pi-extensions, tagging files, and skills. Initial regression coverage exists for reconnect, active-session model metadata merge, Pi multi-controller model refresh, splitting, queue/follow-up, compacting, skills, file tagging, Pi extension override persistence, and tab forking; browser screenshot coverage and extension UI remain.
- [ ] Add settings e2e coverage and implement direct MLX and llama.cpp support. Initial controller-level settings/provider route coverage, frontend engine-row e2e coverage, saved-controller settings coverage, API settings persistence/voice routing coverage, llama.cpp direct target support, initial MLX runtime/recipe support, and module README coverage exist; broader frontend settings e2e and MLX launch hardening remain.
- [ ] Improve venv management experience.
- [ ] Clean controller dead paths and unused complexity based on code and logs.
- [ ] Add controller integration and e2e tests for all active controller flows. Initial integration smoke coverage exists for core route contracts, raw observability persistence, controller proxy success/failure paths, model catalog/discovery routes, HuggingFace discovery normalization, system introspection routes, studio settings/provider CRUD, Studio operational routes, recipe CRUD, lifecycle control routes, runtime/download validation routes, download control error routes, runtime target selection/health routes, runtime backend metadata routes, runtime job validation/config routes, monitoring/log/benchmark route contracts, proxy/tokenization fallback contracts, and audio validation contracts; full active-flow coverage remains.
- [ ] Add controller observability for success, failure, error, path, and function-call tracking. Initial persistent HTTP route observability exists and raw rows are integration-tested; per-function call tracking remains.
- [ ] Surface observability data in `/usage` and validate it end to end. Initial route observability is surfaced, raw persistence is integration-tested, `/usage` status, latency, recent-activity, error aggregation, inference-aggregate fallback behavior, and `/usage/pi-sessions` JSONL aggregation are integration-tested, and the frontend normalization boundary preserves controller observability; frontend visual rendering and full API-route coverage remain.
- [ ] Deploy controller to Pop!\_OS after killing the old controller from this device.
- [ ] Test every API route against controller observability rows and `/usage`.
- [ ] Audit comments across the repo and delete stale or irrelevant comments. Current slices remove empty/generated JSDoc blocks from controller source/tooling, exact non-informative `// CRITICAL` headers, stale annotated `CRITICAL` migration labels, generated lifecycle JSDoc noise from the engine coordinator, non-informative `CRITICAL` banners from deploy/global-style files, generated download-manager JSDoc noise, parameter-only download helper JSDoc, boilerplate process utility JSDoc, backend-builder command JSDoc noise, runtime parser default JSDoc noise, process-manager wrapper JSDoc noise, parameter-only metrics-store JSDoc, proxy route registration JSDoc noise, stale log-route wrapper JSDoc, event-manager method JSDoc noise, stale metrics-collector helper JSDoc, self-evident launch-state JSDoc, vLLM runtime path resolver JSDoc, model-browser JSDoc noise, redundant Projects navigation comments, redundant pane-grid comments, redundant tools persistence comments, self-evident pane-controller helper JSDoc, self-evident API core comments, redundant chat-pane comments, self-evident agent-browser render comments, decorative session block-event section headers, decorative session helper section headers, redundant launch-toast JSDoc, self-evident dashboard recipe comments, redundant shared UI helper JSDoc, redundant session store/selectors comments, redundant project context field comments, redundant tools context member comments, redundant session type field comments, redundant controller engine module headers, redundant engine service section comments, redundant process manager stream comments, redundant launch state method comments, redundant ROCm info ignore comments, redundant logs route ignore comments, redundant metrics benchmark comments, stale engine route section dividers, redundant system config type headers, redundant proxy stream close comments, decorative controller definition dividers, redundant studio route provider divider, comment-boilerplate lint/standards enforcement, and redundant CLI knip comments; broader file-by-file audit remains open.
- [ ] Audit package scripts and remove irrelevant commands. Current slices remove stale root frontend metadata/dependencies, duplicate frontend quality/cleanup aliases, broken nested Husky prepare scripts, unused controller `yaml`/`husky` dependencies, and unused CLI-local `husky`; deeper command pruning remains open as features are removed.
- [x] Replace every React effect hook with appropriate alternatives and validate there are zero remaining frontend source usages.

## Constraints

- Do not change functionality unless a checklist item explicitly requires it.
- Do not change UI unless a checklist item explicitly requires it.
- Keep tests in dedicated modules when adding them later: `tests/controller/integration`, `tests/controller/e2e`, and `tests/frontend/e2e`.
- Keep this file updated as work advances.
