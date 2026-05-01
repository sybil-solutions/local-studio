# Pattern 6 — Layered module structure

The five-phase controller refactor (see `MIGRATION.md`) replaces a
loose-bag-of-files layout with a strict per-module skeleton. Every domain
module on `feat/plop-t3code-with-pi` has the same shape:

```
modules/<domain>/
├── index.ts              # public barrel — only re-exports the service & a few constructors
├── types.ts              # public types
├── configs.ts            # constants/timeouts (optional)
├── routes.ts             # thin HTTP wiring; depends on the service interface only
├── routes.test.ts        # route-level tests with a fake service
├── services/
│   └── <name>-service.ts # the public TS interface (the contract)
└── layers/
    ├── <name>-coordinator.ts       # the implementation
    ├── <name>-machine.ts           # state machines (optional)
    ├── <name>-store.ts             # persistence (optional)
    └── <other concrete IO files>
```

## Where it appears

| Module | Public barrel | Service interface | Implementation |
|--------|---------------|-------------------|----------------|
| `controller/src/modules/engines/` | `index.ts` (9 LoC) | `services/engine-service.ts` | `layers/engine-coordinator.ts` (+ `download-machine.ts`, `download-manager.ts`, `process-manager.ts`, `backend-builder.ts`, `runtime-info.ts`, `vllm-runtime.ts`, `llamacpp-runtime.ts`, `huggingface-api.ts`, …) |
| `controller/src/modules/system/` | `index.ts` (10 LoC, `export *` style) | `event-manager.ts` (class as service) | `metrics-collector/`, `metrics-store.ts`, `metrics.ts`, `platform/`, `usage/` |
| `controller/src/modules/models/` | `index.ts` (4 LoC) | (no separate `services/`; class in same file) | `model-browser.ts`, `recipes/recipe-store.ts`, `recipes/recipe-matching.ts`, `recipes/recipe-serializer.ts` |
| `controller/src/modules/proxy/` | `routes.ts` (14 LoC composer) | (operations as free functions) | `openai-routes.ts`, `tool-call-parser.ts`, `tool-call-stream.ts`, `reasoning-extractor.ts`, `content-normalizer.ts`, `tokenization-routes.ts` |
| `controller/src/modules/jobs/` | `index.ts` (re-exports) | `job-manager.ts` (class as service) | `workflows/`, `auto-orchestrator.ts`, `memory.ts`, `job-store.ts` |

The `engines/` module is the canonical example — it was the first phase of
`MIGRATION.md` and the others were modeled on it.

## Why this pattern

- **One-glance public API.** `cat controller/src/modules/engines/index.ts`
  shows you everything an external caller can import. Nine lines.
- **Clean test seam.** `routes.test.ts` constructs a mock that implements
  `EngineService` and registers the routes against it. No filesystem,
  process, or network involvement.
- **Layers naming reads top-down.** `services/` defines the contract;
  `layers/` is "the stuff under the contract". When a new contributor
  asks "where does the spawn-the-process logic live?" the answer is
  always under `layers/`.
- **HTTP routes can't bypass the contract.** Routes import only the
  service type — not the coordinator, not the layers. If a route
  reaches into `layers/` directly, it's visible at code review.
- **Phase-by-phase migration is mechanical.** `MIGRATION.md` shows the
  same template applied five times. Once a module follows the skeleton,
  the next module's refactor is largely paint-by-numbers.

## What sits at the boundary of the skeleton

A few files don't fit cleanly:

- `controller/src/app-context.ts` (82 LoC) — the wiring graph. Imports
  every module's constructor and assembles `AppContext`.
- `controller/src/http/app.ts` (106 LoC) — calls each module's
  `register*Routes(app, context)`.
- `controller/src/main.ts` (70 LoC) — server entrypoint.

These three files are the only places where modules are *composed*. Every
module is otherwise self-contained.

## Trade-offs

- **More directories.** Five-files-per-module instead of two means more
  navigation. Tooling helps (file-tree + glob).
- **`layers/` is a soft category.** Some files in `layers/` are pure
  (e.g., `download-math.ts`, `recipe-matching.ts`) and arguably belong in
  a `pure/` subfolder. The PR doesn't make that distinction.
- **`index.ts` discipline depends on review.** Nothing prevents a module
  from re-exporting a `layers/*` file from its barrel; the convention is
  enforced socially. The `engines/index.ts` is a good citizen; you have
  to read it to verify.
- **Controller-only.** The frontend isn't structured this way at all.
  `frontend/src/lib/agent/` is a flat directory of files. The pattern is
  effectively controller-team policy, not house-wide style.

## Cross-references

- [Chapter 2 — index](../chapter-02-controller/index.md) — the before-vs-after directory tree.
- [Chapter 2 — `engines-module.md`](../chapter-02-controller/engines-module.md) — the canonical example.
- [Chapter 2 — `system-module.md`](../chapter-02-controller/system-module.md) — same skeleton, slightly looser barrel.
- [`MIGRATION.md`](../../MIGRATION.md) — the five-phase rollout plan.
- [Pattern 2 — Service & coordinator](./service-and-coordinator.md) — what `services/` and `layers/` actually hold.
