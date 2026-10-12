# Local Studio — User-Facing Surface Inventory

## Master Table

| Surface | Route / Entry | Feature dir | Approx LOC | State / Notes |
|---|---|---|---|---|
| **Status (dashboard)** | `/` (root) | `features/dashboard/` | 3,084 | Fully wired. GPU strip, control panel, runtime status, model stop/launch. The landing page. |
| **Models** | `/models` | `features/recipes/` | 7,458 | Fully wired. `app/models/page.tsx` renders `RecipesContent`. Catalog table, explore tab, downloads tab, recipe modal editor, VRAM estimator. (Route `/recipes` and `/discover` both `permanentRedirect("/models")`.) |
| **Agent (chat workspace)** | `/agent` | `features/agent/` | 32,146 | Fully wired — the largest feature by far. Chat pane, composer, timeline, terminal panel, browser panel, filesystem panel, git-diff panel, goals, subagents, quick-panel, projects nav, session management, runtime controller. |
| **Automations** | `/agent/automations` | `features/agent/automations/` | 1,520 | Fully wired. Automation list, editor, run history, session picker. |
| **Integrations** | `/integrations` | `features/integrations/` | 4,368 | Fully wired (6 tabs). See detailed section below. |
| **Configure** | `/configure` | `features/configure/` | 1,472 | Fully wired (2 sections only: Machines, Server). Stripped down — Overview, Integrations, and other former tenants removed. |
| **Settings** | `/settings` | `features/settings/` | 5,139 | Fully wired (7 sections). Also doubles as entry to setup wizard when backend is offline. |
| **Usage** | `/usage` | `features/usage/` | 1,677 | Fully wired. Tabs: Models, Activity, Controller, Errors. Token activity heatmap. |
| **Logs** | `/logs` | `features/logs/` | 1,237 | Wired but orphaned from sidebar. Reached only via dashboard "onNavigateLogs" callback (`use-dashboard-data.ts:50`). No sidebar nav row. |
| **Setup wizard** | `/setup` | `features/setup/` | 2,403 | Fully wired. Multi-step first-run wizard. Sidebar hidden on this route (`routeHidesAppSidebar`). Also reachable from `/settings` when backend offline. |
| **Quick panel** | `/quick` | reuses `features/agent/` | — | Fully wired. Compact `AgentWorkspace` in a floating panel. Sidebar hidden. Escape to dismiss. |
| **Access (token gate)** | `/access` | inline in `app/access/page.tsx` | ~37 | Fully wired. Server-side token form. Shown when API access protection is enabled. |
| **Server (redirect)** | `/server` | redirects to `/configure?section=server#server` | — | Pure redirect. No content of its own. |
| **Discover (redirect)** | `/discover` | redirects to `/models` | — | Pure redirect. |
| **Recipes (redirect)** | `/recipes` | redirects to `/models` | — | Pure redirect. |

**Shared infrastructure (not routes):**

| Area | Dir | LOC | Notes |
|---|---|---|---|
| Shell / sidebar | `features/shell/` | 1,113 | Sidebar nav, profile footer, QR code, app update. |
| UI primitives | `ui/` | 3,654 | Design system: buttons, modals, drawers, tables, icons. |
| Setup wizard | `features/setup/` | 2,403 | Steps: welcome, hardware, bringup, model. |

---

## Sidebar Navigation

Source: `frontend/src/features/shell/left-sidebar-nav.tsx:22-29`

```
1. Status      →  /
2. Models       →  /models
3. Automations  →  /agent/automations
4. Integrations →  /integrations
5. Configure    →  /configure
6. Usage         →  /usage
```

Six entries, top to bottom. The comment at line 16-21 explains the ordering: "widening scope — what is running, what it can run, what runs on its own, what it can reach outside this machine, and only then the machine's own settings."

**Not in the sidebar:** `/agent` (the chat workspace — sessions are reached via the command palette / search, not a nav row, per line 16 comment: "Sessions has no nav row: the Search command palette is the session list"), `/logs`, `/setup`, `/quick`, `/access`.

---

## Integrations Page — Detailed Analysis

### Page structure

Source: `frontend/src/features/integrations/integrations-page.tsx`

