# Chapter 5 — Patterns we use

> Cross-cutting idioms that repeat across `feat/plop-t3code-with-pi`. These
> are the pieces of "shape" the PR introduces or re-commits to, distilled
> from the diff inventories in Chapters 1–4.

The five-phase controller refactor and the new agent surface are not just a
collection of file moves — they are the rollout of a small, opinionated set
of patterns. Several of them already existed in `origin/main` but the PR
doubles down on them; a few are net-new.

## Reading order

Each page is self-contained. If you are short on time, the four most
load-bearing patterns are:

1. [Pure state machines + effects](./state-machines-and-effects.md)
2. [Service-as-contract / coordinator-as-orchestrator](./service-and-coordinator.md)
3. [Subprocess RPC over JSON-line stdio](./subprocess-rpc.md)
4. [SSE event bus with channels](./sse-event-bus.md)

Everything else either composes those four or layers a thin convention on
top of them.

## Pattern catalogue

| # | Pattern | Status | One-line summary |
|---|---------|--------|------------------|
| 1 | [State machines + effects](./state-machines-and-effects.md) | Doubled-down | `dispatch(state, ctx, event) → { state, effects }`, pure transition fn, effects executed at the edge. |
| 2 | [Service & coordinator](./service-and-coordinator.md) | Doubled-down | One TS interface (`EngineService`) + one orchestrator (`EngineCoordinator`); routes never touch the implementation. |
| 3 | [Subprocess RPC over JSONL](./subprocess-rpc.md) | New | `pi --mode rpc` child, id-correlated `{ id, type, command }` requests, EventEmitter for async events. |
| 4 | [SSE event bus with channels](./sse-event-bus.md) | Doubled-down | Server publishes typed events on named channels; client subscribes via `EventSource` and routes by event type → DOM CustomEvent. |
| 5 | [Browser bridge round-trip](./browser-bridge.md) | New | HTTP → in-memory bridge → SSE → webview `executeJavaScript` → POST result. |
| 6 | [Layered module structure](./module-layout.md) | New | `index.ts` barrel + `types.ts` + `configs.ts` + `routes.ts` + `services/` (interfaces) + `layers/` (IO). |
| 7 | [Microcommit hygiene](./microcommits.md) | Doubled-down | 46 of 67 PR commits prefixed `micro:`, enforced by `frontend/AGENTS.md`. |
| 8 | [Per-session runtime keys](./per-session-runtime-keys.md) | New | Long-lived child processes keyed by a tuple of business identity; restart on key change. |
| 9 | [Markdown rendering](./markdown-rendering.md) | New | `react-markdown` + `rehype-highlight` + `remark-gfm` for assistant messages, with a `MarkdownErrorBoundary`. |
| 10 | [Dual-store projects](./dual-store-projects.md) | New | Renderer prefers Electron IPC; falls back to HTTP — two separate stores, intentionally redundant. |
| 11 | [State-machine UI hook](./state-machine-ui-hook.md) | New | `useMachine(machine, context)` adapts the pure machine to React's `useState`. |
| 12 | [Test colocation](./test-colocation.md) | Doubled-down | `*.test.ts` lives next to source; the dedicated `frontend/tests/` Playwright tree was deleted. |
| 13 | [Extension injection](./extension-injection.md) | New | `pi --extension <path>` registers tools at runtime, gated on a UI toggle. |

## Cross-references

- Each page links to the relevant Chapter 1–4 deep-dive(s) where the pattern
  is exercised.
- Pattern *applicability* (where this pattern shows up next, and where it
  doesn't) is referenced; pattern *recommendations* live in Chapter 7.

## A note on what is NOT a pattern in this PR

Two things look like patterns but aren't, after reading the diff carefully:

- **DI containers.** `app-context.ts` is a hand-wired struct, not a
  container. There is no Inversify, tsyringe, or pi-style provider tree.
  This is an explicit design choice — Chapter 2 covers `AppContext` shape.
- **Reactive stores (Zustand/Redux).** Frontend state is mostly
  `useState`/`useEffect`/`useReducer`-equivalent (`useMachine`). The only
  truly persistent state on the renderer is in browser-level `CustomEvent`s
  (see Chapter 1 — `stores-and-state.md`) and in a few `useRef`-backed maps.
  The PR does not introduce a global store library.
