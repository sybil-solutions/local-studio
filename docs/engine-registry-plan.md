# Engine layer: registry-as-backbone, then the omarchy cuts

> **Status (2026-08-25): ALL STAGES LANDED** on `refactor/engines-omarchy`
> (Stage 0 `8a58a4c2c`, Stage A `d10d5905c`, Stages B+C together `7853e4efd`,
> frontend follow-through `173ca3680`, plus an owner-directed proxy
> unification `f98790d69`: /v1/chat/completions joined /v1/responses and
> /v1/messages as pure passthrough + recording). engines+compute went from
> 8,368 to 5,191 lines; the proxy from 2,199 to 922.
>
> Deviations from the text below, all deliberate:
> - Unservable registry entries (dropped backends) are preserved in the
>   registry file and reported in a boot warning, rather than surfaced as a
>   typed `unsupported` value in /recipes — the wire shape stays unchanged.
> - Images are pinned by tag (vllm/vllm-openai:latest, lmsysorg/sglang:latest,
>   ghcr.io/theroyallab/tabbyapi:latest, rocm/vllm:latest); digest pinning is
>   still open.
> - The opt-in custom launch command survives — it now runs inside the
>   engine's container instead of as a host process.
> - /runtime/targets/:id/select was deleted (nothing called it); jobs and
>   targets kept their envelopes and row shapes.

Owner-approved direction (2026-08-25): the controller's `engines` (4,574 LOC)
and `compute` (3,794 LOC) modules spend ~8,400 lines on a job that
`~/omarchy/local-inference` proves is a ~1,500-line problem. The excess is the
capability matrix: seven ways an engine can exist × five engines, two
coexisting engine stacks glued by a bridge, and recipes living in SQLite apart
from the model registry.

Decisions taken (owner):

1. **Registry is the backbone.** Recipes move into the model registry;
   everything consumes registry entries. SQLite `recipes` becomes a migration
   source, then a backup.
2. **Docker-only engines**, omarchy-style: each engine is a pinned image chosen
   by hardware vendor; no managed venvs, no binary installs, no discovery of
   system installs. Consequence accepted: native (non-container) launches stop
   being supported; `nvidia-container-toolkit` becomes a launch prerequisite.
3. **Roster: vllm, sglang, exllamav3** — exllamav3 gets finished (it is
   currently narrowed to backend "unknown"); **llamacpp and mlx are dropped**,
   which removes Mac-local inference from the product. GGUF presets and
   llamacpp/mlx recipes become unsupported.
4. **Finish the stalled compute migration** (the old P3): delete the legacy
   lifecycle layer and `bridge.ts`; `compute` serves `/launch`, `/evict`,
   `/wait-ready` in their existing shapes directly.

## Stages

Each stage lands separately with gates green and identical route shapes unless
stated. Later stages depend on earlier ones.

### Stage 0 — registry consumes recipes (this stage)

- Registry schema v2 (`controller/contracts/model-index.ts`): a model entry MAY
  carry `serve`: the full recipe body (`RecipeBase` minus id/name, which the
  entry already has). Bundled `model-index.json` stays curated catalog; the
  data-dir overlay (`data_dir/model-index.json`) gains an `entries` list for
  user-authored models with `serve` blocks.
- New `RegistryStore`: merged read (bundled + overlay, overlay wins), overlay
  write. The recipe store becomes a facade over it: `/recipes` CRUD keeps its
  exact wire shape but reads/writes registry entries.
- One-time migration: on boot, if the overlay has no `entries` and SQLite
  `recipes` has rows, import them as overlay entries (id, name, serve block)
  and mark the overlay `migrated_from_sqlite: <timestamp>`. SQLite is left
  untouched as the rollback path.
- `/studio/model-index` continues to serve the merged registry; entries with
  `serve` blocks are launchable, catalog-only entries are not.

### Stage A — kill the bridge

`compute` serves the legacy lifecycle routes directly; `bridge.ts` and the
`engines` lifecycle indirection are deleted. The one-active-model behavior
(`llm` instance on the inference port) is preserved inside `compute`.

### Stage B — roster

Delete `compute/engines/{llamacpp,mlx}.ts`, `/runtime/llamacpp*`,
`/runtime/mlx`, GGUF presets, and llamacpp/mlx branches everywhere. Finish
`exllamav3`: full `ComputeEngineSpec` with a pinned serving image (TabbyAPI),
health, and OpenAI-compat endpoint. Registry entries with dropped backends are
reported as typed `unsupported`, not silently hidden.

### Stage C — docker-only

Delete `launchers/process.ts`, `managed-venv.ts`, `managed-llamacpp.ts`,
`runtime-target-{probes,factory}.ts`, most of `runtime-targets.ts`,
`runtime-info.ts`, `install-lock.ts`, `runtime-upgrade.ts`. `EngineSpec` gains
`image(hardware)` (NVIDIA CUDA image per engine, pinned by digest);
`/runtime/targets` collapses to "docker present + image pulled" per engine;
engine jobs become image pulls. `doctor`/`/compat` check
`nvidia-container-toolkit`.

### Frontend follow-through

Configure page loses llamacpp/mlx runtime cards; Models page fit rules drop
GGUF sizing; recipes UI reads the same wire shapes (unchanged in Stage 0).

## Deployment note (pop-os)

The currently running native vLLM model keeps serving until its next restart.
After Stage C deploys, the next `POST /launch/:recipeId` requires docker +
nvidia-container-toolkit on the controller host. Plan the switchover with a
maintenance window; `data/controller.db` recipes remain as backup per the
standing recipe-DB protocol.
