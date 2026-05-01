# Pattern 13 — Spawn-and-bridge for embedded tools (the "extension" model)

The `pi` binary supports `--extension <path>` to load a JS module that
registers tools at runtime. The PR uses this to ship a single extension
(`browser.ts`) that exposes the embedded webview as a set of agent tools.
The mechanism is a clean user-controllable extension point: it is gated
behind a UI toggle, takes effect on the next pi launch, and changes the
agent's exposed toolset without changing the controller or the frontend's
chat protocol.

## Where it appears

| File | Role |
|------|------|
| `frontend/desktop/resources/pi-extensions/browser.ts` | The extension itself — 140 LoC, exports a default function that registers eight tools (`browser_navigate`, `browser_get_url`, `browser_get_text`, `browser_get_html`, `browser_screenshot`, `browser_click`, `browser_scroll`, `browser_fill`). |
| `frontend/src/lib/agent/pi-runtime.ts` | `resolveBrowserExtensionPath()` finds the extension on disk; `start(...)` adds `--extension <path>` to the pi args when `browserToolEnabled` is true. |
| `frontend/electron-builder.yml` | Ships `desktop/resources/pi-extensions/` as `extraResources` so the packaged app can find it under `process.resourcesPath`. |
| `frontend/src/app/agent/_components/agent-workspace.tsx` (the "Browser tool" toggle) | UI gate. Toggling triggers a key change for `PiRpcSession`, restarting the child with or without the extension. |

## How it's loaded

In `pi-runtime.ts`:

```ts
const args = [
  "--mode", "rpc",
  "--provider", PROVIDER_ID,
  "--model", `${PROVIDER_ID}/${modelId}`,
];
...
if (browserToolEnabled) {
  const extensionPath = resolveBrowserExtensionPath();
  if (extensionPath) args.push("--extension", extensionPath);
}
```

`resolveBrowserExtensionPath()` checks four paths in order:

1. `$VLLM_STUDIO_BROWSER_EXTENSION_PATH` (escape hatch for tests)
2. `process.resourcesPath/desktop/resources/pi-extensions/browser.ts`
   (packaged Electron)
3. `process.cwd()/frontend/desktop/resources/pi-extensions/browser.ts`
   (running from repo root)
4. `process.cwd()/desktop/resources/pi-extensions/browser.ts` (running
   from `frontend/`)

The first path that exists wins. If none exist, the extension is silently
omitted — the agent loses browser tools but still runs.

## How tools are registered

The extension's default export receives a `pi: ExtensionAPI` and calls
`pi.registerTool(...)` for each verb:

```ts
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "browser_navigate",
    label: "Browser: Navigate",
    description: "Navigate the embedded browser to a URL...",
    parameters: Type.Object({
      url: Type.String({ description: "Absolute http(s) URL to load" }),
    }),
    async execute(_id, params, signal) {
      return callBrowserAction("navigate", { url: params.url }, signal);
    },
  });
  // ... seven more registerTool calls
}
```

Each `execute` POSTs to `${VLLM_STUDIO_FRONTEND_BASE}/api/agent/browser/<verb>`
— see [Pattern 5 — Browser bridge](./browser-bridge.md) for the rest of
the round-trip.

## Why this pattern

- **Decouples agent capabilities from the agent runtime.** The pi binary
  itself doesn't know what a "browser" is. The extension is loaded at
  startup, tools are registered, and from pi's perspective it has a few
  more tools in its registry.
- **User-controllable.** The "Browser tool" toggle in the agent header
  is the on/off switch. No backend change required to disable a tool —
  just stop loading the extension.
- **Single distribution mechanism.** Anything else the team wants to
  extend pi with (a database query tool, a custom shell, a file viewer)
  follows the same shape: write a `pi-extensions/<name>.ts`, register
  tools, add a UI toggle.
- **Sandboxed I/O via HTTP.** The extension can't read the renderer's
  `<webview>` directly; it can only POST to the local frontend. That
  keeps the extension code itself plain — no DOM, no Electron, no IPC.
- **Loaded only when needed.** The extension is omitted unless the
  toggle is on, so users who never use the browser tool never load
  unnecessary code into their pi child.

## Trade-offs

- **Implicit contract with `pi-coding-agent`.** The extension imports
  `ExtensionAPI` from `@mariozechner/pi-coding-agent`. A breaking change
  in pi's extension API silently breaks the browser tool at next pi
  upgrade.
- **Toggle = restart.** Because `--extension` is a launch arg, toggling
  the browser tool restarts the pi child (and clears the in-memory
  scrollback / mid-turn context).
- **No discovery.** A user can't see which tools the extension provides
  until pi loads it and emits its tool registry. There's no
  manifest/UI listing in the renderer.
- **One extension at a time today.** The pattern *could* support
  multiple `--extension` args. The PR ships only `browser.ts`; the path
  resolver returns a single path.
- **Extension lives outside `frontend/src/`.** The extension is
  `frontend/desktop/resources/pi-extensions/browser.ts` so it can be
  shipped as `extraResources`. This means it's not type-checked alongside
  the rest of `frontend/src/` by default and uses `import type` from a
  third-party package.

## Cross-references

- [Chapter 1 — `pi-runtime.md`](../chapter-01-frontend/pi-runtime.md) — how the extension path is resolved and passed.
- [Chapter 1 — `electron-desktop.md`](../chapter-01-frontend/electron-desktop.md) — `extraResources` packaging and the embedded webview.
- [Chapter 1 — `agent-workspace-deep-dive.md`](../chapter-01-frontend/agent-workspace-deep-dive.md) — the "Browser tool" toggle in the composer.
- [Pattern 3 — Subprocess RPC](./subprocess-rpc.md) — the JSONL protocol the extension's tools become part of.
- [Pattern 5 — Browser bridge](./browser-bridge.md) — the HTTP round-trip that each tool's `execute()` performs.
- [Pattern 8 — Per-session runtime keys](./per-session-runtime-keys.md) — why toggling the extension flag forces a restart.
