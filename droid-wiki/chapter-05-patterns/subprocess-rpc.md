# Pattern 3 — Subprocess RPC over JSON-line stdio

The new agent surface delegates the entire coding-agent runtime to an
external `pi` binary. The frontend talks to it over a long-lived child
process whose stdin/stdout is line-delimited JSON. This is a deliberate
inversion of the old design — see [Chapter 2 deletions inventory](../chapter-02-controller/deletions-inventory.md)
for the 30+ files of in-controller agent runtime that this pattern
replaces.

## Anatomy

`frontend/src/lib/agent/pi-runtime.ts` (445 LoC) defines:

- `PiRpcSession extends EventEmitter` — owns one child process, writes
  JSON commands to its stdin, splits stdout on newlines, parses each line
  as JSON, and routes the result.
- `PiRuntimeManager` — keys sessions by `sessionId` (see
  [Pattern 8](./per-session-runtime-keys.md)) and lazily creates them.

### Wire format

Lines written to the child stdin look like:

```json
{"id": "cmd-7", "type": "prompt", "message": "..."}
{"id": "cmd-8", "type": "abort"}
```

Lines read from the child stdout fall into two buckets:

| Shape                                                            | Meaning |
|------------------------------------------------------------------|---------|
| `{ id, type: "response", command, success, data?, error? }`      | Reply to a previously sent command. Routed to `pending.get(id)`. |
| `{ type: "agent_start" \| "message" \| "tool_use" \| "tool_result" \| "agent_end" \| "stderr" \| "process_exit" \| "stdout" }` | Async events emitted to all `event` listeners. |

The id-correlation is straightforward:

```ts
private sendCommand(command: Record<string, unknown>): Promise<PiResponse> {
  const id = `cmd-${++this.commandSeq}`;
  const payload = { id, ...command };
  return new Promise((resolve, reject) => {
    this.pending.set(id, { resolve, reject });
    this.process?.stdin.write(`${JSON.stringify(payload)}\n`, ...);
  });
}
```

A turn (`prompt`) is a command that resolves *immediately on receipt*
(`success: true`), then emits a stream of typed events (`agent_start`,
`message`, `tool_use`, `tool_result`, ...) until terminating with
`agent_end` or `process_exit`. The `prompt(message, onEvent)` helper
subscribes to events for the duration of one turn:

```ts
async prompt(message: string, onEvent: (event: PiEvent) => void): Promise<void> {
  const listener = (event: PiEvent) => onEvent(event);
  this.on("event", listener);
  try {
    await this.sendCommand({ type: "prompt", message });
    await new Promise<void>((resolve, reject) => {
      // resolve on agent_end, reject on process_exit
    });
  } finally {
    this.off("event", listener);
  }
}
```

### Buffering

`handleStdout(chunk)` accumulates a string buffer and slices it on
newlines:

```ts
private handleStdout(chunk: string) {
  this.buffer += chunk;
  let newline = this.buffer.indexOf("\n");
  while (newline !== -1) {
    const raw = this.buffer.slice(0, newline).replace(/\r$/, "");
    this.buffer = this.buffer.slice(newline + 1);
    if (raw.trim()) this.handleLine(raw);
    newline = this.buffer.indexOf("\n");
  }
}
```

Anything that fails `JSON.parse` is emitted as `{ type: "stdout", text }`
— a deliberate fallback so unstructured `pi` output (e.g., banners) shows
up in the timeline rather than being dropped.

## Why this pattern

- **Process boundary as an interface.** The frontend doesn't link against
  `pi-coding-agent` at the TS level; it only knows the JSON protocol. `pi`
  can be upgraded, replaced, or run on a different machine without
  changing TypeScript.
- **Concurrency is trivial.** One process per session (per tab) means the
  agent runtime cannot leak state across panes. SIGTERM fully isolates a
  panic.
- **Reuses existing tooling.** `pi --mode rpc` is what `pi` ships; the
  controller team didn't have to invent or maintain an RPC framework.
- **Stream + reply on the same channel.** Async events and command replies
  share the same JSONL stream; correlation is handled by `id`. There is no
  separate websocket or named pipe.

## Compare to what was deleted

The deleted `controller/src/modules/chat/` contained:

- `agent/run-manager.ts`, `agent/tool-registry-*.ts`,
  `agent/message-mapper.ts`, `agent/system-prompt-builder.ts`,
  `agent/tool-circuit-breaker.ts`, `agent/anthropic-adapter.ts`,
  `agent/openai-adapter.ts`, … (30+ files)
- All driving an in-process agent loop with provider-specific HTTP calls.

The new design moves *all* of that out of the controller and into the
external `pi` binary. The controller has zero knowledge of agent loops,
tool registries, or system prompts.

The `controller/src/modules/system/usage/pi-sessions.ts` file (290 LoC,
NEW) is the only place the controller now reads the agent's output —
purely for usage analytics, by tailing
`~/.pi/agent/sessions/<encoded-cwd>/*.jsonl` files. It does not
participate in the live RPC.

## Trade-offs

- **Binary distribution problem.** The `pi` binary has to exist on PATH
  (or in `node_modules/.bin`). `piBinaryPath()` and `piPathEnv()` in
  `pi-runtime.ts` paper over this with three fallback paths.
- **Crash recovery.** If the child dies mid-turn, every pending command
  rejects with `pi rpc exited before response`. The renderer has to handle
  the timeline ending unexpectedly. This is partially compensated by the
  per-tab session keying — one crash doesn't take down the whole UI.
- **Per-tab process cost.** Each open agent tab can spawn a `pi` child.
  With many tabs you pay the per-process memory tax. The session manager
  is `Map<sessionId, PiRpcSession>` and never evicts.
- **Schema drift.** The event-type list (`agent_end`, `tool_use`,
  `process_exit`, …) is conventional, not validated by Zod / typebox at
  the boundary. A `pi` upgrade that renames `agent_end` to `turn_end`
  silently breaks `prompt()`'s done-detection.
- **Exit + timeout inversion.** `prompt()` enforces a 30-minute timeout
  on the *agent_end event*, but `sendCommand` for the `prompt` command
  itself has no timeout — a malformed prompt would hang the EventEmitter
  forever. In practice `process_exit` provides eventual guard rails.

## Cross-references

- [Chapter 1 — `pi-runtime.md`](../chapter-01-frontend/pi-runtime.md) — full breakdown of `PiRpcSession`.
- [Chapter 1 — `chat-pane-deep-dive.md`](../chapter-01-frontend/chat-pane-deep-dive.md) — how the renderer consumes the JSONL event stream.
- [Chapter 2 — `deletions-inventory.md`](../chapter-02-controller/deletions-inventory.md) — what the in-controller agent runtime used to look like.
- [Pattern 8 — Per-session runtime keys](./per-session-runtime-keys.md) — how sessions get keyed.
- [Pattern 13 — Extension injection](./extension-injection.md) — how the browser tool is plugged into the same child.
