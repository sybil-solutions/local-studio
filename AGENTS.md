# AGENTS.md

Instruction manual for an LLM launched into this repository. Read it before
touching anything, then obey it for every turn.

## What this is

Local Studio — a local-first workstation for running, managing, and using
self-hosted LLM backends. Two modules share one controller API:

- `controller/` — Bun/Hono backend (model lifecycle, OpenAI-compatible proxy,
  GPU/system state, SSE, downloads, settings).
- `frontend/` — Next.js 16 + React 19 UI and the Electron desktop shell. Hosts
  `/agent` (Pi coding agent runtime), settings, usage, recipes, logs, setup.

One machine launches models, watches GPU/runtime state, chats with
OpenAI-compatible endpoints, and runs agent sessions against local or remote
controllers. See README.md for the system outline and architecture diagrams.

## Working agreement

- **Do not ask questions during execution.** Pick the most sensible default,
  proceed, and surface assumptions in the handoff summary. Only stop when
  genuinely blocked (missing credentials, destructive action needing approval).
- Prefer momentum over permission. Make a decision, record it, keep moving.
- Never print, log, commit, or otherwise expose credentials.
- Never bypass git hooks with `--no-verify`.
- **Always rebuild the installed desktop app after shipping frontend work.** Any
  turn that lands a feature or bug fix touching `frontend/` MUST finish by
  rebuilding and reinstalling the canonical Electron app — the desktop bundles
  its own frontend, so uninstalled changes are invisible to the user. Run the
  full reinstall in "Desktop reinstall" below (`desktop:dist` → `rm -rf` +
  `ditto` into `/Applications/Local Studio.app` → relaunch) and confirm
  `GET /api/desktop-health` returns 200 before yielding. Do not make the user
  ask. Skip only for controller-only or docs-only changes that never touch
  `frontend/`, or when the user explicitly says not to.

## Code standards (non-negotiable)

These apply to all new and edited code. Existing code is legacy; do not
"fix" it broadly, but anything you touch must meet these bars.

### No comments

- **Do not leave comments anywhere.** No `//` explanations, no block comments,
  no commented-out code, no `// TODO`. Code is self-documenting.
- If a comment feels necessary, the real fix is to extract a named function so
  the name carries the intent. Do not "leave a note for later."
- Do not add or expand JSDoc unless a public API contract genuinely requires it;
  prefer a precise type signature over prose.

### One function, one thing

- Keep functions clean and composable: one function does one thing.
- If a function does two things, split it into two named functions and compose
  them. Name functions after what they return/produce, not what they do
  incidentally.
- Pure helpers over inline branching. Prefer early returns over nested nests.

### DRY

- Do not duplicate logic. If two call sites share logic, extract it once.
- Do not reinvent types; reuse `controller/contracts` (the `@local-studio/contracts` package) and existing `@/lib` types.
- The `check:dupes` (jscpd) and `check:deadcode` (knip) gates enforce this.

### Fewest lines that say it

- It is always preferable to accomplish the task in as few lines of code as
  possible, without sacrificing the rules above. No clever golfing that hides
  intent; just no redundant scaffolding, no boilerplate that a helper already
  covers, no five-step ceremony where one composed call suffices.

### Effect — the runtime pattern

Use the Effect pattern for async, scheduling, fibers, and streaming. Docs:
<https://effect.website/docs> and <https://effect.website/docs/schema>. Follow
the Effect v4 idioms already established in this repo.

- Prefer `Effect.gen`, `Effect.sync`, `Effect.tryPromise`, `Effect.sleep`,
  `Schedule.spaced`/`Schedule.exponential`, and `Stream` over hand-rolled async.
- Fork interruptible fibers with `Effect.runFork` and clean them up on unmount.
  Real examples: `src/lib/effect-timers.ts` (`effectInterval`/`effectTimeout`),
  `src/features/agent/runtime/effect-coalescer.ts`.