The page uses `TabbedPage` with 6 tabs, selected via URL hash (`#connectors`, `#plugins`, etc.):

| # | Tab label | ID | Component | Icon |
|---|---|---|---|---|
| 1 | MCP servers | `connectors` | `ConnectorsSection` | Plug |
| 2 | Plugins | `plugins` | `PluginsSection` | Puzzle |
| 3 | Accounts | `accounts` | `GoogleAccountsSection` | KeyRound |
| 4 | Access | `access` | `ConnectorAccessSection` | ShieldCheck |
| 5 | Model accounts | `models` | `ModelProvidersSection` | Brain |
| 6 | Skills | `skills` | `SkillsSection` | GraduationCap |

Navigation source: `frontend/src/features/integrations/integration-navigation.ts`

### The three "verified" surfaces

The owner reports "verified appears as three tabs." The word "verified" / "verification" does not appear as a tab label or section title anywhere in the Integrations page. What it *does* appear as is `verificationUri` — the OAuth **device-flow** verification URI (the URL where the user types their device code, e.g. `github.com/login/device`). This field surfaces in exactly **three** components across the Integrations page:

1. **`connector-oauth-drawer.tsx`** (lines 46-73) — `DeviceCodePanel` renders `verificationUri` as "Enter this code at {host}" with an "Open" button. This is the **MCP servers → Connectors** tab, shown when connecting a GitHub (or other OAuth device-flow) connector. The `verificationUri` comes from the runtime's authorize response (`OAuthAuthorizeResponseSchema`).

2. **`model-providers-section.tsx`** (lines 85-105) — `EventLine` renders `payload.verificationUri` as a clickable link when a model provider login emits a `device_code` event. This is the **Model accounts** tab, shown during provider sign-in flows that use device-code auth.

3. **`google-account-setup.tsx`** (line 11) — the comment mentions "verification state" in the context of Google Cloud project verification, not a UI tab. This is the **Accounts** tab, shown when the user is setting up their Google OAuth client. The actual word appears only in a code comment explaining *why* no client ID is baked in: "a client id embedded in a desktop app is extractable, and every install would then share one Cloud project's quota and verification state."

**Summary:** "verified" is not three tabs. It appears in three *different components* across three different tabs, all referring to the same concept — OAuth device-flow verification (`verificationUri`) — or to Google's app-verification status (in a comment). The repetition is structural: the same device-flow pattern is implemented independently for catalog connectors, model providers, and Google accounts.

### (a) How many tabs/sections mention "verified" or repeat similar content

- `verificationUri` (device-flow code entry URL): appears in `connector-oauth-drawer.tsx` and `model-providers-section.tsx` — two components, two different tabs (MCP servers, Model accounts).
- "verification state" / "verification failed": appears in `google-account-setup.tsx` (comment) and `services/agent-runtime/src/google-account.ts` (error messages: "Google account verification failed" line 641, "Google scope verification failed" line 993) — surfaces in the Accounts tab.
- **No tab is labelled "verified."** The three surfaces are functionally distinct: connector OAuth, provider login, and Google account setup. They share the device-flow pattern but are not duplicate UI.

### (b) Google OAuth flow — what it does and where unverified-app failure surfaces

