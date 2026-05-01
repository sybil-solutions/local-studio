# E — Documentation Drift

> Docs that no longer match the code on this branch. Each fix is small; left alone they actively mislead new contributors.

---

## `.factory/threat-model.md` deletion

**Path:** `.factory/threat-model.md` — **deleted on this branch.**
**Companion:** `.factory/security-config.json` — **also deleted.**

### Symptoms

- The whole `.factory/` directory is gone (verified — `ls .factory/` returns "No such file or directory").
- See [Chapter 4 — factory config removal](../chapter-04-anything-else/factory-config-removal.md) for the full deletion catalogue.
- The threat model contained STRIDE notes, OWASP references, and the API-key/CORS/local-IPC reasoning. None of this was migrated into a successor file.
- Result: no central reference for *why* `controller/src/http/security-middleware.ts` is shaped the way it is. The middleware itself survives ([security-middleware test gap](./type-and-route-orphans.md#missing-security-middleware-test)) but its rationale doesn't.

### Proposed action

Pick one:

1. **Restore the deleted files.** Cheap, but `.factory/` is a tooling-config directory and might be intentionally gitignored.
2. **Migrate to repo-rooted `SECURITY.md`.** Better default home — `SECURITY.md` is the conventional location, GitHub auto-renders it on the repo page, and it doesn't tie threat-modelling to a specific tool.

Recommended: **option 2**. Concrete plan:

- Create `/Users/sero/projects/vllm-studio/SECURITY.md` with sections:
  - **Threat model** (port the STRIDE table from the deleted file).
  - **Security middleware** — what `security-middleware.ts` enforces and why.
  - **API keys** — where they live (`.env.local`), how the controller consumes them.
  - **Local-only assumptions** — explicitly state the controller is single-user/single-host (per [CONTROLLER_SCOPE.md §7](../../CONTROLLER_SCOPE.md)).
  - **Reporting** — how to report a vulnerability.
- Reference `SECURITY.md` from `README.md`.

### What was lost

Without restoring the file from git history we can't reproduce its full content. The reviewer should `git log --all --diff-filter=D -- .factory/threat-model.md` and decide whether to:

- Cherry-pick the original file content into `SECURITY.md`, or
- Note in the changelog that prior threat-model docs were removed and were not migrated.

### Estimated impact

- **+~120 LoC** of new docs (or 0 if option 1 chosen).
- Risk: **none** (docs only).

### Dependencies

- Should land **before** the [security-middleware.test.ts restore](./type-and-route-orphans.md#missing-security-middleware-test) so the new tests can reference `SECURITY.md` for the contract being tested.

---

## Stale `shared/` references

The `shared/` package was dissolved on this branch (see [Chapter 4 — shared package dissolution](../chapter-04-anything-else/shared-package-dissolution.md)). Five docs still mention it.

### Files to scrub

Verified with `rg "shared/" docs/`:

| File | Line | Reference |
|------|-----:|-----------|
| `docs/README.md` | 15 | `Shared types: ../shared/README.md` |
| `docs/operations.md` | 48 | rsync pushes `controller/src/, frontend/src/, shared/, config/` |
| `docs/plans/03-execution-workpacks.md` | 15 | `Create shared/events/*` |
| `docs/plans/02-priority-roadmap.md` | 14 | "Create shared event contract module ... under `shared/`" |
| `docs/plans/04-7-day-execution-schedule.md` | 18 | `shared/src/controller-events.ts` |

### Proposed action

For each file, do one of:

1. **Delete the line** if `shared/` was only referenced as a pointer to a now-gone artifact (e.g. `docs/README.md`).
2. **Rewrite to reflect the duplicated state.** The two surviving copies live at `frontend/src/lib/state-machine.ts` and `controller/src/modules/shared/state-machine.ts` — see [repo-hygiene.md](./repo-hygiene.md#duplicated-state-machine).
3. **For the plan docs** (`docs/plans/02`, `03`, `04`): mark them with a status banner. They look like execution plans for work that has now happened or been re-shaped. Add at the top:
   ```
   > **Status: superseded** — see CONTROLLER_SCOPE.md / scope.md / MIGRATION.md.
   ```

`docs/operations.md` line 48 is the most operationally dangerous reference — it's documenting the *current* deploy script's rsync includes. Confirm `scripts/deploy-remote.sh` no longer rsyncs `shared/` (it shouldn't, since the directory is gone) and update line 48 accordingly.

### Estimated impact

- LoC delta: ~–10 to +5 (depending on rewrite vs delete).
- Risk: **low** (docs).

### Dependencies

- None.

---

## Other doc drift to watch

Not specific files, but a class of issue worth flagging during review:

- Any `README.md` in deleted directories was deleted with them — verify none survive as orphan docs (e.g., a dangling `monitoring/README.md` if Phase 2 missed it).
- `frontend/README.md` and `controller/README.md` should mention that the `agent/` surface is the canonical UI on this branch (per [Chapter 1 index](../chapter-01-frontend/index.md)).

These are watch-items, not concrete file changes for this chapter.

---

## Summary

| Item | Action | LoC delta | Risk |
|------|--------|----------:|------|
| `.factory/threat-model.md` deletion | Migrate to `SECURITY.md` | **+~120** | None |
| 5 doc files referencing `shared/` | Scrub or rewrite | ~–10 | Low |
| **Total** | | **+~110** (mostly new SECURITY.md) | |
