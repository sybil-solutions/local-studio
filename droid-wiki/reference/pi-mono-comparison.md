# Comparison: vLLM Studio vs `badlogic/pi-mono`

[`badlogic/pi-mono`](https://github.com/badlogic/pi-mono) is the upstream toolkit this PR delegates the entire coding-agent loop to. It's a monorepo with several packages; vLLM Studio consumes one package directly and one binary indirectly.

## What pi-mono provides

| Layer | Package | Role |
|---|---|---|
| LLM API | `@mariozechner/pi-ai` | Unified LLM client across providers (OpenAI, Anthropic, etc.), streaming, token/cost tracking |
| Agent loop | `@mariozechner/pi-agent-core` | Events, tools, parallel/sequential execution, follow-up queue, steering |
| Coding agent | `@mariozechner/pi-coding-agent` | Filesystem tools, sessions, skills, modes, config, auth, extensions |
| CLI / TUI | `pi` binary | Compiled CLI that hosts the coding agent in interactive (`tui`), `print`, `json`, or **`rpc`** modes |

Source: [`scope.md`](../../scope.md) (the design document describing this integration).

## What this PR consumes

### Direct npm dependency

`frontend/package.json` lists:

```json
"@mariozechner/pi-coding-agent": "^0.70.6"
```

Used to type the **browser extension** at `frontend/desktop/resources/pi-extensions/browser.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
```

The extension registers 8 tools (`browser_navigate`, `browser_get_url`, `browser_get_text`, `browser_get_html`, `browser_screenshot`, `browser_click`, `browser_scroll`, `browser_fill`) which the user can enable from the agent header. See [browser bridge](../chapter-05-patterns/browser-bridge.md).

### Indirect: spawning the `pi` binary

The bulk of the integration is through `pi --mode rpc` launched as a child process from `frontend/src/lib/agent/pi-runtime.ts`. This is *not* an npm import; it's a binary on PATH (`/opt/homebrew/bin/pi` or `~/.bun/bin/pi`, with a fallback to `node_modules/.bin/pi`).

Key invocation (excerpt from `pi-runtime.ts`):

```ts
const args = [
  "--mode", "rpc",
  "--provider", PROVIDER_ID,
  "--model", `${PROVIDER_ID}/${modelId}`,
];
if (selectedModel.reasoning) args.push("--thinking", "high");
if (piSessionId)            args.push("--session", piSessionId);
if (browserToolEnabled)     args.push("--extension", extensionPath);
```

Pi reads `PI_CODING_AGENT_DIR` from env and looks up provider configs at `<dir>/models.json`. This PR materializes that config in `data/pi-agent/models.json` from `/v1/models` on first start (`writePiModelsConfig`).

## What pi-mono offers that we use

| Capability | Status in this PR | Surface |
|---|---|---|
| Agent loop (events: `agent_start`, `message`, `tool_*`, `agent_end`) | ✅ | Streamed back to renderer via `/api/agent/turn` |
| Filesystem tools (`list_files`, `read_file`, `write_file`, etc.) | ✅ | Pi runs them in-process; output appears as tool events |
| Shell execution (`execute_command`) | ✅ | Pi runs them in pi's cwd (the user's project) |
| Computer-use / browser tools | ✅ | Replaced by our custom `browser.ts` extension |
| Sessions (resume by UUID) | ✅ | `--session <uuid>` argument; UI tracks pi session ids in `lib/agent/sessions-store.ts` |
| Skills (`SKILL.md` discovery) | Available, not surfaced | Pi looks up `.pi/skills/`; UI does not yet expose `/skill:name` |
| Compaction | Available, not surfaced | Pi handles internally; the controller no longer ships a competing compactor |
| Extensions | ✅ | `--extension <file>` injection; we ship `browser.ts` |
| Modes (rpc/print/json/tui) | rpc | rpc only |

## What pi-mono offers that we explicitly *don't* use

`scope.md` enumerates several pi capabilities flagged for future phases:

- Steering queue (`steer()` to inject mid-run messages)
- Follow-up queue (`followUp()` for queueing while agent runs)
- Custom agent message types (CustomAgentMessages)
- Cross-provider context conversion (we run a single provider — our own controller proxy)
- OAuth credential management (we use a static API key)
- Stream proxy pattern (we run pi locally; no browser→server LLM proxy needed)

Practically, this PR consumes the *minimum* viable surface and treats pi as a black-box subprocess.

## Trade-offs of the integration

| Pro | Con |
|---|---|
| Controller drops ~5,666 LoC of agent code (Chapter 2 deletions) | We now depend on a system-level binary being installable and on PATH |
| Agent updates become a `brew upgrade pi` instead of a controller release | Version mismatches between the JS extension API (typed by `@mariozechner/pi-coding-agent`) and the binary are silent until a tool registration fails |
| Decouples controller release cycle from agent capabilities | Two language runtimes on the user's machine |
| Lets us share `pi` improvements with non-vLLM-Studio users | Less ability to inject custom tool execution semantics |

## Cross-references

- Pattern doc: [subprocess RPC](../chapter-05-patterns/subprocess-rpc.md)
- Pattern doc: [extension injection](../chapter-05-patterns/extension-injection.md)
- Complexity hotspot: [pi subprocess management](../chapter-06-complexity/pi-subprocess-management.md)
- Improvement target: [pi-runtime split](../chapter-07-files-to-improve/pi-runtime-split.md)
- Frontend chapter: [pi-runtime deep dive](../chapter-01-frontend/pi-runtime.md)
