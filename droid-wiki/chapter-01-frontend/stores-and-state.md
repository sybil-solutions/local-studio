# `lib/agent/*` stores and state

All files under `frontend/src/lib/agent/` are server-side helpers — they use
Node `fs` and run only inside Next route handlers and the pi-runtime
manager. None of them are imported from the renderer.

| File | Lines | Persistence | Used by |
| ---- | -----:| ----------- | ------- |
| `pi-runtime.ts` | 444 | `<dataDir>/pi-agent/models.json` (chmod 0o600) | turn / abort / models routes |
| `sessions-store.ts` | 165 | reads pi's own JSONL files at `<PI_CODING_AGENT_DIR>/sessions/<encoded-cwd>/*.jsonl` (or `~/.pi/agent/sessions` fallback) | sessions / sessions/[id] routes |
| `projects-store.ts` | 136 | `<repo>/data/agentfs/projects.json` (atomic temp + rename) | projects route + `pi-runtime.resolveDefaultAgentCwd` |
| `fs-store.ts` | 90 | none — read-through filesystem | fs / fs/file routes |
| `comments-store.ts` | 87 | `<project>/.vllm-studio/comments.json` | comments route |
| `models.ts` | 118 | none — pure normalization | pi-runtime |
| `models.test.ts` | 41 | n/a | vitest |
| `browser-bridge.ts` | 79 | in-memory only (singleton on `globalThis`) | browser/* routes |

## `sessions-store.ts`

Read-only client of pi's own session log directory.

```ts
function encodeCwdForPi(cwd: string): string {
  // /Users/sero/projects/vllm-studio  →  --Users-sero-projects-vllm-studio--
  return `--${path.resolve(cwd).replace(/^\//, "").replace(/\/+/g, "-")}--`;
}
function piSessionsRoot(): string {
  return process.env.PI_CODING_AGENT_DIR
    ? path.join(process.env.PI_CODING_AGENT_DIR, "sessions")
    : path.join(homedir(), ".pi", "agent", "sessions");
}
```

Two public functions:

- `listSessions(cwd, { since? })` → `SessionSummary[]`
  - Streams every `*.jsonl` file in the encoded session dir.
  - For each, reads the `session` header event and tallies user-message
    events to derive `turnCount` and `firstUserMessage`.
  - Tolerates three message shapes: `message`, `message_end`, and the
    older flat `user_message` event (commit `79a84c15`).
  - Sorts by `mtime` descending.
- `loadSession(cwd, sessionId)` → `SessionEvent[]`
  - Finds any file in the session dir whose name **contains** `sessionId`
    (so partial UUIDs work, matching `pi --session`'s behavior).
  - Streams the file and returns every parsed JSON line.

`SessionSummary` shape:

```ts
type SessionSummary = {
  id: string;
  filename: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  modelId: string | null;
  provider: string | null;
  firstUserMessage: string | null;
  turnCount: number;
};
```

## `projects-store.ts` (server-side)

Anchored at `<repo>/data/agentfs/projects.json` (intentionally co-located
with the existing agentfs artifact root). Writes atomically: temp file +
`renameSync`. Public functions:

- `listProjectsFromStore(): ProjectEntry[]` — every record gets the live
  `exists` / `hasGit` / `branch` triple computed at read time.
- `addProjectToStore(rawPath: string)` — `statSync(...).isDirectory()`
  validation, dedupe by exact path match, name = basename. Returns the
  augmented `ProjectEntry`.
- `removeProjectFromStore(id: string)` — silently no-ops when id missing.

`gitBranchFor(path)` parses `.git/HEAD` for `ref: refs/heads/<branch>` or a
detached SHA-7. No `git` invocation.

This is **distinct** from `desktop/logic/projects-store.ts` which writes
`projects.json` under `app.getPath("userData")` (i.e. `~/Library/Application
Support/vLLM Studio/projects.json` on macOS). The renderer prefers the
Electron IPC bridge whenever `window.vllmStudioDesktop?.listProjects` is
defined; in dev the HTTP route is used.

## `fs-store.ts`

```ts
function ensureInside(rootCwd, target) // rejects path escapes via .. or absolute
function listDirectory(rootCwd, relPath) // sorted, dirs first
async function readFileSnippet(rootCwd, relPath, maxBytes = 5 * 1024 * 1024)
```

Ignores any of `.git`, `node_modules`, `.next`, `dist`, `dist-desktop`,
`.turbo`, `.cache`, `__pycache__`, `.venv`, `venv`, `.vllm-studio`. Hidden
dotfiles are also skipped except `.env.example`.

`readFileSnippet` returns `{ content, truncated, size }`:

- `truncated: true` if the file exceeds `maxBytes` (default 5 MiB).
- Treats the file as binary and returns `truncated: true` when any of the
  first 8 KB contains a NUL byte.

## `comments-store.ts`

Stores per-line comments alongside the project at
`<project>/.vllm-studio/comments.json`:

```json
{
  "files": {
    "src/foo.ts": [
      { "id": "c-…", "line": 12, "body": "fix me", "createdAt": "ISO" }
    ]
  }
}
```

`addComment` / `deleteComment` rewrite the entire document; `listComments`
reads it. `ensureRel(rel)` rejects empty paths, paths containing `..`, or
absolute paths.

This is consumed by the `<FilesystemPanel>` viewer where clicking a line
opens an inline composer.

## `models.ts`

Pure normalization helpers. Three named exports:

- `inferReasoningSupport(modelId)` — returns `true` for ids matching `reason`,
  `thinking`, `r1`, `deepseek`, `qwen3`, `glm-5`, `mimo`.
- `normalizeOpenAIModel(row)` — coerces every variant of context window /
  max-tokens field, infers reasoning, defaults `contextWindow` to 128k if
  missing, defaults `maxTokens` to `min(contextWindow, 65_536)`. Does **not**
  clamp local reasoning models down to a small output budget — see the
  `MiMo-V2.5` test case.
- `normalizeOpenAIModels(payload)` — dedupes by id, sorts by `name`.
- `modelsToPiModels(models)` — wrapper to the format pi-runtime writes into
  `models.json` (the `compat.maxTokensField: "max_tokens"` field is a pi
  contract).

`models.test.ts` verifies both shapes.

## `browser-bridge.ts`

Pure in-memory request queue, singleton on `globalThis`. Behaviour:

- `enqueue(verb, payload)` rejects immediately when no listener is
  attached (i.e. the renderer's SSE is not connected).
- Otherwise emits a `{ id, verb, payload }` over the `command` event,
  stores `{ resolve, reject }` in `pending`, and arms a 30 s timeout.
- `resolve(result)` finds the matching pending entry, clears the timer,
  resolves it.

Used by:

- `app/api/agent/browser/[verb]/route.ts` — `enqueue`.
- `app/api/agent/browser/events/route.ts` — subscribes to `command` and
  pipes commands out via SSE.
- `app/api/agent/browser/result/route.ts` — POST handler that calls
  `resolve`.

The bridge is the in-process glue that lets the agent (running inside the
pi child) trigger a browser action that only the renderer can perform.

## State machine helper (`lib/state-machine.ts`)

A new 45-line file added by this PR. Generic single-state container:

```ts
export interface StateMachineContainer<State, Event, Context, Effect> {
  state: State;
  dispatch(event, context): { state, effects };
  setState(next): void;
  reset(): void;
}

export function createStateMachine(options): StateMachineContainer { ... }
```

Used by `app/recipes/_components/vllm-runtime-panel-machine.ts` (modified)
to consolidate transition logic.

## App-level zustand store (`store/*`)

This isn't agent-specific but it changed materially in the PR:

- `store/index.ts` re-exports `useAppStore` and imports `./listeners` for its
  side-effects.
- `store/app-slice.ts` (new) holds the sidebar state + width.
- `store/app-store.ts` adds `desktopSidebarPinnedOpen` (persisted) and a
  custom `partialize` / `merge` so the persisted state shape stays small.
- `store/listeners.ts` listens for `resize` (auto-collapses on mobile) and a
  custom `vllm:toggle-sidebar` event.

The legacy `store/chat-slice*` files (multiple thousand lines) were all
deleted — see [deletions-inventory.md](./deletions-inventory.md).
