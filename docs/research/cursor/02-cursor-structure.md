# Cursor 3.18.0 — UI Structure & Feature Architecture

Mapped from `/Applications/Cursor.app/Contents/Resources/app/` (product.json v3.18.0, vscode base 1.128.0). Evidence cited inline as `(src: …)`. Uncertain items marked `[?]`.

---

## 1. Layout regions

Cursor is a VS Code fork; it keeps the VS Code chrome and adds one first-class AI surface on the right. Regions, left→right / top→bottom:

| Region | What lives here | Evidence |
|---|---|---|
| **Title bar / command center** | App title, command-center search, and an **Agents Window button** (toggleable). Window controls. | `"Controls whether the Agents Window button in the title bar is shown."` `"Toggle visibility of the Agents Window button in the title bar"` (src: `nls.messages.json`). `"Agents Window Button"` (src: `nls.messages.json`). |
| **Activity bar** | Vertical icon rail with ~6 top-level destinations (Explorer, Search, Source Control, Run/Debug, Extensions, Remote/Testing). Cursor adds a **Background Agent** entry. Orientation is configurable (top/bottom or left/right). | `workbench.view.explorer/search/scm/debug/extensions/remote/testing/testCoverage/backgroundAgent` (src: `workbench.desktop.main.js`). `"Activity bar background color. The activity bar is showing on the far left or right and allows to switch between views of the side bar."` `"Background color of the activity bar when set to top / bottom."` `activitybarOrientation` (src: `workbench.desktop.main.js`, `workbench.desktop.main.css`). |
| **Primary sidebar** | The view container for whichever activity-bar destination is active (Explorer tree, Search, SCM, etc.). | `workbench.view.*` IDs register here; `"Toggle Sidebar"` / `workbench.action.toggleSidebar` (src: `workbench.desktop.main.js`). |
| **Editor area** | Tabbed editor groups, center. Standard VS Code editor with tabs, breadcrumbs, minimap. `"Active tab background color in an active group. Tabs are the containers for editors…"` (src: `nls.messages.json`). |
| **AI pane (secondary sidebar / Agents pane)** | First-class **right-hand** surface reserved for Cursor's agent UI. This is the single most important structural delta from VS Code: the Secondary Side Bar is *reserved* — extensions cannot contribute view containers there. | `"View containers cannot be contributed to the Secondary Side Bar in Cursor. It is reserved for Cursor's agent UI. Contribute to 'activitybar' or 'panel' instead."` (src: `nls.messages.json`). Actions: `workbench.action.toggleAgent`, `toggleAgents`, `toggleAgentsFromKeyboard`, `openAgentsView`, `openAgentLayoutQuickMenu`, `maximizeChatSize` (src: `workbench.desktop.main.js`). |
| **Panel (bottom)** | Terminal, Output, Problems, Debug Console — standard VS Code. | `"Terminal"`, `"Problems"`, `"Output"`, `"Debug Console"` (src: `nls.messages.json`). `workbench.action.togglePanel`. |
| **Status bar** | Standard VS Code status bar (branch, errors/warnings, encoding, remote indicator). | `"Background color for the remote indicator on the status bar."` (src: `nls.messages.json`). |

**Key structural point:** the AI pane is not a modal or a floating window — it is a **persistent right-hand column** that is part of the layout chrome, with its own toggle, maximize, and "Agents Window" affordances. `"Maximize Chat Size - hides editor, panel, and primary sidebar to focus on AI agent"` (src: `nls.messages.json`).

---

## 2. Primary navigation model

Top-level destinations are **very few** — the activity bar exposes the VS Code set plus one Cursor addition:

1. Explorer
2. Search
3. Source Control
4. Run and Debug
5. Extensions
6. Remote Explorer
7. Testing
8. **Background Agents** (`workbench.view.backgroundAgent`, `workbench.view.extension.backgroundAgent`) — Cursor-specific.

Everything else is behind the **command palette** (`Cmd+Shift+P` / `workbench.action.showCommands`), the **menu bar**, or **keybindings** — not a top-level destination. The menu bar retains the VS Code top-level menus: File, Edit, Selection, View, Go, Run, Terminal, Window, Help (src: `nls.messages.json` mnemonics `&&File`, `&&Edit`, `&&Selection`, `&&View`, `&&Go`, `&&Run`, `&&Terminal`, `&&Window`, `&&Help`). Cursor adds `&&Settings` / `&&VS Code Settings` / `&&Configure Settings` entries (src: `nls.messages.json`).

