# `pi-runtime.ts` — per-session pi subprocess RPC

> File: `frontend/src/lib/agent/pi-runtime.ts`
> Size: **444 lines / ~15 KB**.

`pi-runtime.ts` is the only place in the frontend that knows how to spawn
and talk to the [`@mariozechner/pi-coding-agent`](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
binary. It exposes a singleton `PiRuntimeManager` that maps an in-memory
`sessionId` (one per browser tab) to a `PiRpcSession` — a long-lived child
process running `pi --mode rpc`. Streaming events are emitted on a Node
`EventEmitter`; commands and responses are correlated through ids over a
JSON-line protocol.

## Public exports

| Export | Kind | Purpose |
| ------ | ---- | ------- |
| `piRuntimeManager` | singleton (stashed on `globalThis`) | One `PiRuntimeManager` for the whole Next process. |
| `refreshPiModels()` | async | Re-reads `/v1/models` from the controller, regenerates `data/pi-agent/models.json`, returns `{ models, agentDir }`. Used by `/api/agent/models` and on every `ensureStarted`. |

## Internal classes

### `PiRpcSession extends EventEmitter`

Holds the active `child_process.spawn` handle plus a `Map<id, PendingCommand>`
for in-flight commands. Tracks the last-applied `(modelId, cwd, piSessionId,
browserToolEnabled)` so reissue of `ensureStarted` with the same parameters
is a cheap no-op.

| Method | Notes |
| ------ | ----- |
| `ensureStarted(modelId, cwd?, piSessionId?, browserToolEnabled?)` | Resolves cwd via `resolveAgentCwd`, decides whether the existing process matches, otherwise calls `start`. Uses a `starting` Promise so concurrent callers wait once. |
| `start(...)` | Calls `stop()`, then `refreshPiModels`, then `spawn(piBinaryPath(), args, ...)`. |
| `prompt(message, onEvent)` | Sends `{ type: "prompt", message }`, then registers a temporary listener that resolves on `agent_end` (and rejects on `process_exit`). 30-minute hard timeout. |
| `abort()` | Sends `{ type: "abort" }`. |
| `stop()` | `SIGTERM`, waits up to 500 ms for `exit`, then `SIGKILL`. |
| `status` (getter) | `{ running, modelId, cwd, piSessionId, agentDir }`. |

### `PiRuntimeManager`

```ts
class PiRuntimeManager {
  private sessions = new Map<string, PiRpcSession>();
  getSession(sessionId = "default"): PiRpcSession { ... }
}
```

Stashed on `globalForPi.__vllmStudioPiRuntime` so HMR / re-imports reuse the
same map.

## Spawn arguments

```ts
const args = [
  "--mode", "rpc",
  "--provider", "vllm-studio",
  "--model", `vllm-studio/${modelId}`,
];
if (selectedModel.reasoning) args.push("--thinking", "high");
if (piSessionId)             args.push("--session", piSessionId);  // resume
if (browserToolEnabled) {
  const ext = resolveBrowserExtensionPath();
  if (ext) args.push("--extension", ext);
}
```

## Spawn environment

```ts
env: {
  ...process.env,
  PATH: piPathEnv(),                         // injects /opt/homebrew/bin and ~/.bun/bin
  PI_CODING_AGENT_DIR: agentDir,             // <data>/pi-agent
  PI_SKIP_VERSION_CHECK: "1",
  VLLM_STUDIO_FRONTEND_BASE:
    process.env.VLLM_STUDIO_FRONTEND_BASE ?? deriveFrontendBase(),
}
```

The `VLLM_STUDIO_FRONTEND_BASE` is exactly what the
`desktop/resources/pi-extensions/browser.ts` extension reads to call back
into `/api/agent/browser/<verb>`. In dev it falls back to
`http://127.0.0.1:${PORT||3000}`; the Electron `app-server.ts` overrides it
with the embedded server's actual URL.

## CWD resolution

```ts
function resolveDefaultAgentCwd(): string
function expandHome(value: string): string
async function resolveAgentCwd(input?: string): Promise<string>
```

Resolution order (commit `18fbfa1d`):

1. Explicit `VLLM_STUDIO_AGENT_CWD` env var wins.
2. Otherwise, the most-recently-added project from
   `lib/agent/projects-store.ts:listProjectsFromStore()` that still exists.
3. If `process.cwd()` is the dev `frontend/` dir → use the repo root.
4. If `process.cwd()` is `/` or empty (packaged Electron) → `$HOME`.
5. Otherwise the original `process.cwd()`.

`resolveAgentCwd(input?)` then expands `~`, resolves relative paths against
the default cwd, calls `realpath`, and `stat`s to confirm it's a directory.

## Model materialization

`refreshPiModels`:

1. Calls `getApiSettings()` → `{ backendUrl, apiKey }`.
2. `fetchModelsFromBackend(settings)` → `GET ${backendUrl}/v1/models` (Bearer
   if `apiKey` set), normalized via `normalizeOpenAIModels`.
3. `writePiModelsConfig(settings, models)`:
   - Resolves `dataDir` via `getWritableDataDir()` (env override →
     `<cwd>/data` → `<cwd>/../data` → `<cwd>/frontend/data` → `~/.vllm-studio`
     → `os.tmpdir()/vllm-studio`).
   - `mkdir(<dataDir>/pi-agent)` and `chmod 0o700`.
   - Writes `<dataDir>/pi-agent/models.json` with shape:
     ```json
     {
       "providers": {
         "vllm-studio": {
           "baseUrl": "<backendUrl>/v1",
           "api": "openai-completions",
           "apiKey": "<apiKey or 'vllm-studio'>",
           "authHeader": <bool>,
           "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false },
           "models": [ { id, name, reasoning, contextWindow, maxTokens, ... } ]
         }
       }
     }
     ```
   - Sets `chmod 0o600` on the file.
4. Returns `{ models, agentDir }`.

`models.ts:modelsToPiModels` normalizes every model to:

```ts
{ id, name, reasoning, input: ["text"], contextWindow, maxTokens,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsDeveloperRole: false,
            supportsReasoningEffort: model.reasoning,
            maxTokensField: "max_tokens" } }
```

## JSON-line protocol

Pi child writes one JSON object per stdout line. Categories:

- **Responses** to commands the frontend sent: `{ id, type: "response", success?, data?, error? }`. Resolved via `pending.get(id)` then `pending.delete(id)`. Failures are rejected with the response's `error` (or `error.message`).
- **Events**: anything else. Forwarded verbatim via `this.emit("event", parsed)`.

`handleStdout` is buffer-aware: it accumulates partial lines, splits on
`\n`, strips trailing `\r`, and invokes `handleLine` per complete line.
Non-JSON lines are emitted as `{ type: "stdout", text: raw }`. Stderr is
emitted as `{ type: "stderr", text: chunk }`.

## Shutdown semantics

- `stop()` sends `SIGTERM`, waits 500 ms for `exit`, falls back to
  `SIGKILL`.
- On `process_exit`, every pending command is rejected with
  "pi rpc exited before response".
- `prompt` listens for `agent_end` to resolve and `process_exit` to reject.

## Where `sessionId` comes from

The Next route handler `app/api/agent/turn/route.ts` defaults to
`"default"`, but the `<ChatPane>` always passes `tab.runtimeSessionId ||
runtimeSessionId`. The workspace generates `runtimeSessionId` per pane and
`makeFreshTab()` generates one per tab. So one `PiRpcSession` lives per
**browser tab**, not per pane and not per browser session.

## Failure modes worth knowing

- If `pi` isn't on PATH, `start()` rejects with `Error: spawn pi ENOENT`
  (after the 150 ms warmup wait). The frontend turns it into a top banner.
- If `/v1/models` is unreachable, `refreshPiModels()` throws and the
  `start()` aborts before spawning anything.
- If `getApiSettings().apiKey` is empty but the backend requires auth, the
  `apiKey` falls back to the literal string `"vllm-studio"` (intentional —
  the controller's `--require-auth` mode treats this as a sentinel).
- The 30-minute prompt timeout is intentionally generous; it exists only as
  a safety net for fully wedged children.
