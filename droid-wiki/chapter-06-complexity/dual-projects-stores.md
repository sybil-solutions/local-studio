# 6 — Two parallel "projects" stores

> **Severity:** High
> **Cross-link:** [Chapter 1 — stores-and-state](../chapter-01-frontend/stores-and-state.md), [pi-runtime](../chapter-01-frontend/pi-runtime.md)

## Verified files

```
144 frontend/desktop/logic/projects-store.ts          (Electron, userData)
136 frontend/src/lib/agent/projects-store.ts          (Next server, data/agentfs)
516 frontend/src/components/projects-nav-section.tsx  (renderer)
```

## Why it's complex

There are **two on-disk locations** for the same logical state — the user's
list of working directories — with **no synchronisation** between them:

| Store | Path | Owner | Reader |
|-------|------|-------|--------|
| Electron store | `app.getPath("userData")/projects.json` | desktop main process | renderer via `desktop:list-projects` IPC |
| Next server store | `<repo>/data/agentfs/projects.json` | Next API route handlers | renderer via `/api/agent/projects` HTTP, **and** pi-runtime's `listProjectsFromStore()` |

The renderer's `loadAgentProjects()` prefers the Electron IPC bridge when
available; otherwise it falls back to HTTP. So in **the desktop app**, the
authoritative store is `userData/projects.json`. But `pi-runtime.ts`
(running in the embedded Next standalone server) reads the **server**
store via `listProjectsFromStore()`, never the Electron store.

```mermaid
graph LR
  Renderer[Renderer<br/>projects-nav-section.tsx] -.IPC.-> ElectronStore[(userData/projects.json)]
  Renderer -.HTTP fallback.-> ServerStore[(data/agentfs/projects.json)]
  PiRuntime[pi-runtime.ts<br/>resolveDefaultAgentCwd] -->|always reads| ServerStore
  Workspace[agent-workspace.tsx] -.uses selected.-> Renderer
  Workspace -->|sends cwd to| Turn[/api/agent/turn]
  Turn -->|invokes| PiRuntime
```

## Concrete failure modes

1. **Add project in Desktop, skip server store**: the renderer adds it via
   `desktop:add-project` IPC, which writes to `userData/projects.json`.
   The server store is unchanged. If the renderer-supplied `cwd` reaches
   `pi-runtime` correctly, things work. If `cwd` is empty (e.g., URL-param
   resumption races a project list re-load), pi-runtime falls through to
   `listProjectsFromStore()` and gets a **stale or empty list** from the
   *other* store.
2. **Server store is the only fallback for "most-recent" cwd**:
   `resolveDefaultAgentCwd()` picks the most-recently-added project from
   the server store. The desktop user has no idea the server store
   exists; their "most recent" project as recorded by Electron is
   different from what pi sees.
3. **Test harness pollution**: a developer running `cd frontend && npm
   run dev` populates the server store. Switching to the desktop app
   later, that server store is still there but nothing in the UI shows
   it.

## Implicit invariants

- The Electron store and the server store should hold the same list. No
  code enforces this.
- `loadAgentProjects()` is the only function that abstracts over the two
  stores. Anyone bypassing it (e.g., the URL-param resumption code, or
  `pi-runtime`) sees only one of the two.
- `listProjectsFromStore()` is exported synchronously and reads the file
  with `existsSync`/`readFileSync`. It is called inside `pi-runtime`'s
  `resolveDefaultAgentCwd` which runs every spawn.

## What could simplify it

- Pick one store. The Electron store is appropriate for desktop; the
  server store is appropriate for hosted Next. Pick based on deployment
  target, not "whichever responded first".
- Make the renderer's transport selection explicit (`useProjectsTransport()`
  hook) so it's clear which store any given write hit.
- If both stores must coexist (pi-runtime really does run inside Next
  standalone in Electron), make the Electron main process *write through*
  to the server store on every mutation so they stay aligned.
- Surface the discrepancy in a dev-only diagnostic — e.g., compare on
  startup and warn if the lists differ.