The agent/chat/composer surfaces are opened by **command** (palette, keybinding, menu item), not by activity-bar navigation — there is no "Chat" icon in the activity bar. Entry is via:
- `workbench.action.chat.open` / `openAgentsView` / `toggleAgent`
- `workbench.action.toggleAgents` / `toggleAgentsFromKeyboard`
- `workbench.action.openAgentLayoutQuickMenu`
- Keybindings: `Cmd+I`-style agent toggle inferred from `cmd+e`/`ctrl+e`/`meta+e` handling and `cmd+k` "Escape Focuses the Editor When You Have a Diff" (src: `workbench.glass.main.js`). `[?]` exact default keybindings for chat/agent are not fully resolvable from strings alone; the `cmd+e` reference is a *removal* path, not necessarily the default.

---

## 3. AI feature surfaces

Enumerated from action IDs (`workbench.desktop.main.js`) and string literals (`workbench.glass.main.js`, `nls.messages.json`):

| Surface | Entry points | Evidence |
|---|---|---|
| **Agent / Composer pane** (the right-hand AI pane) | `toggleAgent`, `openAgentsView`, `chat.open`, `openAgentLayoutQuickMenu`, `maximizeChatSize`. Labels: `"Open Agent"`, `"Open Chat"`, `"Open Composer"`, `"New Agent"`, `"New Chat"`, `"New Composer"`. | `workbench.action.chat.open`, `workbench.action.openAgentsView`, `workbench.action.toggleAgent`, `workbench.action.maximizeChatSize` (src: `workbench.desktop.main.js`). |
| **Inline Tab completions** (Cursor Tab) | Toggle via settings ("Tab" section), inline ghost-text. Label `"Cursor Tab"`. | `"Cursor Tab"` (src: `workbench.glass.main.js`). Settings section key `tab:"Tab"` (see §4). |
| **Cmd+K inline edit / "Edit"** | Inline prompt bar in the editor. Label `"Open Edit (Command K)"`. | `"Open Edit (Command K)"` (src: `workbench.glass.main.js`). `"Add to Chat"`, `"Add to Current Chat"`, `"Fix with Agent"` (src: `nls.messages.json`). |
| **Terminal chat** | `workbench.action.terminal.chat.start/makeRequest/runCommand/insertCommand/cancel/close`. Inline terminal assistant. | `workbench.action.terminal.chat.*` (src: `workbench.desktop.main.js`). |
| **Quick chat** | `workbench.action.quickchat.toggle`. | `workbench.action.quickchat.toggle` (src: `workbench.desktop.main.js`). |
| **Background / Cloud Agents** | Dedicated activity-bar view `workbench.view.backgroundAgent`; Agents Window; "Start Cloud Agent"; run many in parallel. | `"Background Agent"`, `"All Agents"`, `"Cloud agents"`, `"No recent agents"`, `"Start a new agent to see it here"`, `"Run Many Agents in Parallel"`, `"Open Agents Window and Start Cloud Agent"`, `"All your agents across repos—locally, on remote SSH, and in the cloud"` (src: `nls.messages.json`). Actions `workbench.action.backgroundComposer.*` (checkout, archive, applyChangesLocally, openCloudAgentById, showBackgroundAgentHistory, startSetup, restartSetup…) (src: `workbench.desktop.main.js`). |
| **Agent Review / BugBot** | `workbench.action.setupBugBot`; "Agent Review", "Start Agent Review", "Agent Review Settings". | `"Agent Review"`, `"Start Agent Review"`, `"Agent Review Settings"`, `"Setup BugBot"`, `"BugBot"` (src: `nls.messages.json`, `workbench.glass.main.js`). |
| **Infinite Composer session** (dev/experimental) | `startInfiniteComposerSession`, `stopInfiniteComposerSession`. | `workbench.action.startInfiniteComposerSession`, `workbench.action.stopInfiniteComposerSession` (src: `workbench.desktop.main.js`). |

**Context chips / @-mentions** in the agent prompt: `@git`, `@web`, plus slash commands `/agent /code /docs /web /terminal /edit /mcp /model /rules /chat /new /review /bugbot /generate` (src: `workbench.glass.main.js`). `[?]` the full @-mention set (e.g. `@files`, `@folders`, `@codebase`) is likely larger but only `@git` and `@web` appear as literal chips in the bundle; the others surface through slash commands and the "Codebase" indexing pipeline.

---

## 4. Settings information architecture

Cursor has **two separate settings surfaces**, a deliberate split:

