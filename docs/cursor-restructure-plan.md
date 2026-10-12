# Cursor-shape restructure: cut the surface, keep the core

Wave 2 synthesis (2026-08-25). Inputs: four GLM-5.2 research reports in
[docs/research/cursor/](research/cursor/) — Cursor 3.18.0's real design tokens
(01), its product structure recovered from the app bundle (02), a full
inventory of Local Studio's surface (03), and Cursor's public docs taxonomy
(04) — plus first-hand reproduction of the Integrations-page problems on a dev
build. Wave 1 ran as four omp/GLM-5.2 workers in tmux against the homelab.

## What triggered this

The owner's report, verified in the running app:

- The Integrations page has **six tabs** (MCP servers, Plugins, Accounts,
  Access, Model accounts, Skills). Three of them — Accounts, Access, Model
  accounts — are all "connect and authorize something", split across three
  different auth paradigms. (The reported "3 tabs for verified" resolves to
  this: the OAuth `verificationUri` device-flow pattern is implemented
  independently in three components across three tabs — see 03 §"three
  verified surfaces".)
- **Google** (Accounts tab) requires pasting your own OAuth client ID and then
  lands on Google's **unverified-app wall**. This is broken-by-design: Local
  Studio deliberately ships no Google client (an embedded client id is
  extractable), so every user hits the scary screen with their own unverified
  Cloud project. Not fixable by code; only by shipping a verified client
  (an ongoing Google-review liability) or by not offering the flow.
- **GitHub** (MCP servers tab) requires registering your own GitHub OAuth app,
  ticking "Enable Device Flow", pasting the client id back, then doing a
  device-code dance — all to obtain a token that is ultimately injected as
  `GITHUB_PERSONAL_ACCESS_TOKEN` into the MCP child. A user who expects
  click-to-connect sees a setup form and correctly reads it as "doesn't work".

## What Cursor does instead (evidence: 02, 04)

1. **One window, almost no top-level destinations.** The activity bar holds
   workspace views only; the AI pane is a reserved right-hand column. Nothing
   product-shaped gets its own page.
2. **One settings surface.** Everything that is not the workspace is a
   *section* of the single "Cursor Settings" page — the recovered section map:
   General, Profile, VS Code Settings, Appearance, Fun, **Plan & Usage**,
   Agents, Browser & Network, Tab, **Models**, Git & PRs, **Rules/Skills/
   Subagents**, **Plugins**, Customize, Indexing & Docs, **Tools & MCPs**,
   Hooks, Beta, Network, Cloud Agents, Self-Driving PRs, Worktrees, Developer.
3. **Usage is a settings section**, not a dashboard.
4. **MCP is the only integration mechanism.** There is no integrations hub, no
   per-provider OAuth flows in-app; "Tools & MCPs" is a settings section.
   (Their hosted integrations — Slack, Jira, Linear — live on the web side,
   not in the editor.)
5. **No automations surface** in the app at all.

Local Studio today, for contrast (evidence: 03): 6 sidebar destinations plus 5
hidden routes, **two** settings surfaces (Settings ×7 sections + Configure ×2),
a standalone Usage page (4 tabs), an orphaned /logs route that duplicates
Configure→Server, and the six-tab Integrations page.

## The plan

### A. One Settings surface (the structural move)

Merge Settings (7 sections) + Configure (2 sections) + Usage (page) + the
surviving Integrations tabs into **one settings page with a section rail**,
Cursor-style. Proposed section list, in Cursor's ordering spirit:

| Section | Absorbs |
|---|---|
| General | Settings→General (connection, API access) |
| Profile & Phone | Settings→Profile |
| Appearance | Settings→Appearance |
| Shortcuts | Settings→Shortcuts |
| Models | *(model accounts)* Integrations→Model accounts (pi provider hub) |
| Machines | Configure→Machines |
| System | Settings→System (engines, storage, runtime targets) |
| Server & Logs | Configure→Server + the orphaned /logs route (one tenant) |
| Tools & MCP | Integrations→MCP servers, with per-connector access folded in (see C) |
| Skills & Plugins | Integrations→Skills + Integrations→Plugins (one section) |
| Usage | the whole /usage page as a section (keep the heatmap) |
| Archived chats | Settings→Archived chats |
| Setup | Settings→Setup |

Routes `/configure`, `/usage`, `/logs`, `/integrations` become redirects into
`/settings#<section>` (the repo already has this redirect pattern:
`configureSectionRedirect`). Net: **6 sidebar destinations → 3** (Status,
Models, Settings) beside the agent workspace, which correctly has no nav row.

### B. Cut list (owner decision menu)

| # | Cut | Why | Recommendation |
|---|---|---|---|
| 1 | **Google Workspace accounts** (Accounts tab, `google-account-*` ≈1.4K LOC frontend + `google-account.ts` runtime) | Broken-by-design (unverified-app wall on BYO client). Gmail/Calendar remain reachable the Cursor way: add a community MCP server with the user's own credentials. | **Cut now.** Keep the runtime code dormant only if a verified client is a realistic 2027 goal; otherwise delete. |
| 2 | **GitHub OAuth device flow** (`connector-oauth-drawer` device path + oauth-connectors device loop) | Three-step external registration dance to obtain what a PAT paste gives in 10 s; the token already lands in `GITHUB_PERSONAL_ACCESS_TOKEN`. | **Replace with a token field** on the MCP server row ("Paste a GitHub token — fine-grained, repo read"). Deletes the drawer's client-setup + device panels. |
| 3 | **Access tab** (model↔connector grants matrix) | A whole tab for an empty-by-default permissions matrix; grants are per-connector facts. | **Fold into each connector row** (an "allowed models" control on the row/drawer), default allow-all. Tab dies. |
| 4 | **Standalone Usage page** | Cursor treats usage as a settings section; ours is 4 tabs of analytics. | **Move under Settings→Usage** (A). No feature loss. |
| 5 | **/logs route** | Orphaned from nav; same `ServerContent` component is embedded in Configure→Server. | **Delete route**, keep the component in Server & Logs. |
| 6 | **Automations sidebar row** | Cursor has no automations surface; ours is agent-scoped already (`/agent/automations`). The feature is recent and working — this is a *placement* cut, not a feature cut. | **Remove the nav row**; reach it from the agent workspace (command palette + a link where automations attach). Feature stays. |
| 7 | (defer) Fun/experimental settings, appearance breadth | 22 KB of theme customization is the owner's own aesthetic system — explicitly not on the table. | Keep. |

Estimated deletion from 1–5: ~2.5–3K LOC frontend + the runtime Google/device
paths, two auth paradigms (BYO-client PKCE, device flow) reduced to two that
actually work unattended (API-key paste, provider PKCE where a client ships).

### C. Integrations → "Tools & MCP", one mental model

After B, every external capability is an **MCP server row**: name, run
command, credential (token paste or env), allowed models, state. The catalog
("start from a known configuration") stays as the quick path. This is exactly
Cursor's "Tools & MCPs" section shape, and it makes the GitHub row genuinely
click-to-connect-with-a-token.

### D. Design tokens (separate, optional wave)

Report 01 recovered Cursor's real token system (Glass): chrome `#141414` /
surface `#181818`, text `#F0F0F0` with 74/60/36 % opacity tiers, accent
`#599CE7`, font sizes 11/12/13/14 with weights 500/590, radii 4/12, the whole
conversation spacing scale (`--conversation-*`). Two constraints from the
owner's standing feedback: the dense hairline instrument-sheet dashboard
aesthetic stays, and sidebar density (13px rows) stays — both already agree
with Cursor's 13px base. Proposal: mint a **"Cursor Dark" theme** in the
existing theme system from these tokens (respecting the theme-token baseline
rule: every var defined for all themes), rather than restyling components.
Adopt the conversation spacing scale in the agent timeline if desired.

## Wave 3 — status

Owner sign-off (2026-08-26): restructure approved; cuts resolved as
**consolidate, don't delete**; theme approved. **LANDED** (278e61e6d):
one Settings page (14 sections — Access folded under Tools & MCP, Skills +
Plugins merged, Google accounts kept as a section), three-row sidebar
(Status / Models / Settings), old routes redirect, GitHub gains a
paste-a-token path (`PUT /api/agent/oauth/token` → grant store →
`GITHUB_PERSONAL_ACCESS_TOKEN` at spawn), and the Cursor Dark theme from the
extracted tokens. Google BYO-client OAuth remains available but is no longer
a top-level surface. Verified live in dev; all gates green.

## Original implementation order (for reference)

1. Settings unification shell (A) with redirects — pure moves, no deletions.
2. Cuts 3→5→4 (Access fold-in, /logs, Usage move) — low risk.
3. Cut 2 (GitHub token field) — replaces the drawer's device path.
4. Cut 1 (Google) — biggest deletion, do last.
5. Sidebar reduction + Automations row removal (6).
6. Optional: Cursor Dark theme (D).

Each step lands separately with gates green, same discipline as every wave
campaign in this repo.