**Flow:**
1. User opens the **Accounts** tab (`GoogleAccountsSection`), sees two services: Gmail and Google Calendar (defined in `services/agent-runtime/src/google-workspace-binding.ts:1`: `GOOGLE_WORKSPACE_PLUGIN_IDS = ["gmail", "google-calendar"]`).
2. Clicking a service opens `GoogleAccountModal` (`google-account-modal.tsx`).
3. If no client ID is configured, `GoogleAccountSetup` (`google-account-setup.tsx`) is shown. The app ships **no baked-in Google client ID** — the user must paste their own OAuth client ID from Google Cloud Console. Comment at line 9-13: "Local Studio ships no Google OAuth client, and deliberately so: a client id embedded in a desktop app is extractable."
4. On "Connect" (`google-account-modal.tsx:129-167`): saves client ID via `PUT /api/agent/accounts/google`, then calls `POST /api/agent/accounts/google/authorize` to get an `authorizationUrl`.
5. The authorize endpoint (`services/agent-runtime/src/google-account.ts:517-575`) builds a PKCE flow URL:
   - **Client ID source:** `metadata.clientId` — either the user-saved ID or `process.env.LOCAL_STUDIO_GOOGLE_CLIENT_ID` (env fallback, line 293).
   - **Redirect URI:** `loopbackRedirect()` — a `http://127.0.0.1/callback` loopback listener (line 490-493). Must be private loopback; any other form throws `GoogleAccountError(400, "Google sign-in requires a private loopback callback")`.
   - **Scopes:** `openid`, `email`, plus per-service scopes from `GOOGLE_WORKSPACE_BINDINGS`:
     - Gmail: `https://www.googleapis.com/auth/gmail.readonly`
     - Calendar: `calendar.calendarlist.readonly`, `calendar.events.freebusy`, `calendar.events.readonly`
   - `prompt: "select_account consent"` (line 567) — forces account picker + consent.
   - `access_type: "offline"` for refresh tokens.
6. The URL is opened in the system browser via `openExternal()` (`google-account-model.ts:29-35`), using the desktop bridge or `window.open`.
7. Frontend enters polling mode (`google-account-modal.tsx:113-127`): polls `GET /api/agent/accounts/google` every 1 second for 90 attempts (90 seconds). Success is detected when `connectionSignature` changes (new mailbox connected).
8. On timeout: cancels authorization, shows "Google sign-in timed out. Start again when you are ready."

**Where unverified-app failure surfaces:**

The "This app isn't verified" screen is rendered by **Google itself** in the external browser — the user sees Google's standard scary warning page with "Advanced" → "Go to {app name} (unsafe)". The Local Studio runtime never sees this directly. The failure manifests as:

- **User abandons:** the callback never fires → loopback listener never receives a code → frontend polls for 90s → timeout error: "Google sign-in timed out. Start again when you are ready." (`google-account-modal.tsx:123`).
- **User clicks through and grants:** token exchange proceeds. If the token exchange fails: `GoogleAccountError(502, "Google rejected the authorization code")` (line 624). If the userinfo lookup fails: `GoogleAccountError(502, "Google account verification failed")` (line 641). If required scopes weren't granted: `GoogleAccountError(403, "Google did not grant every required read-only scope")` (line 705) or `GoogleAccountError(403, "Google scope verification failed")` (line 993).
- **Transport note:** if `LOCAL_STUDIO_GOOGLE_MCP_PREVIEW` is set, tools are served by Google's Workspace MCP preview, which "may not accept a self-registered Desktop client" (`google-account-model.ts:71-72`).

The error text appears in the modal's `setError()` → rendered as `<Alert variant="error">` at the top of the modal (`google-account-modal.tsx:161-163`).

### (c) GitHub connection — what it does and how it fails

**Flow:**
1. GitHub appears in the **MCP servers** tab (`connectors-section.tsx`) as a catalog entry (`connector-catalog.ts:48-59`).
2. Clicking "Connect" opens `ConnectorOAuthDrawer` (`connector-oauth-drawer.tsx`).
3. GitHub uses the **OAuth device flow** (not PKCE). Definition in `services/agent-runtime/src/oauth-connector-contract.ts:70-98`:
   - `kind: "oauth-device"`
   - `deviceUrl: "https://github.com/login/device/code"`
   - `tokenUrl: "https://github.com/login/oauth/access_token"`
   - `scopes: ["repo", "read:org"]`
   - `tokenEnv: "GITHUB_PERSONAL_ACCESS_TOKEN"` — the token is injected into the MCP child process's env.
   - `identityUrl: "https://api.github.com/user"` (fetches login name for display).
   - **No baked-in client ID** (`clientId` absent). The user must register a GitHub OAuth app. `createClientUrl` deep-links to `https://github.com/settings/applications/new?...` pre-filled with "Local Studio" name and `127.0.0.1/callback` callback URL.
   - `setupHint`: "Register the pre-filled OAuth app, tick 'Enable Device Flow' on its settings page, then paste its Client ID here."