- **Cursor Settings** — Cursor's own product settings, opened via `"Open Cursor Settings"` / `aiSettings.action.open…` (src: `workbench.glass.main.js`). This is a React-rendered page, not the VS Code settings editor.
- **VS Code Settings** — the standard VS Code settings JSON/editor, opened via `"Open VS Code Settings"` (src: `workbench.glass.main.js`, `nls.messages.json`).

The **Cursor Settings page** is organized into these sections, recovered verbatim from the section-key→label map in `workbench.glass.main.js`:

```js
wHt = {
  general:           "General",
  profile:           "Profile",
  "vscode-settings":  "VS Code Settings",
  appearance:         "Appearance",
  fun:                "Fun",
  "plan-usage":       "Plan & Usage",
  chat:               "Agents",
  browser:            "Browser & Network",
  tab:                "Tab",
  models:             "Models",
  "git-prs":          "Git & PRs",
  rules:              "Rules, Skills, Subagents",
  plugins:            "Plugins",
  customize:          "Customize",
  indexing:            "Indexing & Docs",
  mcp:                "Tools & MCPs",
  hooks:              "Hooks",
  beta:               "Beta",
  network:            "Network",
  "background-composer": "Cloud Agents",
  "self-driving":     "Self-Driving PRs",
  worktrees:           "Worktrees",
  developer:           "Developer"
}
```

(src: `workbench.glass.main.js`, `wHt={…}` and `sw0={...wHt, rules:"Rules, Skills, Subagents"}`.)

Notes:
- **"Rules, Skills, Subagents"** is one combined section (the `customize.openRules` / `openSkills` / `openSubagents` commands all route into this section). (src: `workbench.action.customize.openRules/openSkills/openSubagents`.)
- **"Tools & MCPs"** is the MCP section (label "MCP" in nls, "Tools & MCPs" in the settings map). `workbench.action.openMCPSettings`, `workbench.action.mcp.clearAllTokens`. (src: `workbench.desktop.main.js`.)
- **"Customize"** section covers `openCommands`, `openHooks`, `openPlugins` (also split into their own sections), `openSkills`, `openSkillPublishLogs`. (src: `workbench.action.customize.*`.)
- **"Models"** holds model selection + custom/API-key models. `userAddedModels`, `modelConfig`, `selectedModels` (src: `workbench.glass.main.js`). `"API Keys"`, `"Custom Models"` strings present.
- **"Plan & Usage"** — usage/billing/subscription is a **first-class section inside Cursor Settings**. Strings: `"Usage"`, `"{0} Usage"`, `"{0} Usage: {1} Requests"`, `"Plan"`, `"Subscription"`, `"Billing"` (src: `nls.messages.json`, `workbench.glass.main.js`). This is the in-app usage surface.
- **VS Code settings remain separate** — `"VS Code Settings"` is itself a *section within* the Cursor Settings page (the `vscode-settings` key), AND there is a distinct `"Open VS Code Settings"` action. So VS Code settings are reachable both as a tab inside Cursor Settings and as a separate command.

---

## 5. Deliberate absences (not found as in-app surfaces)

Derived by absence from view IDs, action IDs, and the settings section map. Stated as "not found as a surface" rather than asserting nonexistence. Where a concept exists *inside* Cursor Settings, that is noted to avoid contradiction.

- **Integrations hub page** — "Integrations" appears only as a backend/team-admin concept (`team.integrations.read`, Sentry transport `defaultIntegrations`), not as a view or settings section. Not found as a user-facing surface. (src: `workbench.glass.main.js` — no `workbench.view.*integrations*`, no settings key.)
- **Automations page** — "Automations" appears only as a capitalized string in the glass bundle, not bound to any view/action/settings key. Not found as a surface. (src: no `workbench.action.*automation*`, no settings key.)
- **Standalone / top-level usage dashboard** — Usage **is** present in-app, as the **"Plan & Usage"** section of Cursor Settings (see §4). What is *not* found is a dedicated, standalone usage-dashboard *view*: "Dashboard" exists only as backend protobuf types (`CloudAgentDashboardRun*`, `ListCloudAgentRunsForDashboardRequest`, `CloudAgentDashboardRunSortField/SortDirection`) and a team-admin analytics API (`UpdateTeamDashboardAnalyticsSettingRequest`). There is no `workbench.view.dashboard` and no `workbench.action.*dashboard`. So a top-level, full-page usage dashboard surface is not found; usage is surfaced only as a settings section. (src: `workbench.desktop.main.js` — dashboard only in protobuf message types; `workbench.glass.main.js` — `plan-usage` settings key.)
- **Admin console / team admin panel** — `team.plugins.read`, `ManageTeamPlugins`, `ReadTeamIntegrations` exist as permission scopes, but no in-app admin view is registered. Not found as a surface in the app bundle.
- **Extensions marketplace as a top-level destination** — Extensions is an activity-bar view (standard VS Code), but Cursor replaces the MS marketplace with `marketplace.cursorapi.com` / open-vsx (src: `product.json` `linkProtectionTrustedDomains`). The marketplace is a view, not absent — noted for accuracy.

