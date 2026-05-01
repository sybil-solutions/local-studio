# Pattern 8 — Per-session runtime keys

Long-lived external processes are managed by **keying on a tuple of
business identity** and reusing the existing process when the key matches.
A key change triggers a teardown + restart; an identical key short-circuits
to the existing process.

## The canonical example

`frontend/src/lib/agent/pi-runtime.ts` defines `PiRuntimeManager` and
`PiRpcSession.ensureStarted(modelId, cwd, piSessionId, browserToolEnabled)`.

### The session key

`PiRuntimeManager.getSession(sessionId)` returns one `PiRpcSession` per
`sessionId`. Each `PiRpcSession` then enforces an **inner key** that
captures the launch-relevant identity:

```ts
const matches =
  this.process &&
  !this.process.killed &&
  this.currentModelId === modelId &&
  this.currentCwd === resolvedCwd &&
  this.currentPiSessionId === desiredSessionId &&
  this.currentBrowserToolEnabled === browserToolEnabled;
if (matches) return;          // reuse
// otherwise: stop() and start() with the new key
```

The four-tuple `(modelId, cwd, piSessionId, browserToolEnabled)` is the
inner key. Any change requires a fresh `pi --mode rpc` child because
those values are passed as command-line arguments and cannot be changed
mid-process.

### The outer (per-tab) key

`PiRuntimeManager.sessions: Map<string, PiRpcSession>` keys by
`sessionId` — passed in by the caller, defaulting to `"default"`. The
agent surface uses **per-tab** session ids so that each open tab has its
own `pi` child:

```ts
class PiRuntimeManager {
  private sessions = new Map<string, PiRpcSession>();
  getSession(sessionId = DEFAULT_SESSION_ID): PiRpcSession {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created = new PiRpcSession();
    this.sessions.set(sessionId, created);
    return created;
  }
}
```

The session id is itself stable per tab — see commit `88371e55 micro:
scope new session to projects + per-tab pi runtime`.

The manager itself is a process-global singleton stashed on `globalThis`
so HMR doesn't multiply it:

```ts
const globalForPi = globalThis as typeof globalThis & {
  __vllmStudioPiRuntime?: PiRuntimeManager;
};
export const piRuntimeManager =
  globalForPi.__vllmStudioPiRuntime ?? new PiRuntimeManager();
globalForPi.__vllmStudioPiRuntime = piRuntimeManager;
```

## Where the pattern shows up elsewhere

| File | Key | What's keyed |
|------|-----|--------------|
| `frontend/src/lib/agent/pi-runtime.ts` | `(sessionId)` then `(modelId, cwd, piSessionId, browserToolEnabled)` | `pi --mode rpc` child process |
| `frontend/src/lib/agent/browser-bridge.ts` | (none — singleton) | The in-memory bridge is a single global instance |
| `controller/src/modules/engines/layers/process-manager.ts` | `(model_path, port)` via `findInferenceProcess` | The vLLM/SGLang/llama.cpp inference subprocess (one at a time, but matched on identity) |
| `controller/src/modules/engines/layers/engine-coordinator.ts` | `isRecipeRunning(recipe, current)` | Decides whether to skip the spawn step when the desired recipe is already live |

## Why this pattern

- **Cheap reuse, expensive change.** Reusing an existing `pi` child saves
  ~hundreds of milliseconds of startup and the model-config write.
  Restarting on key change keeps the protocol simple — no in-process
  reconfiguration needed.
- **Identity, not handle.** Callers pass *what they want* (model id,
  cwd, session id), not *which child* to use. The runtime decides whether
  to reuse or restart.
- **Safe under concurrent calls.** `ensureStarted` uses a single
  `this.starting: Promise<void> | null` to deduplicate concurrent start
  requests:

  ```ts
  if (this.starting) await this.starting;
  // recheck the key match after the start completes
  ```
- **Globally singleton via `globalThis`.** Survives Next dev-server HMR
  reloads. Without this, every code edit would orphan a child process.

## Trade-offs

- **No eviction.** `PiRuntimeManager.sessions` grows monotonically. If a
  user opens and closes 50 tabs in one session, 50 `pi` children remain
  alive (the children may exit on their own when they detect a closed
  stdin, but there is no manager-driven cleanup).
- **Browser-tool toggle = restart.** Switching `browserToolEnabled`
  forces a fresh process because `--extension <path>` can only be passed
  at launch. This is a minor UX hiccup (loses scrollback / prompt
  context).
- **Tuple-based identity is brittle.** Adding a fifth field to the launch
  config (e.g., reasoning effort) requires updating both the inner-key
  comparison *and* the start args. The match function is hand-rolled.
- **`globalThis` cache is opaque.** Tests have to remember to reset
  `globalForPi.__vllmStudioPiRuntime` between cases.

## Cross-references

- [Chapter 1 — `pi-runtime.md`](../chapter-01-frontend/pi-runtime.md) — full deep-read of the manager + session.
- [Chapter 1 — `chat-pane-deep-dive.md`](../chapter-01-frontend/chat-pane-deep-dive.md) — how the renderer chooses a session id per tab.
- [Pattern 3 — Subprocess RPC](./subprocess-rpc.md) — the protocol the keyed children speak.
- [Pattern 13 — Extension injection](./extension-injection.md) — why `browserToolEnabled` is part of the key.
