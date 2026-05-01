# 11 — Implicit env / path resolution

> **Severity:** Medium
> **Cross-link:** [Chapter 1 — pi-runtime](../chapter-01-frontend/pi-runtime.md), [electron-desktop](../chapter-01-frontend/electron-desktop.md)

## The three resolvers

`frontend/src/lib/agent/pi-runtime.ts` contains three independent path
resolvers, each walking a list of candidates:

### `resolveBrowserExtensionPath()` — 5 candidates

```ts
const candidates = [
  process.env.VLLM_STUDIO_BROWSER_EXTENSION_PATH,
  process.resourcesPath
    ? path.join(process.resourcesPath, "desktop/resources/pi-extensions/browser.ts")
    : null,
  // …three more dev-mode candidates (relative to cwd)
];
```

### `getWritableDataDir()` — 6 candidates

```ts
const candidates = [
  process.env.VLLM_STUDIO_DATA_DIR,
  path.join(process.cwd(), "data"),
  path.join(process.cwd(), "..", "data"),
  path.join(process.cwd(), "frontend", "data"),
  path.join(homedir(), ".vllm-studio"),
  path.join(tmpdir(), "vllm-studio"),
];
```

The function picks the first candidate that `existsSync` returns true
for, otherwise falls back to the first one regardless of existence.

### `resolveDefaultAgentCwd()` — 5 fallback steps

```ts
1. VLLM_STUDIO_AGENT_CWD env var
2. listProjectsFromStore().find(usable) — most-recent existing project
3. process.cwd() basename === "frontend" → repo root
4. process.cwd() === "/" or "" (packaged Electron) → homedir()
5. process.cwd() as-is
```

## Why it's complex

### No diagnostic on which path was picked

When `pi-runtime.ts:start()` fails — say with `ENOENT` because the
extension path was wrong, or the data dir wasn't writable — the error
message tells you what failed but not which of the candidate paths the
resolver chose. To debug "why doesn't the browser tool work?", a
contributor must read `resolveBrowserExtensionPath()` and mentally execute
it with the env vars they happen to have set.

### Silent fallback semantics differ between resolvers

- `resolveBrowserExtensionPath()` returns `null` if no candidate exists →
  the `--extension` arg is omitted → browser tools simply don't appear in
  pi's tool list, with no UI signal.
- `getWritableDataDir()` falls through to the first candidate even if it
  doesn't exist → the next operation (`mkdir`) might succeed (creating
  the dir) or fail. The resolver doesn't know the difference.
- `resolveDefaultAgentCwd()` is synchronous and never throws — it always
  returns *some* string, including potentially `"/"` if the user has
  `VLLM_STUDIO_AGENT_CWD=/` in env.

### Cross-resolver inconsistency

`pi-runtime.ts:getWritableDataDir()` returns a path under which it
creates `<dataDir>/pi-agent/`. `controller/src/modules/system/usage/pi-sessions.ts`
reads from `~/.pi/agent/sessions/` by default — pi's *own* default, not
the path that pi-runtime is steering pi towards via
`PI_CODING_AGENT_DIR=<dataDir>/pi-agent`. **The two paths can diverge.**
(See [#7 usage-metrics-fragmentation](./usage-metrics-fragmentation.md).)

### Env var sprawl

A single pi spawn reads:

```
PATH (with /opt/homebrew/bin and ~/.bun/bin injected)
PI_CODING_AGENT_DIR (set by pi-runtime to <dataDir>/pi-agent)
PI_SKIP_VERSION_CHECK = "1"
VLLM_STUDIO_FRONTEND_BASE (Electron app-server.ts overrides; dev derives from PORT)
VLLM_STUDIO_DATA_DIR (consumed by getWritableDataDir)
VLLM_STUDIO_AGENT_CWD (consumed by resolveDefaultAgentCwd)
VLLM_STUDIO_BROWSER_EXTENSION_PATH (consumed by resolveBrowserExtensionPath)
```

The matrix of (env vars set) × (deployment target: dev / packaged /
remote) determines which paths are actually used. There is no central
"resolve all paths and log them once" call.

## What could simplify it

- Add a one-time startup log that prints every resolved path with its
  source (env var / dev fallback / homedir / tmpdir). When something
  fails, the logs show which candidate fired.
- Share one `resolveAgentDataDir()` between `pi-runtime` and
  `pi-sessions` so the writer (frontend) and the reader (controller's
  usage module) agree on where pi's session JSONL lives.
- Prefer "fail loudly" over "silently fall back": if no candidate exists
  for the data dir, throw, don't return the first item regardless.
- Move the resolvers to one file (`lib/agent/path-resolution.ts`) so
  they can be tested as a unit and the cross-resolver invariant is
  visible.
