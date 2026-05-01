# Pattern 10 — Project picker + project store dual-write

The agent surface keeps a list of "open projects" (working directories
the user has chosen to work in). The same data is stored in **two
different places** — once by the Electron main process, once by the
Next.js server — and the renderer reads from whichever is available.

## The two stores

| File | Where it stores | Owner | When it's used |
|------|-----------------|-------|----------------|
| `frontend/desktop/logic/projects-store.ts` | `app.getPath("userData")/projects.json` | Electron main process | Packaged desktop app |
| `frontend/src/lib/agent/projects-store.ts` | `<repo>/data/agentfs/projects.json` (server-side via `process.cwd()`) | Next.js server (the route handlers under `/api/agent/projects`) | Browser dev mode (no Electron) |

Both files share the same TypeScript shape (`ProjectRecord`, `ProjectsDocument`)
and both write atomically via a `<file>.<pid>.<ts>.tmp` rename pattern.

## The renderer's "dual reader"

`frontend/src/components/projects-nav-section.tsx` (517 LoC) reads from
whichever store the runtime exposes:

```ts
function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { vllmStudioDesktop?: Partial<DesktopBridge> })
    .vllmStudioDesktop;
  if (!candidate) return null;
  const hasBridgeMethod =
    typeof candidate.openDirectory === "function" ||
    typeof candidate.getPathForFile === "function" ||
    typeof candidate.listProjects === "function" ||
    typeof candidate.removeProject === "function";
  return hasBridgeMethod ? (candidate as DesktopBridge) : null;
}

// Then in the component:
const desktopBridge = getDesktopBridge();
if (desktopBridge?.listProjects) {
  // Electron path: IPC -> main process -> userData/projects.json
  return await desktopBridge.listProjects();
} else {
  // Server path: HTTP fetch -> /api/agent/projects -> data/agentfs/projects.json
  const response = await fetch("/api/agent/projects");
  return (await response.json()).projects;
}
```

The Electron preload script (`frontend/desktop/preload.ts`) exposes
`window.vllmStudioDesktop = { openDirectory, listProjects, addProject,
removeProject, getPathForFile }` via `contextBridge.exposeInMainWorld`.
In dev mode there's no preload, the global is undefined, and the
renderer falls back to HTTP.

Likewise `pi-runtime.ts` reads the **server-side** store directly when
`process.cwd()` returns "/" (i.e., in a packaged Electron app where the
working directory is unset):

```ts
// resolveDefaultAgentCwd() in pi-runtime.ts
try {
  const projects = listProjectsFromStore();
  const usable = projects.find((entry) => entry.exists);
  if (usable) return usable.path;
} catch {
  // ignore — projects.json may not exist yet
}
```

## Why this pattern

- **Same code path in dev and production.** The renderer doesn't branch
  on `process.env.IS_ELECTRON` or similar — it sniffs for the bridge.
- **Each store is correct for its environment.** `userData/` is the
  Apple/Microsoft-blessed location for app config; `data/agentfs/` is
  the convention used elsewhere in the repo for server-managed state.
- **Survives Electron sandboxing.** The renderer process can't write to
  arbitrary paths under the Electron sandbox, so going through IPC is
  necessary; the server-side store, in contrast, is for the vanilla
  next-dev case.
- **Lazy initialization.** If `projects.json` doesn't exist, both
  readers return `{ projects: [] }`. There's no migration step.

## Trade-offs

- **Divergence is silent.** If a user runs both `npm run dev` and the
  packaged app on the same machine, they get **two different project
  lists**. Adding a project on the dev side does not appear on the
  packaged side and vice versa. This is flagged for Chapter 7.
- **Two file-IO implementations to maintain.** They are
  byte-for-byte similar but not literally identical: one resolves
  `path.join(app.getPath("userData"), "projects.json")`, the other
  `path.resolve(process.cwd(), "..", "data", "agentfs", "projects.json")`.
  A breaking change has to be made in both places.
- **Ambient global on `window`.** The renderer sniffs
  `window.vllmStudioDesktop` — not type-safe across the bridge unless
  you maintain the `DesktopBridge` interface manually.
- **No conflict resolution.** When `pi-runtime.ts`'s server-side reader
  picks a default cwd, it does not consult the Electron store, so on a
  cold start in the packaged app the agent's first cwd may not match
  the user's last selection until the renderer fetches from
  `vllmStudioDesktop.listProjects()` and writes back.

## Cross-references

- [Chapter 1 — `electron-desktop.md`](../chapter-01-frontend/electron-desktop.md) — preload + IPC details.
- [Chapter 1 — `stores-and-state.md`](../chapter-01-frontend/stores-and-state.md) — server-side projects store and other agent state files.
- [Chapter 1 — `agent-workspace-deep-dive.md`](../chapter-01-frontend/agent-workspace-deep-dive.md) — how the renderer's project picker is wired.
- [Chapter 7 — TBD] — divergence as a failure mode.