4. The `ClientSetup` sub-component (`connector-oauth-drawer.tsx:97-124`) shows the registration link and a client ID input field when no client ID is stored.
5. Once a client ID exists (stored in `oauth-tokens.json`), clicking Connect calls `POST /api/agent/oauth/authorize` → runtime requests a device code from GitHub → `DeviceCodePanel` shows the user code and `verificationUri` (github.com/login/device).
6. User types the code at GitHub → runtime polls `tokenUrl` until GitHub returns a token (`oauth-connectors.ts`, device poll loop).
7. On success: token is stored, connector row is upserted (`commitConnection`, `oauth-connectors.ts:274-305`), MCP server (`@modelcontextprotocol/server-github@2025.4.8`) is configured with the token in env.

**How it fails:**

- **No client ID registered:** `ClientSetup` panel shows — user must register an OAuth app. If they don't tick "Enable Device Flow" in the GitHub app settings, the device-code endpoint returns an error. The runtime throws `OAuthConnectorError` with the provider's message.
- **Provider unreachable:** `OAuthConnectorError(502, "The OAuth provider could not be reached")` (`oauth-connectors.ts:195`).
- **Device code expired / user doesn't enter code in time:** the poll loop gets `expired_token` from GitHub → `OAuthConnectorError` with that error.
- **User denies at GitHub:** the poll gets `access_denied` → error surfaces in the drawer's `<Alert>`.
- **Token response missing access_token:** `OAuthConnectorError(502, "The OAuth provider returned no access token")` (line 254).
- **Frontend:** `ConnectorOAuthDrawer` displays errors via `failureMessage()` (line 257-258) in an `<Alert variant="error">`.

**Why "GitHub does not work" (owner report):** The most likely cause is that no client ID is configured and the user hasn't registered a GitHub OAuth app with Device Flow enabled. There is no baked-in `clientId` for GitHub (unlike some providers that ship one). The `setupHint` is shown in the drawer, but the user must leave the app, register on github.com, tick Device Flow, and paste the Client ID back. If the user expects click-to-connect, they'll see the `ClientSetup` panel instead and perceive it as broken.

---

## Settings / Configure Surface

### Configure (`/configure`)

Source: `frontend/src/features/configure/configure-page.tsx`, `configure-navigation.ts`

**2 sections** (down from more — the page was deliberately stripped):

| Section | ID | Component | Description |
|---|---|---|---|
| Machines | `machines` | `MachinesSection` | GPU nodes this workspace can run models on. Node form modal, hardware art, machine cards. |
| Server | `server` | `ServerContent` (from `features/logs/server-view.tsx`) | Controller health, logs, API reference. |

Removed tenants: "Overview" (was a table duplicating the rail), "Integrations" (moved to its own route). The `configure-navigation.ts` file retains forwarding logic: `configureSectionRedirect()` sends old `?section=integrations` links to `/integrations#connectors`. Legacy aliases: `overview` → `machines`, `rig`/`rigs` → `machines`.

### Settings (`/settings`)

Source: `frontend/src/features/settings/settings-view.tsx:44-57`

**7 sections:**

| Section | ID | Label | Icon | Description |
|---|---|---|---|---|
| Profile & phone | `profile` | Profile & phone | Smartphone | Identity, phone pairing (QR code). |
| General | `connection` | General | Cable | Controller connections, API access, test connection. |
| System | `system` | System | Cpu | Engines, services, storage, hardware, runtime targets. |
| Appearance | `appearance` | Appearance | Paintbrush | Theme, typography, interface scale. |
| Shortcuts | `terminal` | Shortcuts | Keyboard | Quick panel and terminal key bindings. |
| Archived chats | `archive` | Archived chats | Archive | Hidden sessions, restore. |
| Setup | `setup` | Setup | ServerCog | Local prerequisites, first-run checks. |

The settings page also conditionally renders `SetupView` (the full setup wizard) when backend is offline and setup hasn't been completed (`app/settings/page.tsx:31-39`).

---

## Other Feature Areas

