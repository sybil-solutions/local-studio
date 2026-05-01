# `app/api/agent/*` routes

Every route is `runtime = "nodejs"` + `dynamic = "force-dynamic"` (each file
re-exports both constants). They all live under
`frontend/src/app/api/agent/`.

## Route map

| Route | Methods | Purpose |
| ----- | ------- | ------- |
| `/api/agent/turn` | POST | SSE stream that runs one user turn through pi. |
| `/api/agent/abort` | POST | Send `{ type: "abort" }` to the pi child. |
| `/api/agent/sessions` | GET | List session summaries for a cwd. |
| `/api/agent/sessions/[id]` | GET | Stream every event of one session. |
| `/api/agent/projects` | GET / POST / DELETE | Read/append/remove the agent project list (server-side store). |
| `/api/agent/models` | GET | Refresh `models.json` and return the normalized model list. |
| `/api/agent/fs` | GET | List directory entries. |
| `/api/agent/fs/file` | GET | Read a file snippet (≤5 MiB; binary detection). |
| `/api/agent/comments` | GET / POST / DELETE | Per-file, per-line comments. |
| `/api/agent/browser/[verb]` | POST | Enqueue one of 8 browser commands. |
| `/api/agent/browser/events` | GET | Long-lived SSE that ships commands to the renderer. |
| `/api/agent/browser/result` | POST | Renderer reports back a command result. |

## `POST /api/agent/turn`

Body:

```ts
type TurnRequest = {
  sessionId?: string;        // PiRpcSession key — defaults to "default"
  modelId?: string;          // required
  message?: string;          // required, trimmed
  cwd?: string;              // optional, used by pi child
  piSessionId?: string|null; // resume this pi UUID
  browserToolEnabled?: boolean;
};
```

SSE frames written by the route handler:

| Frame | Payload | When |
| ----- | ------- | ---- |
| `status` | `{ phase: "starting", sessionId, modelId, cwd }` | Before `ensureStarted`. |
| `status` | `{ phase: "running", session: <status> }` | After `ensureStarted`. |
| `pi` | `{ event: <pi event verbatim> }` | For every event emitted by `prompt(message, onEvent)`. |
| `status` | `{ phase: "done" }` | When `prompt` resolves. |
| `error` | `{ error: string }` | On any thrown error during the lifecycle. |

The handler closes the controller in `finally`. The `<ChatPane>` consumes
this stream byte-by-byte (see [chat-pane-deep-dive.md](./chat-pane-deep-dive.md#send--stream--finalize)).

## `POST /api/agent/abort`

```ts
const body = await request.json();
const sessionId = body.sessionId?.trim() || "default";
await piRuntimeManager.getSession(sessionId).abort();
return NextResponse.json({ ok: true });
```

Asks the pi child to abort the current turn — but does **not** kill it.

## `GET /api/agent/sessions`

Query params: `cwd` (required, must be absolute), `since` (optional, e.g.
`7d`, `12h`, `30m`).

Returns `{ sessions: SessionSummary[] }`. When `cwd` doesn't exist or isn't
a directory, returns `{ sessions: [] }` rather than 404. The sidebar uses
`since=7d` so the project list isn't dominated by ancient sessions.

## `GET /api/agent/sessions/[id]`

Query params: `cwd` (required, absolute).

Reads the matching JSONL file using a partial-match (the file name contains
the session UUID). Returns `{ events: SessionEvent[] }`. The `<ChatPane>`
hydrates these into `ChatMessage[]` via `replaySessionEvents`.

## `GET / POST / DELETE /api/agent/projects`

| Method | Body / params | Behavior |
| ------ | ------------- | -------- |
| GET | none | `listProjectsFromStore()` → `{ projects }`. |
| POST | `{ path: string }` | `addProjectToStore(path)` → `{ project }` (or 400 with `{ error }`). |
| DELETE | `?id=<projectId>` | `removeProjectFromStore(id)` → `{ ok: true }`. |

Used by the renderer-side `loadAgentProjects()` whenever the Electron
bridge is unavailable, and by `<ProjectsNavSection>` for adds/removes
through the same fallback. The Electron app prefers the IPC bridge, which
hits a separate userData-scoped store.

## `GET /api/agent/models`

Calls `refreshPiModels()` on every request (which re-reads `/v1/models` and
re-writes `models.json`). Returns `{ provider: "vllm-studio", models }` or a
502 on failure.

## `GET /api/agent/fs` and `GET /api/agent/fs/file`

`/api/agent/fs?cwd=&path=` returns `{ entries: FsEntry[] }`. `path` is
relative to `cwd` and resolved via `path.resolve(cwd, relPath)`. Path
escapes (anything that resolves outside `cwd`) throw "Path escapes project
root".

`/api/agent/fs/file?cwd=&path=` returns `{ content, truncated, size }`.
Binary or large files have `content: ""`, `truncated: true`.

## `GET / POST / DELETE /api/agent/comments`

| Method | Params / body | Behavior |
| ------ | ------------- | -------- |
| GET | `?cwd=&path=` | `{ comments: Comment[] }`. |
| POST | `{ cwd, path, line, body }` | `{ comment: Comment }`. |
| DELETE | `?cwd=&path=&id=` | `{ ok: true }`. |

`line` must be a positive number; `body` must be non-empty. Stored at
`<project>/.vllm-studio/comments.json`.

## `POST /api/agent/browser/[verb]`

`ALLOWED_VERBS = { navigate, get-url, get-text, get-html, screenshot, click, scroll, fill }`.

Each call:

1. Validates the verb against the allowlist (rejects with 400 otherwise).
2. Reads the JSON body (best-effort).
3. `await browserBridge.enqueue(verb, payload)`.
4. Returns `{ ok, data }` on success, `{ ok: false, error }` on failure.

Called only from the pi browser extension running in the pi child process
(see [electron-desktop.md](./electron-desktop.md)).

## `GET /api/agent/browser/events`

Long-lived SSE. The renderer (`<AgentWorkspace>`) opens an
`EventSource("/api/agent/browser/events")` whenever the browser tool is
toggled on. The handler:

- Adds a `command` listener on `browserBridge` that streams every command
  as `data: <json>\n\n`.
- Sends a `: ping` keepalive every 25 s.
- Cleans up via `request.signal.addEventListener("abort", close)`.

## `POST /api/agent/browser/result`

The renderer POSTs `{ id, ok, data?, error? }` after running the command.
The handler calls `browserBridge.resolve(body)`; the awaiting `enqueue`
promise resolves and `[verb]/route.ts` returns the result to its caller
(the pi extension).

This is the round trip: **pi extension → /browser/[verb] → bridge → /browser/events → renderer → /browser/result → bridge → pi extension**.

## Untouched routes worth mentioning

- `/api/proxy/[...path]/route.ts` — modified (auth fallback hardening). See
  [modifications-inventory.md](./modifications-inventory.md).
- `/api/title/route.ts` — **deleted** (it generated chat titles for the old
  chat surface; the new surface derives titles from the first user
  message).