---

## 6. Onboarding / empty states

- **First-run wizard:** `"Welcome to Cursor"` / `"Welcome to Cursor, {0}"` via `glass.ftuxWizard.welcome.title`. `"Get started with Cursor"` CTA with `cta:"start_onboarding"`, subtitle `"Discover what Cursor can d[o]"`. (src: `workbench.glass.main.js`.)
- **VS Code import:** `"Bring your VS Code setup to Cursor. Import your settings and extensions for a seamless start."` (src: `nls.messages.json`).
- **Getting Started / Walkthroughs:** `"Open the Welcome page, with content to aid in getting started…"`, `"Contribute walkthroughs to help users getting started with your extension."` (src: `nls.messages.json`). `"Getting Started"` appears as both a settings-section-adjacent label and a Welcome-page concept.
- **Empty states:** Agent list empty: `"No recent agents"`, `"No recent agents yet."`, `"Start a new agent to see it here"`. (src: `workbench.glass.main.js`, `nls.messages.json`.)
- **Meet the new Cursor:** `"Meet the new Cursor"` string present (src: `nls.messages.json`) — likely a release-notes / what's-new surface.
- **Skill migration banner:** `"Skill migration banner forced on, but no Agent Store is mounted yet, so it will stay hidden. Sign in and try again."` (src: `workbench.glass.main.js`) — suggests a skill-store onboarding flow gated on sign-in.

---

## Evidence notes

- **product.json** (src: `/Applications/Cursor.app/Contents/Resources/app/product.json`): confirms app identity (Cursor, Anysphere, vscode 1.128.0 base), marketplace domains, `cannotImportExtensions: ["github.copilot-chat","github.copilot","ms-vscode.remote-explorer"]` (Cursor actively blocks Copilot), and `extensionReplacementMapForImports` rewriting MS remote extensions to `anysphere.*`.
- **workbench.desktop.main.js** (41.7 MB): the main VS Code workbench bundle. Source for all `workbench.view.*` and `workbench.action.*` identifiers cited above.
- **workbench.glass.main.js** (49.2 MB): Cursor's own "Glass" UI layer. Source for the settings section map (`wHt`), onboarding strings, keybinding references, and AI-surface labels.
- **workbench.anysphere-ui-automations.js** (9 MB): Cursor automation/UI layer; only `composer` identifier appeared in the targeted grep, suggesting this bundle handles UI automation hooks rather than view registration.
- **react-runtime/chunk-*.js**: React + ReactDOM library bundles (identifiers `ForwardRef`, `Suspense`, `Profiler`, etc.), not Cursor UI. Cursor's React UI is compiled into `workbench.glass.main.js`, not these chunks.
- **nls.messages.json** (668 KB): VS Code's i18n string table. Source for menu mnemonics, color/theme descriptions (which name layout regions explicitly), and Cursor-specific strings ("Cursor Settings", "Agents Window", background-agent strings).
- **extensions/**: 116 built-in extensions. Cursor-specific: `cursor-agent-exec`, `cursor-agent-host`, `cursor-agent-worker`, `cursor-always-local`, `cursor-browser-automation`, `cursor-checkout`, `cursor-commits`, `cursor-deeplink`, `cursor-explorer`, `cursor-file-service`, `cursor-local-agent-runtime`, `cursor-mcp`, `cursor-ndjson-ingest`, `cursor-polyfills-remote`, `cursor-resolver`, `cursor-resolver-helper`, `cursor-retrieval`, `cursor-shadow-workspace`, `cursor-socket`, `cursor-worktree-textmate`, `theme-cursor`. Plus standard VS Code language/theme extensions. The `cursor-mcp` extension backs the "Tools & MCPs" settings section.

**Methodological caveat:** keybinding defaults (e.g. the exact default for "Toggle Agent") are not fully recoverable from string greps — they live in compiled keybinding registrations that would require runtime inspection or the `keybindings` JSON in the user profile. All other conclusions are grounded in literal string/identifier matches.