- **`useEffect` is banned** in feature/render code. Use `useSyncExternalStore`
  with a module-level store whose `subscribe` owns Effect fibers (see
  `src/hooks/realtime-status-store.ts`, `src/hooks/use-controller-events.ts`).
  The few surviving `useEffect` calls are error-boundary legacy; do not add more.
- Validate data at boundaries with Effect v4 `Schema`, not ad-hoc guards.

### UI — use the kit, do not reinvent

- Build UI from the primitives in `frontend/src/ui/` (barrel: `@/ui`). Use
  `Button`, `Input`, `Select`, `Textarea`, `Checkbox`, `FormField`,
  `SegmentedControl`, `Tabs`, `Card`, `Alert`, `Table`/`THead`/`TBody`/`TRow`/
  `TH`/`TCell`, `ListGroup`/`ListRow`, `AppPage`/`PageHeader`, `Modal`, `Slider`,
  `ProgressBar`, `Stat`, `ErrorBox`, `MarkdownContent`, etc. Do not hand-roll
  controls, dialogs, or layout shells that the kit already provides.
- Layering is enforced by `scripts/validate-ui-structure.mjs` and the
  `check:ui-structure` gate:
  - `src/ui` — shared primitives only; never import features or app code.
  - `src/features` — one folder per page-feature; never import app code.
  - `src/app` — thin route shells composing features; no `_components` trees.
  - `src/components` — retired; must stay empty.
  - `src/lib`, `src/hooks` — shared layer; every module needs consumers in more
    than one feature (the gate fails otherwise).
- Use the ZCode design tokens in `src/app/styles/globals/tokens.css`
  (`--color-*`, `--surface`, `--border`, `--fg`, `--dim`, `--accent`, `--fs-*`).
  Do not hard-code colors or spacing; reach for a token.

### TypeScript

- No `any`. No `@ts-ignore`. No unchecked casts. If the type is wrong, fix the
  type. `@/` path alias maps to `src/`.
- `typecheck` and `typecheck:desktop` must stay green.

## Validation (run before handoff)

```bash
npm --prefix frontend run check:quality   # lint + typecheck + desktop typecheck
                                           # + cycles + ui-structure + knip + jscpd + depcheck + build
npm run check                              # full repo gate (contracts + structure + frontend + controller)
npm --prefix frontend run test             # frontend unit tests (bun test scripts)
npm run test:integration                   # controller integration + frontend regression suites (bun test)
```

The pre-push hook (`.githooks/pre-push`) checks conventional commits and runs
`npm --prefix frontend run check:quality`. It must pass before every push.

## Commits and releases

- Conventional commits only: `feat:`, `fix:`, `perf:`, `refactor:`, `micro:`,
  `release:`, `docs:`, `test:`, `build:`, `ci:`. `feat` → minor, everything
  else listed → patch, breaking → major. Verified by
  `scripts/check-conventional-commits.mjs`.
- **Microcommits:** every turn that changes files commits exactly one logical
  change. Stage only files changed that turn. No empty commits. No batching
  unrelated work. If a turn spans concerns, make multiple commits.
- Releases are automated. Pushing to `main` triggers the `release.yml` workflow,
  which runs semantic-release (`release.config.cjs`): it analyzes commits since
  the last tag, cuts the next tag, and publishes a GitHub Release with generated
  notes. There is no npm publish (private monorepo, protected `main`). To cut a
  release, push conventional commits to `main`; do not tag by hand.

## Sensitive configuration

Never commit secrets. Put them in `.env.local` (gitignored). See `.env.example`
for variable names. The deploy script reads `REMOTE_HOST`, `REMOTE_USER`,
`REMOTE_PATH` (and optional `REMOTE_SSH_KEY`) from `.env.local`.

## Deployment

### Local Mac dev / verification

- Agent surface: `http://localhost:3001/agent`.
- Run: `cd frontend && PORT=3001 npm run dev`.
- **Do not run dev unless asked.** If a dev server is already running, use it.
- Desktop dev mode (Electron against the local dev server, no rebuild needed):

