# 10 — Next API → pi process lifetime

> **Severity:** Medium
> **Cross-link:** [Chapter 1 — pi-runtime](../chapter-01-frontend/pi-runtime.md), [api-routes](../chapter-01-frontend/api-routes.md), [electron-desktop](../chapter-01-frontend/electron-desktop.md)

## The implicit lifetime

`frontend/src/lib/agent/pi-runtime.ts` exposes a singleton:

```ts
const globalForPi = globalThis as { __vllmStudioPiRuntime?: PiRuntimeManager };
export const piRuntimeManager =
  globalForPi.__vllmStudioPiRuntime ??
  (globalForPi.__vllmStudioPiRuntime = new PiRuntimeManager());
```

The singleton owns a `Map<string, PiRpcSession>`. Each entry is a
**long-lived child process** spawned via `spawn(piBinaryPath(), [...])`.

The route handler `frontend/src/app/api/agent/turn/route.ts`:

1. Receives `{ sessionId, modelId, message, cwd, piSessionId, browserToolEnabled }`.
2. Calls `piRuntimeManager.getSession(sessionId).ensureStarted(...)`.
3. Streams pi's events back to the client over SSE.

**The HTTP route handler returns long before the pi child exits.** The pi
process is held alive by the singleton in `globalThis`, not by the
request lifetime.

## Why it's complex

### Lifetime mismatch (dev)

In development, Next.js uses HMR. Modules can be reloaded; the
`__vllmStudioPiRuntime` stash on `globalThis` is the trick that prevents
each HMR pass from leaking a fresh pi child. That is **load-bearing for
correctness in dev** and easy to mistake for boilerplate.

### Lifetime mismatch (production / Electron)

In packaged Electron the topology is:

```
Electron (main process)
  └── Next standalone server (child process)
        └── pi --mode rpc (grandchild)
              └── browser extension (loaded as code, not a child process)
```

Three nested processes. If the user closes the Electron app:

- Electron sends SIGTERM to the Next server.
- The Next server's `process.on('exit')` does **not** explicitly stop pi
  children — the singleton has no `Symbol.dispose` and no shutdown hook
  registered in any module body that always runs.
- pi children inherit the parent's death-signal handling. If pi handles
  SIGTERM correctly they exit; if they wedge they remain.

There is a `stop()` method on `PiRpcSession` (SIGTERM, 500 ms wait,
SIGKILL) but nothing calls it during shutdown.

### Lifetime mismatch (hosted, multi-user)

If this surface were ever served to multiple users, every browser tab
would map to a long-lived pi child living in the *one* server process.
The singleton has no eviction policy. The 30-minute prompt timeout is the
only ceiling on a wedged child, and it's tied to a single command call,
not to inactivity.

## Coupling diagram

```mermaid
graph LR
  Browser[Browser tab] -->|HTTP POST /api/agent/turn| Route[turn/route.ts]
  Route --> Manager[piRuntimeManager singleton]
  Manager --> Map[(Map sessionId → PiRpcSession)]
  Map --> Pi[pi --mode rpc child]
  GlobalThis[globalThis __vllmStudioPiRuntime] -->|holds| Manager
  Note1[HMR reuse] -.depends on.-> GlobalThis
  Note2[no shutdown hook] -.depends on.-> Manager
  Pi -. dies on . -> SIGTERM[OS SIGTERM cascade]
```

## Implicit invariants

- The Node process serving Next outlives every HTTP request.
- HMR preserves the singleton via `globalThis`.
- pi children are killed only via explicit `stop()` calls (which
  `ensureStarted` only does on identity mismatch) or via OS signal cascade.
- Two different routes calling `getSession("default")` share a child.
- The `runtimeSessionId` is generated client-side per browser tab. A
  page refresh creates a *new* runtime session id and orphans the
  previous pi child until OS signals arrive.

## What could simplify it

- Register a process-level shutdown hook that calls `stop()` on every
  session in the manager. Today there is no centralised cleanup.
- Add an inactivity-based eviction policy (e.g., a session whose last
  prompt was > N minutes ago is stopped and removed).
- Make page refresh detectable: when the renderer reconnects with a new
  `runtimeSessionId`, the previous one is orphaned. Either surface it to
  the user as a list of "abandoned sessions to reclaim", or evict it.
- Document the `globalThis` trick at the top of `pi-runtime.ts` so it's
  clear why the dance is necessary.
