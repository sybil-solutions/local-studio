# vLLM Studio Cleanup Mission Status

## Mission

Clean up vLLM Studio without changing runtime functionality or UI unless a later checklist item explicitly requires it. Every slice must be validated, committed, and released when appropriate.

## Current Turn

- [x] Inspect model discovery route contracts.
- [x] Add OpenAI model detail and Studio model discovery coverage with recipe-backed metadata.
- [x] Validate those success and failure paths are persisted in controller observability rows.
- [x] Validate controller model catalog coverage slice.
- [x] Commit this slice.

## Backlog

- [ ] Add frontend e2e coverage for agent flows: splitting, leaving and reconnecting sessions, forking, compacting, pi-extensions, tagging files, and skills. Initial regression coverage exists for reconnect, splitting, queue/follow-up, compacting, skills, file tagging, Pi extension override persistence, and tab forking; browser screenshot coverage and extension UI remain.
- [ ] Add settings e2e coverage and implement direct MLX and llama.cpp support. Initial controller-level settings/provider route coverage exists; frontend settings e2e and MLX support remain.
- [ ] Improve venv management experience.
- [ ] Clean controller dead paths and unused complexity based on code and logs.
- [ ] Add controller integration and e2e tests for all active controller flows. Initial integration smoke coverage exists for core route contracts, raw observability persistence, model catalog/discovery routes, system introspection routes, studio settings/provider CRUD, Studio operational routes, recipe CRUD, runtime/download validation routes, monitoring/log route contracts, proxy/tokenization fallback contracts, and audio validation contracts; full active-flow coverage remains.
- [ ] Add controller observability for success, failure, error, path, and function-call tracking. Initial persistent HTTP route observability exists and raw rows are integration-tested; per-function call tracking remains.
- [ ] Surface observability data in `/usage` and validate it end to end. Initial route observability is surfaced, raw persistence is integration-tested, `/usage` status, latency, recent-activity, and error aggregation is integration-tested, and the frontend normalization boundary preserves controller observability; frontend visual rendering and full API-route coverage remain.
- [ ] Deploy controller to Pop!\_OS after killing the old controller from this device.
- [ ] Test every API route against controller observability rows and `/usage`.
- [ ] Audit comments across the repo and delete stale or irrelevant comments. Current slices remove empty/generated JSDoc blocks from controller source/tooling, exact non-informative `// CRITICAL` headers, and stale annotated `CRITICAL` migration labels; broader file-by-file audit remains open.
- [ ] Audit package scripts and remove irrelevant commands. Current slices remove stale root frontend metadata/dependencies, duplicate frontend quality/cleanup aliases, and broken nested Husky prepare scripts; deeper command pruning remains open as features are removed.
- [x] Replace every React effect hook with appropriate alternatives and validate there are zero remaining frontend source usages.

## Constraints

- Do not change functionality unless a checklist item explicitly requires it.
- Do not change UI unless a checklist item explicitly requires it.
- Keep tests in dedicated modules when adding them later: `tests/controller/integration`, `tests/controller/e2e`, and `tests/frontend/e2e`.
- Keep this file updated as work advances.
