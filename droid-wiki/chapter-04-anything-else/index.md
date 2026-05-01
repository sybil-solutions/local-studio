# Chapter 4 — Anything Else

> Everything outside `frontend/`, `controller/`, and `cli/` that this PR
> (`feat/plop-t3code-with-pi`) touches: build & deploy plumbing, root design
> documents, scripts, deleted `.factory/` security artifacts, and the dissolution
> of the `shared/` workspace package.

## Why this chapter exists

Chapters 1–3 covered the three large source trees. This chapter sweeps up
everything else that the diff disturbs. Most of the surface area is small in
line count but disproportionately important:

- The **`shared/` package was deleted entirely**. Its types now live in
  `controller/src/modules/shared/` and are duplicated into the frontend.
- Three **new top-level design documents** (`MIGRATION.md`, `plan.md`,
  `scope.md`) were added. They are the spec for this PR.
- The repo's **threat model** (`.factory/threat-model.md`, ~600 lines) and its
  scanner config were deleted.
- `AGENTS.md`, `package.json`, and `.gitignore` were modified to reflect a new
  local-dev/Electron-first workflow.
- `scripts/`, `skills/`, `website/`, `config/`, and `docs/` are unchanged by
  this PR and are documented here for orientation only.

## Pages

| #   | Page | Topic |
|-----|------|-------|
| 4.1 | [shared-package-dissolution.md](./shared-package-dissolution.md) | Death of the `shared/` workspace; type duplication trade-off |
| 4.2 | [root-docs-and-plans.md](./root-docs-and-plans.md) | New `MIGRATION.md`, `plan.md`, `scope.md`, edited `AGENTS.md` |
| 4.3 | [build-and-package.md](./build-and-package.md) | Root `package.json`, `docker-compose.yml`, `.env.example`, `.gitignore` |
| 4.4 | [factory-config-removal.md](./factory-config-removal.md) | Deleted `.factory/threat-model.md` and `.factory/security-config.json` |
| 4.5 | [scripts-and-tooling.md](./scripts-and-tooling.md) | `scripts/` directory + cross-link to deleted controller scripts |
| 4.6 | [skills-website-config.md](./skills-website-config.md) | Untouched-by-PR areas: `skills/`, `website/`, `config/`, `docs/` |

## Files in scope (verified against diff)

| Path | Status | Notes |
|---|---|---|
| `AGENTS.md` | Modified | Removed Docker staging path; local Mac dev on :3001/agent |
| `MIGRATION.md` | Added | 5-phase controller refactor tracker |
| `plan.md` | Added | Phase 1 engines-module refactor playbook |
| `scope.md` | Added | Pi agent integration scope (464 lines) |
| `package.json` | Modified | Was `{ devDependencies: { knip } }`; now declares `"name": "frontend"` with React/Next deps and `main: desktop/dist/main.js` |
| `.gitignore` | Modified | Added `.vllm-studio/` for per-project agent comments |
| `.factory/security-config.json` | Deleted | 23 lines |
| `.factory/threat-model.md` | Deleted | 600 lines |
| `shared/README.md` | Deleted | Workspace package removed |
| `shared/src/index.ts` | Deleted | Barrel removed |
| `shared/src/agent.ts` | Deleted | Types not migrated (chat purge) |
| `shared/src/downloads.ts` | Deleted | Types not migrated (chat purge) |
| `shared/src/state-machine.ts` | Renamed (100%) | → `controller/src/modules/shared/state-machine.ts` |
| `shared/src/system.ts` | Renamed (97%) | → `controller/src/modules/shared/system-types.ts` |
| `shared/src/controller-events.ts` | Renamed (69%) | → `controller/src/modules/shared/controller-events.ts` |
| `shared/src/recipe.ts` | Renamed (61%) | → `controller/src/modules/shared/recipe-types.ts` |

The single commit that did the bulk of the `shared/` deletion is
`0bba921c — feat: purge chat module entirely`, but the renames into
`controller/src/modules/shared/` were committed earlier as part of the engines
phase.

## Cross-references

- Frontend-side fallout from `shared/` going away (the new
  `frontend/src/lib/state-machine.ts` and the inlined
  `controller-events-contract.ts`) is owned by **Chapter 1** — this chapter
  only summarises the trade-off.
- Controller-side homes for the migrated `shared/` files
  (`controller/src/modules/shared/`) are owned by **Chapter 2**.
- The deletion of `.factory/threat-model.md` is flagged here and re-raised in
  **Chapter 6 (Complexity / Risk)** and **Chapter 7 (Files to Improve)**.
