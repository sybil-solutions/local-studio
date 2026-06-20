# Frontend performance & bundle-size profile (2026-06-19)

Profiled the desktop app's bundle, route performance, and console for the
size/perf/errors pass. Headline: the app is already well-optimized; the one
large lever needs a decision.

## Bundle (client JS — `.next/static/chunks`, total ≈ 2.85 MB)

| Chunk | Size | Contents | Status |
|---|---|---|---|
| `e868780c…` | 336K | **xterm** (terminal) | ✅ already lazy — type-only + dynamic `import()` in `terminal-panel.tsx`; loads only when the Terminal tab opens, NOT in the initial agent bundle. |
| `512…` | 244K | **effect** (Effect-TS) | ⚠️ eager — see below |
| `3794…`, `4bd1b696…` | 220K + 196K | effect / ansi / app | ⚠️ effect spread here too |
| `app/agent/page` | 212K | the agent route's own code | — |
| `framework`, `main` | 188K + 144K | React + Next runtime | baseline |
| `9654…` | 152K | react-markdown / remark-gfm | core to chat (eager, unavoidable) |
| highlight.js | — | core + 12 languages only | ✅ already lean (not the full ~1 MB build) |

### The one big lever: Effect-TS (~244K, plus spread across vendor chunks)
`effect` is imported directly in 7 runtime/hooks files — `runtime/effect-coalescer.ts`,
`runtime/prompt-stream.ts`, `runtime/session-runtime-controller.ts`,
`hooks/realtime-status-store.ts`, `hooks/use-controller-events.ts`,
`lib/effect-timers.ts`, `setup/use-setup.ts` — for `Effect.gen` / `Fiber` / `Schedule`
(async control flow, concurrency, retry timing). It is eagerly loaded by the agent route.

- **`optimizePackageImports: ["effect"]` is a NO-OP here** (measured: identical chunk
  sizes AND hashes). The app genuinely uses the `Effect`/`Fiber`/`Schedule` namespaces,
  so tree-shaking can't remove them.
- The only real reduction is **de-Effect-ifying the runtime** — replace `Effect.gen`
  with async/await, `Fiber` with `AbortController`, `Schedule` with `setInterval`/
  `setTimeout`. That's a **large, higher-risk refactor across the critical streaming
  path** (and it's the runtime WIP). **Needs an explicit go-ahead.** Estimated saving:
  ~200–350K off the initial agent bundle.

### Lower-value lever: right-panel tabs are eagerly imported
`AgentBrowser`, `CanvasPanel`, `FilesystemPanel`, `GitDiffPanel`, `ComputerStatusPanel`
are static imports in `computer-tab-panel.tsx` (only Terminal/xterm is lazy). The right
panel is closed by default, so lazy-loading them would defer their unique code — but they
**share most deps with chat** (markdown, highlight), so the NET saving is modest. Doable
(same xterm pattern) if desired; low payoff vs. small risk.

## Runtime performance — good
- Route switches (Status/Usage/Models/Plugins/Server): **6–17 ms** each. No jank.
- **Zero app-origin console errors/warnings** after navigation. (The errors visible in
  the console — census.gov, GPT/Permutive/Freestar ad-tech — are third-party web content
  rendered in the in-app browser panel, not the app.)

## Recommendation
Bundle and runtime are in good shape. The single meaningful size win is removing Effect
from the client runtime — worth doing if you want the ~200–350K, but it's a deliberate
refactor of the streaming path that should be greenlit, not done blind.