### Agent chat workspace (`/agent`)
- **Entry:** `/agent` → `AgentWorkspace` shell (`features/agent/ui/agent-workspace-shell.tsx`)
- **LOC:** 32,146 total across `features/agent/` — the dominant feature
- **Sub-areas:**
  - `agent/ui/` — 20,856 LOC. Chat pane, composer, browser panel, terminal panel, filesystem panel, git-diff panel, computer status panel, goal card/strip, model picker, pane grid, sessions command, projects nav.
  - `agent/runtime/` — 2,681 LOC. Session runtime controller, engine, prompt stream, session status, API client.
  - `agent/automations/` — 1,520 LOC. Automation list, editor, run history, session picker.
  - `agent/workspace/` — 2,475 LOC. Workspace state, effects, pane controller, persistence, drafts, replay queue.
  - `agent/tools/` — 1,089 LOC. Context provider, browser/terminal tool state, persistence.
  - `agent/messages/` — 513 LOC. Message types, helpers, export, reasoning prefs.
  - `agent/pi/` — 555 LOC. Pi adapter, transcript, wire.
  - `agent/projects/` — 547 LOC. Project store, API, context.
  - `agent/composer/` — 310 LOC. Command registry, builtin commands, catalogue commands.
  - `agent/ui/timeline/` — 2,581 LOC. Message timeline, activity grouping, subagent rows.
  - `agent/ui/projects-nav/` — 2,246 LOC. Session rows, directory picker.
  - `agent/ui/quick-panel/` — 171 LOC. Quick panel top bar, bridge.
- **State:** Fully wired. All panels render through `renderWorkspacePane` → `ChatPane` with tab-based computer panel (browser/terminal/files/git).

### Terminal panel
- **Entry:** `/agent` workspace, computer tab → terminal
- **Files:** `features/agent/ui/terminal-panel.tsx`, `persistent-terminals.tsx`, `web-pty-bridge.ts`
- **API:** `/api/agent/terminal/pty/[action]`, `/api/agent/terminal/resolve-cwd`
- **State:** Fully wired. PTY bridge over WebSocket. Persistent terminals per project.

### Browser panel
- **Entry:** `/agent` workspace, computer tab → browser
- **Files:** `features/agent/ui/agent-browser-panel.tsx`, `agent-browser.tsx`, `agent-browser-screencast.tsx`, `agent-browser-start-page.tsx`, `agent-browser-engine-picker.tsx`, `agent-browser-reading-view.tsx`, `agent-browser-effects.ts`
- **API:** `/api/agent/browser/*` (viewport, input, frame, state, fetch, engines, history, locals)
- **State:** Fully wired. Lazy-loaded. Engine picker, screencast, reading view. Toggleable via `tools.browser.enabled`.

### Filesystem panel
- **Entry:** `/agent` workspace, computer tab → files
- **Files:** `features/agent/ui/filesystem-panel.tsx`, `filesystem-tree.tsx`, `filesystem-preview.tsx`, `filesystem-file-viewer.tsx`, `filesystem-panel-effects.tsx`, `file-open-actions.tsx`
- **State:** Fully wired. Tree, preview, file viewer.

### Git-diff panel
- **Entry:** `/agent` workspace, computer tab → git
- **Files:** `features/agent/ui/git-diff-panel.tsx`, `git-diff-drawer.tsx`, `git-diff-panel-diff-view.tsx`, `git-diff-panel-model.ts`, `git-diff-panel-workflow.tsx`, `features/agent/git.ts`
- **State:** Fully wired. Diff view, workflow actions (commit/PR merge via `/api/agent/pr/merge`).

### Goals
- **Entry:** `/agent` workspace, composer command `/goal`
- **Files:** `features/agent/ui/goal-card.tsx`, `goal-strip.tsx`, `goal-presentation.ts`, `use-goal-command.ts`, `use-goal-mode.ts`, `use-session-goal.ts`
- **State:** Fully wired. Goal mode via composer commands.

### Subagents
- **Entry:** `/agent` workspace, status panel
- **Files:** `features/agent/ui/status-panel-subagents.tsx`, `use-subagents.ts`
- **API:** `/api/agent/subagents`, `/api/agent/subagents/[runId]/stop`
- **State:** Fully wired. Subagent runs displayed in status panel.

