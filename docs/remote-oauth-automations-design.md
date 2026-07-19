# Feature Designs: Remote Access · Connector OAuth · Goals & Automations · Provider Hub

Date: 2026-07-19 · Status: PROPOSED (nothing implemented)
Research basis: 3 codebase seam audits + reverse-engineering of ChatGPT/Codex desktop v26.715 (extracted asar + rust app-server strings + `~/.codex` state) + OpenAI's remote-connections/automations/goals docs.

Guiding constraint from the request: **most minimal, most compact, most e2e-user-testable**. Every feature below terminates in a Playwright spec that drives the real UI against real processes on this machine, no cloud.

---

## Shared foundation: the hermetic e2e model server

All three features want deterministic e2e runs. Today `e2e/live-agent.spec.ts` depends on a live GPU controller. Add one fixture that removes that dependency where determinism matters:

- `frontend/e2e/fixtures/fake-model-server.mjs` — ~120-line Node http server speaking `GET /v1/models` + `POST /v1/chat/completions` (SSE), returning **scripted** turns (e.g. first request → one tool call, second → text ending in a sentinel). The runtime already resolves models from the configured backend's `/v1/models` (`pi-runtime.ts:116`), and e2e already selects a controller via `e2e/live-controller.ts` — pointing settings at `http://127.0.0.1:43213` reuses that path unchanged.
- Live-model specs (`live-agent.spec.ts` pattern) stay as the non-hermetic smoke tier.

This single fixture makes automations/goals e2e reliable and lets the OAuth spec assert a real end-to-end tool call.

---

## 1. Mobile → Desktop connection ("Remote Access")

### How Codex does it (confirmed from the app)
Phone never talks to the Mac directly. Desktop creates a non-extractable device key, enrolls via challenge/proof (`/codex/remote/control/client/enroll/start|finish`), then holds an **outbound WebSocket to the cloud relay**; the QR encodes `chatgpt.com/codex/pair` + a pairing code; authorized devices on the account can then control the host. Host must stay awake ("keep awake while plugged in" toggle). OpenAI's own guidance for self-hosting equivalents: never expose the app server directly; relay or mesh only.

### Our design: dumb relay on the controller, all trust on the desktop
We already own a public, always-on, cloudflared-fronted box: **api.homelabai.org (controller)**. Cloudflared passes WebSockets. So:

```
Phone browser ──HTTPS──▶ controller /relay/:hostId/* ──WS frames──▶ desktop relay client ──▶ http://127.0.0.1:<next-port>
                                (dumb byte pipe)                       (auth + forward)         (full app: UI, /api, SSE)
```

The tunnel terminates at the desktop's **local Next origin**, so the phone gets the entire existing app — UI, every `/api/agent/*` route, SSE streaming (already proxied intact per `app/api/agent/proxy-to-runtime.ts:59-63`) — with zero mobile-specific backend. Nothing new binds a port on the Mac; loopback-only stays true.

**Controller: `controller/src/modules/relay/`** (~250 lines)
- `GET /relay/host/connect` — WS upgrade (Bun.serve has native WS). Auth: controller api_key + `hostId`. One socket per host, replace-on-reconnect.
- `ANY /relay/:hostId/*` — phone-facing. Forwards `{t:"req", id, method, path, headers, body}` down the host WS; streams `res-head`/`res-chunk`/`res-end` frames back (chunked pass-through ⇒ SSE works). 404 if host offline. Rate-limited like the rest of the Hono stack (`http/app.ts:49-88`).
- **No pairing logic, no device DB on the controller.** It is a pipe. `Set-Cookie` from the desktop passes through untouched.