```bash
# Terminal 1
cd frontend && PORT=3001 npm run dev
# Terminal 2
cd frontend && npm run desktop:build:main && LOCAL_STUDIO_DESKTOP_DEV_SERVER_URL=http://127.0.0.1:3001 npm run desktop:start
```

Prefer this while iterating on the Mac app.

### Build modes

Fast desktop test build (local testing only, not the pre-push gate):

```bash
cd frontend && npm run desktop:pack
```

Production / pre-push / release artifact:

```bash
cd frontend && npm run desktop:dist
```

### Desktop reinstall (required after any frontend change)

The desktop app bundles its own copy of the frontend (embedded standalone Next
server). Remote/web deploys (`./scripts/deploy-remote.sh frontend`) update only
the homelab web UI (`:3000`), **not** the installed desktop app. Whenever you
touch `frontend/`, rebuild and reinstall the canonical app:

```bash
rm -rf "/Applications/Local Studio.app"
ditto "frontend/dist-desktop/mac-arm64/Local Studio.app" "/Applications/Local Studio.app"
rm -rf "$HOME/Applications/local-studio-mac.app"
killall "Local Studio" >/dev/null 2>&1 || true
for i in $(seq 1 20); do pgrep -x "Local Studio" >/dev/null || break; sleep 0.5; done
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/Local Studio.app"
open "/Applications/Local Studio.app"
```

Canonical app: `/Applications/Local Studio.app`. Canonical bundle id:
`org.local.studio.desktop`. One canonical install only — never layer a new
bundle over the old one (stale sealed resources break the code signature). The
`rm -rf` + `ditto` reinstall is explicitly approved; do not leave builds under
`frontend/dist-desktop/`. A separate beta app (own name, bundle id, user data
path) is the exception, only for risky feature-branch testing.

### Remote / LAN

- Controller binds `127.0.0.1` by default. Non-loopback
  (`LOCAL_STUDIO_HOST=0.0.0.0`) requires `LOCAL_STUDIO_API_KEY`; on a trusted LAN
  you may instead set `LOCAL_STUDIO_ALLOW_UNAUTHENTICATED=true`.
- Point the frontend at a remote controller with `BACKEND_URL` /
  `NEXT_PUBLIC_API_URL` (default `http://localhost:8080`).
- Deploy: `./scripts/deploy-remote.sh controller|frontend|status`. Syncs with
  rsync over ssh (no tar pipe). Remote `next build` may fail (turbopack +
  redis), so the script builds locally and ships `.next/`.

## Agent runtime + filesystem

- The agent page uses `@earendil-works/pi-coding-agent` directly in the Next.js
  Node process (no `pi --mode rpc` subprocess, no bundled CLI). Entry point:
  `services/agent-runtime/src/pi-runtime.ts` → `piRuntimeManager.getSession(id)`.
  Extensions/skills are wired in `services/agent-runtime/src/pi-runtime-helpers.ts`.
- Agent file read/write in chat is local-only, stored under `data/agentfs`. The
  filesystem root boundary (`src/features/agent/fs-store.ts`) trusts the caller's
  workspace cwd while rejecting filesystem roots and system directories. If file
  operations break, inspect `data/agentfs` and restart the controller before
  debugging frontend state.

## Notes

- Remote server: AMD EPYC, 4x RTX PRO 6000 Blackwell, CUDA 12.8
  (host in `.env.local`).
- `npm run start` runs the standalone server (`scripts/start-standalone.mjs`).
  Never use plain `next start` — it breaks SSE streaming.
- Engine installs (vLLM/SGLang/MLX) live in `<data dir>/runtime/venvs/<backend>-latest`,
  using `uv` when present, pip otherwise. Model weights live in
  `LOCAL_STUDIO_MODELS_DIR` (default `/models`).
