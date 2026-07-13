# Domain Language

The vocabulary this repo's code, docs, and reviews use. One term per concept;
when code drifts from these names, the code is wrong.

## Serving domain (controller)

- **Recipe** — a saved, launchable model configuration (model path, backend,
  parallelism, memory, parsers, extra args). Stored in SQLite via
  `recipeStore`; schema in `controller/contracts/recipes.ts` +
  `controller/src/modules/models/recipes/recipe-serializer.ts`. A recipe is
  *configured*; it says nothing about whether anything is running.
- **Backend / Engine** — the inference server family a recipe launches:
  `vllm | sglang | llamacpp | mlx`. Each is described by an **EngineSpec**
  (`controller/src/modules/engines/engine-spec.ts`): command building,
  invocation detection, install, probing. Engine-specific knowledge belongs in
  `specs/<backend>-spec.ts`, nowhere else.
- **Runtime target** — a discovered place an engine could run from (managed
  venv, system python/binary, Docker image), with priorities and persisted
  selection (`runtimes/runtime-targets.ts`). Distinct from the engine spec's
  probe chain; unifying the two is an open design item.
- **Launch / Evict** — the only sanctioned transitions of the single running
  model, via `POST /launch/:recipeId` and `POST /evict`. The chat proxy never
  launches or switches models.
- **Launch state** — the transitional truth between launch acceptance and
  readiness (`process/launch-state.ts`). The **process scan**
  (`process/process-inventory.ts` + process-manager) is the running truth; the
  **launch failure budget** (`process/launch-failure-budget.ts`) quarantines
  crash-looping recipes. Three sources, one status answer — collapsing them
  into one state machine is the prerequisite for multi-model work.
- **Inference process** — the OS process serving the model on
  `inference_port`, identified by argv signature via each spec's
  `detectInvocation`.

## Proxy domain (controller)

- **Chat proxy** — `/v1/chat/completions` in `modules/proxy/`: normalizes the
  request, resolves the upstream (local engine or provider routing), gates on
  the running model, and streams with a keepalive-first-byte contract (the
  Cloudflare 502 fix). Its stages are `parseChatBody` → `resolveChatUpstream`
  → `gateOnRunningModel` → dispatch.
- **Provider routing** — prefixed model ids (`provider/model`) resolve to
  external OpenAI-compatible upstreams (`services/provider-routing.ts`);
  everything else is `local`.
- **Reasoning quirks** — per-model-family streaming fixups in
  `proxy/reasoning.ts`. Paired knowledge lives at launch time in
  `process/model-runtime-defaults.ts` (parser flags); the two must agree per
  family.

## Agent domain (frontend + services/agent-runtime)

- **Session** — one agent conversation; live state in
  `features/agent/runtime/types.ts` (`Session`), summarized on disk as
  `SessionSummary` and across projects as `AggregatedSession`
  (`shared/agent/session-summary.ts`).
- **Session status** — `idle | starting | running | loading`, owned by
  `features/agent/runtime/session-status.ts` (`isWorkingStatus`, `settleTurn`,
  `settleTurnFinalizingTools`). Do not re-derive from strings.
- **Turn** — one prompt → agent-end cycle. Turn intent (starting/accept/abort)
  belongs to prompt-stream/engine; hydration belongs to loadAndReplay; the
  session-runtime-controller reconciles live events, cursors, and reconnects.
- **Pane / Tab / Workspace** — the UI layout domain (`features/agent/workspace/`):
  a workspace holds panes; a `SessionTab` is a pane's persisted session shell.
  Persistence coerces hydrated tabs to `status: "idle"`.
- **Agent runtime** — `services/agent-runtime/`: the embedded
  pi-coding-agent host (sessions-store, projects-store, pi-runtime). The
  frontend's `/api/agent/*` routes either proxy to it (`proxy-to-runtime.ts`)
  or run in-process.

## Cross-cutting

- **Controller** — the Bun/Hono backend as a whole; also "a controller" =
  one reachable instance the UI points at.
- **Contracts** — types crossing the controller↔frontend HTTP boundary live in
  `controller/contracts/`  exactly once; frontend↔agent-runtime shapes live in
  `shared/agent/`. The `check:contracts` gate enforces single definition.
- **Gates** — the layered checks (`npm run check`: contracts, structure,
  frontend quality, controller checks + unit tests). CI runs them all; a
  change that needs a gate exception is usually a design smell.