### Skills (Integrations tab)
- **Entry:** `/integrations#skills`
- **Files:** `features/integrations/skills-section.tsx`
- **API:** `/api/agent/plugins/source`
- **State:** Fully wired. Skill list, drawer with source view, clipboard copy.

### Prompt templates / Themes
- **Themes:** `features/settings/appearance-settings.tsx` (22.0 KB — the largest settings file). Theme tokens, typography, scale. Fully wired.
- **Prompt templates:** No dedicated prompt-template surface found. Composer commands (`features/agent/composer/builtin-commands.ts`, `catalogue-commands.ts`) provide slash commands but there is no template library UI.

---

## Wiring State Summary

### Fully wired (production)
- Status dashboard, Models, Agent workspace (all panels), Automations, Integrations (all 6 tabs), Configure (Machines + Server), Settings (all 7 sections), Usage, Setup wizard, Quick panel, Access gate.

### Redirects (no content)
- `/discover` → `/models`
- `/recipes` → `/models`
- `/server` → `/configure?section=server#server`

### Orphaned from sidebar (reachable but not via nav rail)
- `/logs` — has a full page (`features/logs/logs-view.tsx`) but no sidebar row. Reached only via dashboard's `onNavigateLogs` callback. The Server section in Configure embeds the same `ServerContent` component, so `/logs` is partially redundant with `/configure?section=server`.
- `/agent` — the main chat workspace. No sidebar row by design (sessions reached via command palette/search). This is intentional per the code comment at `left-sidebar-nav.tsx:16`.
- `/setup`, `/quick` — sidebar hidden by design (`routeHidesAppSidebar`).
- `/access` — gate page, not meant for sidebar.

### No TODOs / feature flags / stubs found
A grep for `TODO`, `FIXME`, `HACK`, `WIP`, `coming soon`, `not implemented`, `placeholder` (in functional sense) across all feature directories returned only `placeholder` attributes on form inputs (expected) and `ProjectsNavPlaceholder` (a real component that renders an empty state for the projects nav, not a stub). The codebase appears clean of half-finished features — the surface is either fully wired or deliberately removed (the Configure page comments explicitly document what was cut).

---

## Smallest Useful Core

**The daily-value surfaces, in order of importance:**

1. **Agent workspace** (`/agent`, 32K LOC) — the chat. This is the product. Everything else exists to serve it.
2. **Models** (`/models`, 7.5K LOC) — model catalog + recipe editor. The gateway to launching models. Without this, the agent has nothing to talk to.
3. **Status dashboard** (`/`, 3K LOC) — GPU/runtime health, model stop/launch. The landing page; tells you if the machine is running.
4. **Settings → General + System** (~5K LOC combined) — controller connection and engine management. Required to point the app at a backend.
5. **Setup wizard** (`/setup`, 2.4K LOC) — first-run onboarding. Gets a user from zero to a running model.

**Peripheral surfaces (could be cut without losing core value):**

- **Integrations** (4.4K LOC, 6 tabs) — Google OAuth, GitHub connector, MCP servers, plugins, skills, model accounts, access grants. The owner reports Google and GitHub are both broken. The MCP-servers tab is the most useful (user-added connectors); the Accounts tab (Google) is broken-by-design (unverified app); the Model accounts tab duplicates functionality that could live in Settings. The Access tab (grants) is advanced configuration. Skills and Plugins are power-user features.
- **Automations** (1.5K LOC) — scheduled/triggered agent runs. Valuable but not daily-use for most users.
- **Usage** (1.7K LOC) — token/cost analytics. Nice-to-have, not load-bearing.
- **Logs** (1.2K LOC) — partially redundant with Configure → Server section. Could be merged.
- **Configure** (1.5K LOC, 2 sections) — already stripped to essentials. Machines + Server only.
- **Settings → Appearance, Shortcuts, Archived chats, Setup section** — polish and housekeeping. The Appearance settings alone are 22 KB of code for theme customization.
- **Goals, subagents** (within the 32K agent LOC) — advanced agent features; the chat works without them.

**If the goal is smallest viable Studio:** Agent workspace + Models + Status + Settings (connection/system only) + Setup wizard. Everything else — Integrations, Automations, Usage, Logs, Appearance, Shortcuts — is either peripheral, broken, or duplicative.
