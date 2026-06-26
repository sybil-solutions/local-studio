# Sitegeist Relay Protocol v1

The relay lets an **external agent** (local-studio's pi agent) drive a browser **through the
sitegeist Chrome extension**. It replaces the discontinued parchi relay. Goal: clean, small
(≤1000 LOC), standardised, tested.

## Topology

```
  local-studio pi agent  ──HTTP JSON-RPC──▶  RELAY (local process)  ◀──WebSocket──  sitegeist extension
   (sitegeist-browser.ts)                    (~/ai/sitegeist/relay)                (background service worker)
```

- **Agent → Relay:** HTTP `POST {SITEGEIST_RELAY_URL}/rpc`, body = JSON-RPC 2.0 request.
  Request/response, one call per tool invocation (simple for the pi extension).
- **Extension → Relay:** outbound **WebSocket** to `{SITEGEIST_RELAY_URL}/ws` (extensions can
  dial out but cannot listen). The relay forwards each agent call to the connected extension and
  correlates the reply by `id`.
- The relay is the only listener. It owns request/response correlation, timeouts, and session
  routing.

## Config (env, with `~/.config/sitegeist-relay/env` fallback)

| Var | Default | Meaning |
|-----|---------|---------|
| `SITEGEIST_RELAY_URL` | `http://127.0.0.1:7717` | base URL (agent POSTs `/rpc`; ext dials `/ws`) |
| `SITEGEIST_RELAY_TOKEN` | _(empty)_ | optional bearer; agent sends `Authorization: Bearer`, ext sends `?token=` |
| `SITEGEIST_RELAY_SESSION_ID` | _(generated)_ | logical session; header `X-Sitegeist-Session` |
| `SITEGEIST_RELAY_TOOL_TIMEOUT_MS` | `120000` | per-call timeout |
| `SITEGEIST_RELAY_PORT` | `7717` | relay listen port |

## Wire format — JSON-RPC 2.0 (one JSON object per message)

Request: `{ "jsonrpc": "2.0", "id": <n>, "method": "<m>", "params": { ... } }`
Success: `{ "jsonrpc": "2.0", "id": <n>, "result": { ... } }`
Error:   `{ "jsonrpc": "2.0", "id": <n>, "error": { "code": <int>, "message": "...", "data"?: ... } }`

Error codes: `-32601` method not found, `-32602` bad params, `-32000` extension not connected,
`-32001` call timeout, `-32002` browser action failed (`data` carries detail).

## Methods (browser control)

| Method | params | result |
|--------|--------|--------|
| `relay.health` | `{}` | `{ ok, extensionConnected, sessions }` |
| `relay.capabilities` | `{}` | `{ methods: string[] }` |
| `browser.navigate` | `{ url, waitUntil? }` | `{ url, title }` |
| `browser.url` | `{}` | `{ url, title }` |
| `browser.text` | `{ selector? }` | `{ text }` |
| `browser.html` | `{ selector? }` | `{ html }` |
| `browser.screenshot` | `{ fullPage?, selector? }` | `{ dataUrl }` (png base64) |
| `browser.click` | `{ selector? , x?, y? }` | `{ ok }` |
| `browser.fill` | `{ selector, value, submit? }` | `{ ok }` |
| `browser.scroll` | `{ dx?, dy?, selector? }` | `{ ok }` |
| `browser.eval` | `{ expression }` | `{ value }` (JSON-serialisable; page context) |
| `browser.tabs.list` | `{}` | `{ tabs: [{id,url,title,active}] }` |
| `browser.tabs.new` | `{ url? }` | `{ id }` |
| `browser.tabs.switch` | `{ id }` | `{ ok }` |
| `browser.tabs.close` | `{ id }` | `{ ok }` |

Capability discovery: agent calls `relay.capabilities`; the relay returns the methods the
connected extension actually implements (so the agent only exposes supported tools).

## local-studio side (tools)

The pi extension `sitegeist-browser.ts` registers `sitegeist_*` tools (sitegeist_navigate,
sitegeist_click, sitegeist_fill, sitegeist_get_text, sitegeist_screenshot, sitegeist_eval,
sitegeist_tabs_*, …) that each POST one JSON-RPC call to `/rpc`. Timeline display strips the
`sitegeist_` prefix.

## Tests

- Relay unit/integration: a mock extension WS client + an agent HTTP client doing a full
  round-trip per method, timeout path, auth path, and not-connected error path.
- `npm run relay` starts it; `npm test` (or the relay's test script) runs the round-trip suite.