**Desktop: `frontend/desktop/logic/remote-access.ts`** (~250 lines, **plain Node module, zero Electron imports** — this is what makes it e2e-runnable)
- Outbound WS (`ws` pkg or Node's global WebSocket) to the controller with backoff, reusing the reconnect discipline of `use-controller-events.ts:70-81`. Controller URL + api key come from the same settings the app already holds (`settings-service` / `getApiSettings()`).
- Per-request: validate `relay_device_token` cookie against the paired-devices store **before** forwarding to `127.0.0.1:<frontendPort>`. Unpaired ⇒ only `/remote/pair*` passes. Paired-devices + pairing codes persist via the existing safeStorage vault pattern (`logic/oauth-vault.ts`, file mode 0600).
- Pairing: renderer asks main (IPC) → module mints an 8-char one-time code, 10-min TTL. Redemption is just a relayed request: phone hits `/relay/:hostId/remote/pair?code=X` → forwarded → Next route validates via the module → mints device token → `Set-Cookie` → redirect `/`. Electron main only instantiates the module next to the other children in `logic/app-server.ts` with the same `process.once("exit")` teardown.

**Frontend** (~200 lines)
- Settings → **Remote access** card: enable toggle, QR (tiny dependency-light `qrcode-generator`, rendered to canvas) encoding `https://api.homelabai.org/relay/<hostId>/remote/pair?code=XXXX`, paired-device list (name, last seen, revoke), relay connection status dot.
- `/remote/pair` page: shows host name, "Connect this device" button → sets cookie → into the app.
- Mobile pass (small, the PWA scaffolding already exists — `public/manifest.json`, viewport in `layout.tsx:8`): below 768px collapse `LeftSidebar` into a sheet, full-width composer. Phone surface = sessions list + chat + approvals, same as Codex mobile.
- Security note: with a remote ingress the Next token gate matters. Keep the relay-client validation as the enforcement point (only non-loopback ingress there is), and drop an `x-local-studio-token` on forwarded requests so the existing `requireApiAccess` guard (`lib/auth/access.ts:32`) also holds if anything else ever exposes the origin. The unguarded routes gap (SSE/status/sessions/browser) is closed for free because *everything* rides the relay.

**e2e — `e2e/remote-access.spec.ts`** (the whole feature in one user journey, hermetic)
1. Boot local controller (ephemeral port, temp db) + standalone frontend/runtime (existing 43210/43211 harness) + the relay module as a bare Node process (no Electron — by design).
2. Enable remote access in Settings UI, read the pairing code from the QR card (expose it as text beside the QR).
3. New Playwright context, iPhone viewport → `http://127.0.0.1:<controller>/relay/<host>/remote/pair?code=…` → tap Connect → app shell renders **through the relay**.
4. Send a prompt (fake-model server) → assert streamed reply text arrives on the "phone".
5. Revoke the device on desktop → phone request now bounces to pair page.

Est: ~700-800 lines across the three tiers. First WS in the repo, confined to the relay pair.

---

## 2. Plugins that "just work" after Sign in (Connector OAuth)

### How Codex does it (confirmed)
Two separate systems: (a) marketplace connectors — **OpenAI keeps the OAuth tokens server-side**, device only holds a `link_id`; (b) user-added MCP servers — full client-side RFC stack in `codex_rmcp_client::oauth`: `/.well-known/oauth-protected-resource` (RFC 9728) → `/.well-known/oauth-authorization-server` (RFC 8414) → dynamic client registration (RFC 7591) → PKCE authorization-code with loopback callback → tokens in `~/.codex/.credentials.json` keyed `server|hash` with a lock dir. "Click sign-in and it works" = discovery + DCR mean the client needs zero pre-provisioned credentials.

### Our position: ~80% already built
The audit found the repo already contains, working today:
- A complete OAuth engine hardwired to Google Workspace: PKCE S256, authorize-URL builder with RFC 8707 `resource`, code exchange, refresh with expiry-skew cache, revoke (`google-account.ts:328-982`), a generic **loopback callback server** with state validation + timeout + branded result pages (`google-oauth-loopback.ts`), system-browser launch via preload `openExternal`, and encrypted token persistence (`oauth-vault.ts` ↔ Electron safeStorage).
- An MCP connection pool that already calls a per-request `authorize(forceRefresh)` header callback with **automatic 401 → refresh → retry** (`mcp-client.ts:48-63`), per-server env/header injection, and a persisted registry `connectors.json` whose schema already includes `auth: {type:"oauth", provider, account}` (`connector-contract.ts:12-16`).
- The official `@modelcontextprotocol/sdk` in node_modules **ships the entire MCP-OAuth client** (discovery, DCR, PKCE, exchange, refresh, `auth()` orchestrator over an `OAuthClientProvider`) — currently unused.
- A plugin manifest field `oauth_resource` that currently dead-ends into a "OAuth connection required" blocker (`plugin-runtime.ts:149`).

### Design: generalize, don't build
1. **`services/agent-runtime/src/mcp-oauth.ts`** (~200 lines): an `OAuthClientProvider` backed by the oauth-vault (tokens, DCR client registration) + non-secret metadata JSON; drive the SDK's `auth()` for discovery→DCR→PKCE; reuse the loopback-callback module for the redirect (lift it from `google-oauth-loopback.ts` into a shared `oauth-loopback.ts`; the Google file becomes a caller).
2. **One dispatch branch** in `connector-auth.ts:13-21`: `provider === "mcp-oauth"` → `mcpOauthAuthorizationHeaders(account, forceRefresh)`. The pool's 401-retry does the rest.
3. **Unblock the manifest path** at `plugin-runtime.ts:149`: `oauth_resource` now resolves to a connector `{auth: {type:"oauth", provider:"mcp-oauth", account:<connectorId>}}` in a `needs-signin` state instead of a hard blocker.
4. **Routes**: `POST /api/agent/connectors/[id]/authorize` → `{authorizationUrl}` (mirror of `accounts/google/authorize/route.ts`); `DELETE` → disconnect + revoke. Guarded by `requireApiAccess` like siblings.
5. **UI**: the Connect/Sign-in/Disconnect affordance and the browser-roundtrip-then-poll modal already exist in `plugins-section.tsx` / `google-account-modal.tsx` — widen `account.provider` beyond `"google"` (`plugin-runtime-contract.ts:43-51`) and reuse. Manual MCP servers get the same button in `connectors-section.tsx`.

Result: a bundled or user-added plugin whose MCP server advertises OAuth (Figma, Hugging Face, Mobbin — the exact servers already in the user's `~/.codex/config.toml`) shows **Sign in** → system browser → consent → tools appear in chat. Google Workspace stays on its dedicated provider (that's the server-side-style path where the user provisions credentials once).

**e2e — `e2e/connector-oauth.spec.ts`** (hermetic)
- Fixture `e2e/fixtures/oauth-mcp-server.mjs` (~150 lines): one Node process = streamable-HTTP MCP server with an `echo` tool **plus** its authorization server (`/.well-known/*`, `/register` DCR, `/authorize` auto-approving redirect, `/token`), rejecting tool calls without a valid Bearer.
- Spec: drop a plugin manifest with `oauth_resource` into the temp `LOCAL_STUDIO_DATA_DIR/plugins` → Plugins UI shows *Sign in required* → click **Sign in** → capture `{authorizationUrl}` from the route response (`page.waitForResponse`) and `page.goto()` it (e2e stand-in for the system browser) → auto-consent redirects to the loopback → UI polls to **Connected** → assert the connector inventory lists `test_echo` → fire a turn via the fake-model server scripted to call `test_echo` → assert the fixture saw a valid Bearer and the tool result rendered in the transcript. Every RFC leg (discovery, DCR, PKCE, exchange, header injection, 401-refresh) crosses real process boundaries.

Est: ~450-550 lines net of which ~150 is the test fixture. Smallest of the three.

---

## 3. Goals & Automations

### How Codex does it (confirmed)
- **Automations** = `~/.codex/automations/<id>/automation.toml`: `{kind:"cron", name, prompt, status ACTIVE|PAUSED, rrule (iCal), model, reasoning_effort, execution_environment:"local", target project|projectless, cwds}` + per-automation `memory.md` carried across runs. Fired by a **local scheduler tick in the desktop app** (quit dialog literally warns "Scheduled tasks won't run"); each run starts a thread with `threadSource:"automation"`; results land in a Scheduled inbox with unread badges. Schedule UI = presets (hourly/daily/weekdays/weekly) over RRULE.
- **Goals** = per-thread SQLite row `{objective, status active|paused|blocked|budget_limited|complete, token_budget, tokens_used, time_used_seconds}` + set/get/clear RPC + updated events. Continuation is event-driven at safe boundaries (turn done, thread idle, nothing queued), with anti-spin (continuation turn that makes no tool call suppresses the next) and budget auto-pause.

### Our foundation (verified)
The runtime **already runs turns fully headless**: `POST /api/agent/turn` is fire-and-forget (`handlers.ts:109-124`), the pi SDK loop runs in the runtime process, transcripts persist as JSONL regardless of subscribers, and the browser tool is server-side headless Playwright. Missing: any scheduler (none in the repo), a way for the sidebar to learn about sessions it didn't start, and notifications (greenfield; `desktop:focus-main-and-navigate` IPC exists as the click target).

### Design A — Automations (~500 lines)
**Store** `services/agent-runtime/src/automations-store.ts`: per-id JSON via the existing `createSessionScopedJsonStore` factory (atomic rename + promise lock) at `resolveDataDir()/automations/`:

```ts
{ version: 1, id, name, prompt, modelId, cwd,
  schedule: { kind: "interval", minutes } | { kind: "daily", time, weekdaysOnly? } | { kind: "weekly", day, time },
  status: "active" | "paused",
  lastRun?: { at, sessionId, piSessionId, outcome: "ok"|"error"|"aborted", summary },  // summary = last assistant text, injected into the next run's prompt (poor-man's memory.md, zero agent cooperation needed)
  unread: boolean, createdAt, updatedAt }
```

Preset schedules only in v1 — `nextRunAt(schedule, lastAt, now)` is a ~40-line pure function (unit-tested with fake clocks), no RRULE dependency. Codex's own UI is presets anyway.

**Scheduler** `automation-scheduler.ts`, started in `server.ts` boot: 30s tick → due + not-already-running → fire through the **same internal turn path** as the HTTP handler with `sessionId: "automation:<id>"`, prompt = automation prompt + previous `lastRun.summary` block. Missed-while-asleep runs are skipped (Codex behavior), next occurrence scheduled. On `agent_end` (the runtime already observes every event via `recordEvent`, `pi-runtime.ts:409-422`) record `lastRun`, set `unread`. Lives in the runtime ⇒ works identically in the desktop app and the pop-os standalone deploy.

**HTTP** (proxied like siblings): `GET/POST /api/agent/automations`, `PATCH/DELETE /:id`, `POST /:id/run` (Run-now — the e2e and UX workhorse), `POST /:id/read`.

**UI** (~200 lines): sidebar **Automations** section — rows (name · schedule label · last-run status dot · relative time · unread badge), create/edit sheet (name, prompt, schedule preset, project, model), Run now, pause. A run is an ordinary session (opens with existing navigation; tagged via the session-metadata overlay so the sidebar groups it). Freshness: the automations panel polls the list on a slow interval + on `SESSIONS_CHANGED`; completion fires a renderer-side web `Notification` (works in the Electron renderer, zero main-process code) whose click navigates to the run.

### Design B — Goals (~300 lines)
**Store**: extend the existing per-session metadata overlay (`session-metadata-store.ts`, already locked+atomic) with
`goal: { objective, status: "active"|"paused"|"blocked"|"complete"|"budget_limited", turnBudget?, turnsUsed, createdAt, updatedAt }`.
(Turn budget, not token budget, in v1 — the runtime sees turns natively and it's what the user actually reasons about locally.)

**Driver** in the runtime beside the scheduler: on `agent_end` for a session with an active goal → checks, in order: user-aborted? → pause · sentinel in final assistant text (`GOAL_COMPLETE` / `GOAL_BLOCKED`) → flip status · anti-spin (ending turn contained zero tool calls → suppress continuation, Codex rule) · budget exhausted → `budget_limited` · else after a 2s idle grace, fire a follow-up prompt: *"Continue working toward the goal: <objective>. Verify against concrete evidence before declaring completion; end with GOAL_COMPLETE or GOAL_BLOCKED + reason when finished."*

**Command surface**: `/goal <objective>`, `/goal pause|resume|clear|status` — drops straight into the composer command registry shipped yesterday (one more entry in `builtin-commands.ts` with injected actions). A small goal chip in the session header shows objective + status; abort button pauses.

**HTTP**: `GET/PUT/DELETE /api/agent/goal?sessionId=` on the runtime (driver colocated with authority).

**e2e — `e2e/automations-goals.spec.ts`** (hermetic via the fake-model server)
- Automations: create one in the UI → **Run now** → session appears in the sidebar under Automations → transcript streams the scripted reply → unread badge shows → open run clears it. Plus pure unit tests for `nextRunAt` and a runtime-level bun-test for the tick with fake clock.
- Goals: in a session, type `/goal …` → chip appears → scripted model does tool-call turn → assert a **second turn appears with no user input** (the auto-continue) → scripted `GOAL_COMPLETE` final → chip flips to complete. `/goal pause`/`clear` asserted deterministically.

---

## 4. Provider Hub — sign in to model providers (SHIPPED 2026-07-19)

> Implemented as designed below; all five e2e flows pass hermetically with video
> (`e2e/provider-hub.config.ts` + `provider-hub.spec.ts`, local-only since
> `frontend/e2e/` is gitignored). One deviation from the first draft: the Next
> server never instantiates pi's ModelRuntime — the agent-runtime process is
> marked as the single hub authority at boot and Next fetches provider models
> from `GET /api/agent/providers/models`.

### What pi already ships (verified in the bundled packages)
`@earendil-works/pi-ai` has a complete provider-auth subsystem, and `pi-coding-agent` exports its facade:

- **36 builtin providers**, five with OAuth login: `anthropic` (Claude Pro/Max), `openai-codex` (ChatGPT Plus/Pro), `github-copilot`, `xai` (Grok/X subscription), `radius`. Every other provider (openai, google, groq, openrouter, deepseek, cerebras, mistral, …) has an API-key login that prompts for the key.
- **`ModelRuntime`** (exported): `login(providerId, type, interaction)`, `logout`, `listCredentials`, `getProviderAuthStatus`, `checkAuth`, `getAvailable()` (only auth-configured providers), `getModel(providerId, modelId)`, `registerProvider(id, config)`, `reloadConfig`. Credentials persist to `<agentDir>/auth.json` (0600) — same file/format as the pi CLI; OAuth refresh runs under the store's serialized write lock at request time.
- **`AuthInteraction`** — login flows talk to the app through `prompt()` (text / secret / select / manual_code) and `notify()` (`auth_url`, `device_code`, info, progress). Render those six shapes and *every* provider's login works, current and future.
- **Session seam already merged**: our `pi-runtime.ts:158` resolves models via `services.modelRuntime.getModel(providerId, modelId)`, and `CreateAgentSessionServicesOptions.modelRuntime` lets us inject a shared instance. `AgentModel.providerId` already flows into that call (`pi-runtime.ts:129`), so provider models route with zero turn-path changes.

### Design: one shared ModelRuntime + a generic login-job surface
- **`services/agent-runtime/src/provider-hub.ts`**: process-wide `ModelRuntime` (authPath/modelsPath under `<dataDir>/pi-agent/` — beside the models.json we already write). Sessions receive this instance via the `modelRuntime` option, so a login is live for the next turn without restarts. Login = an in-memory **job**: the `AuthInteraction` appends events to the job and parks prompts until the UI responds.
- **Runtime routes** (proxied like turn/abort): `GET /api/agent/providers` (id, name, auth methods, status, connected type) · `POST /api/agent/providers/:id/login {type}` → `{jobId}` · `GET /api/agent/providers/login/:jobId?after=` (events + pending prompt, polled) · `POST …/respond {value}` · `POST …/cancel` · `POST /api/agent/providers/:id/logout`.
- **UI (configure)**: settings section **Model providers** beside Connectors: connected list with status + Sign out; Add provider → searchable builtin list → login sheet that renders job events generically (Open-browser button for `auth_url`, big user-code for `device_code`, inputs for prompts). API-key providers are the same flow — one secret prompt.
- **Models**: `refreshPiModels()` appends the hub's `getAvailable()` models mapped to `AgentModel` (`providerId` = pi provider id, grouped in the picker under the provider display name). Controller models stay primary; cloud providers sit beside them — "on top of the controller or aside it".

### Hermetic e2e with video (all flows in one journey)
`ProviderConfigInput.oauth` accepts a scripted OAuth implementation, so a test-only provider exercises the REAL pipeline (login job → auth_url → browser roundtrip → credential persisted to auth.json → bearer on requests → chat streamed):
- `e2e/fixtures/fake-cloud.mjs`: one Node process = authorization server (approve page + token endpoint) **and** `/v1` model API (SSE completions that reject requests without the minted Bearer).
- `LOCAL_STUDIO_E2E_PROVIDER=<module>` makes the hub register the scripted provider (and an API-key sibling) at boot — test-only, inert otherwise.
- `e2e/provider-hub.spec.ts` with `video: on`: open settings → connect OAuth provider (click Open browser, approve in a second tab) → status flips Connected → models appear in the picker → send a chat on the provider model → streamed reply renders → sign out → connect the API-key sibling by pasting a key. One continuous user journey, no cloud, videos archived per flow.

## Build order & sizing

| # | Feature | Net new code | Risk | Why this order |
|---|---------|--------------|------|----------------|
| 1 | Connector OAuth | ~500 lines | Low — generalizing working code | 80% exists; immediate payoff (Figma/HF/Mobbin servers user already uses) |
| 2 | Goals & Automations | ~800 lines + fixture | Low — headless already proven | Rides on confirmed fire-and-forget turns; reuses composer commands |
| 3 | Remote Access | ~800 lines | Medium — first WS, new public surface | Biggest new surface; controller deploy + relay hardening deserve their own pass |

Features are independent — any order works. The fake-model fixture lands first regardless (it hardens existing e2e too).
