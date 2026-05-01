# PR Analysis — `feat/plop-t3code-with-pi`

Review date: 2026-04-30  
Repo: `/Users/sero/projects/vllm-studio`  
Scope: current local checkout compared to `origin/main` after `git fetch --prune origin`.

## 0. Review status

This branch was moving while the review was running. The latest local snapshot used for this report is:

```text
HEAD: 6d0cc905 micro: pin/rename/hide sessions + swap to solid icon set
branch: feat/plop-t3code-with-pi...origin/feat/plop-t3code-with-pi [ahead 11, behind 1]
worktree: clean except untracked droid-wiki/
```

The remote branch is not the same as the local checkout:

```text
origin/feat/plop-t3code-with-pi: 3fea087c Merge branch 'main' into feat/plop-t3code-with-pi
local ahead: 11 commits
local behind: 1 merge commit
```

So there are two PR realities:

| Scope | Diff vs `origin/main` |
|---|---:|
| Local checkout `HEAD` | `488 files changed, 33786 insertions(+), 43997 deletions(-)` |
| Remote branch `origin/feat/plop-t3code-with-pi` | `485 files changed, 31993 insertions(+), 43997 deletions(-)` |

All detailed findings below use the local `HEAD` snapshot because that is the working tree under review.

## 1. Executive summary

The PR is directionally good: it deletes substantially more than it adds, removes the old chat surface/module, and replaces route-owned chat orchestration with a Pi-backed `/agent` surface. Net change is approximately **10.2k fewer tracked LOC** before generated/untracked material.

The main merge blocker is not the size itself; it is **boundary hygiene**:

1. Frontend test suite is red in the new `chat-pane.test.ts`.
2. Root `package.json` now duplicates part of the frontend manifest while root `package-lock.json` still describes the old root package. This looks accidental.
3. The old `/chat` route was deleted, but setup still pushes users to `/chat?new=1`.
4. The new frontend agent surface has several large “god files” that mix transport, replay reducers, UI, localStorage migrations, browser bridge logic, and pane state.
5. Desktop/project persistence is split between two stores, which can diverge in packaged app flows.
6. Browser reader mode improves usability but has SSRF hardening gaps around DNS/redirect revalidation.
7. Security artifacts/tests were deleted without equivalent replacements.
8. `droid-wiki/` is untracked and book-sized; decide whether it is source material, report output, or noise before the PR is finalized.

The cleanest path is: fix the red test and package/setup regressions first, then take a simplification pass that extracts pure reducers/hooks and deletes/centralizes duplicate persistence.

## 2. Diff inventory

### 2.1 Top-level delta

```text
.factory     +0      -623    files=2    net=-623
.gitignore   +4      -0      files=1    net=+4
AGENTS.md    +10     -15     files=1    net=-5
MIGRATION.md +146    -0      files=1    net=+146
cli          +9      -2      files=2    net=+7
controller   +4119   -9863   files=165  net=-5744
frontend     +28643  -33342  files=305  net=-4699
package.json +18     -4      files=1    net=+14
plan.md      +340    -0      files=1    net=+340
scope.md     +463    -0      files=1    net=+463
shared       +34     -104    files=6    net=-70
```

### 2.2 File status counts

```text
A     65
D     290
M     83
R*    50 renamed files across similarity buckets
```

### 2.3 Largest churn files

| Churn | Add | Del | File |
|---:|---:|---:|---|
| 29,461 | 19,377 | 10,084 | `frontend/package-lock.json` |
| 1,720 | 1,720 | 0 | `frontend/src/app/agent/_components/chat-pane.tsx` |
| 1,041 | 1,041 | 0 | `frontend/src/app/agent/_components/agent-workspace.tsx` |
| 809 | 0 | 809 | `controller/src/modules/proxy/tool-call-core.ts` |
| 803 | 803 | 0 | `frontend/src/components/projects-nav-section.tsx` |
| 767 | 0 | 767 | `controller/src/modules/chat/store.ts` |
| 600 | 0 | 600 | `.factory/threat-model.md` |
| 579 | 579 | 0 | `controller/src/modules/engines/layers/engine-coordinator.ts` |
| 547 | 547 | 0 | `frontend/src/app/agent/_components/filesystem-panel.tsx` |
| 478 | 478 | 0 | `frontend/src/lib/agent/pi-runtime.ts` |
| 423 | 423 | 0 | `controller/src/modules/proxy/tool-call-stream.ts` |
| 369 | 369 | 0 | `frontend/src/app/agent/_components/agent-browser.tsx` |
| 328 | 328 | 0 | `controller/src/modules/engines/routes.ts` |
| 290 | 290 | 0 | `controller/src/modules/system/usage/pi-sessions.ts` |

### 2.4 Major deletion / replacement pattern

The PR deleted the old chat lane rather than layering the new agent lane on top:

```text
Deleted old chat files: 208 under frontend/src/app/chat*, controller/src/modules/chat
Added agent files: frontend/src/app/agent, frontend/src/app/api/agent, frontend/src/lib/agent
```

This is the strongest cleanliness pattern in the PR.

## 3. End-to-end flow

### 3.1 User-visible `/agent` flow

```text
/agent/page.tsx
  -> AgentWorkspace
      - loads models from /api/agent/models
      - loads project list from /api/agent/projects or desktop bridge
      - persists selected project, pane layout, computer panel, browser-tool toggle
      - owns split panes, per-pane tabs, active cwd, right Computer panel
      - renders ChatPane per pane

ChatPane
  - owns tab messages, optimistic user/assistant messages, attachments
  - replays Pi JSONL session events via /api/agent/sessions/:id
  - sends turns to /api/agent/turn
  - sends abort to /api/agent/abort
  - maps Pi events into text/thinking/tool blocks
  - supports steer/follow-up/abort keybindings

/api/agent/turn
  - validates message/model/session/cwd
  - gets PiRpcSession by runtime session id
  - ensureStarted(modelId, cwd, piSessionId, browserToolEnabled)
  - prompt/steer/follow_up
  - streams status + Pi events over SSE

frontend/src/lib/agent/pi-runtime.ts
  - discovers backend models from controller /v1/models
  - writes Pi models.json into agent dir
  - resolves cwd
  - spawns pi --mode rpc --provider vllm-studio --model vllm-studio/<model>
  - optionally resumes --session <piSessionId>
  - optionally loads browser extension

Pi session files
  - read by sessions-store.ts from ~/.pi/agent/sessions/<encoded-cwd>
  - summarized for sidebar/session replay
```

### 3.2 Computer/browser flow

```text
Pi browser extension
  -> POST /api/agent/browser/<verb>
      -> browserBridge.enqueue()
          -> renderer EventSource /api/agent/browser/events
              -> AgentWorkspace runBrowserCommand()
                  -> Electron webview commands or limited iframe fallback
              -> POST /api/agent/browser/result

Reader mode
  AgentBrowser
    -> GET /api/agent/browser/fetch?url=...
       -> sanitizeEmbeddedBrowserUrl()
       -> fetch public page
       -> strip scripts/styles/iframes/svg
       -> return readable text + links
```

### 3.3 Controller flow

```text
createAppContext()
  - config, logger, eventManager
  - stores: recipes/downloads/metrics/jobs
  - processManager, downloadManager
  - engineService = createEngineCoordinator(...)
  - jobManager

http/app.ts
  - registerSystemRoutes
  - registerEngineRoutes
  - registerModelsRoutes
  - registerStudioRoutes
  - registerAudioRoutes
  - registerJobsRoutes
  - registerAllProxyRoutes

engines/routes.ts
  - recipes CRUD
  - launch/cancel/evict/wait-ready
  - studio downloads
  - runtime config/info/upgrade endpoints

proxy/openai-routes.ts
  - /v1/chat/completions
  - model/session extraction
  - recipe matching and activation
  - provider routing
  - request normalization
  - upstream fetch
  - usage accounting
  - response normalization and tool-call streaming
```

## 4. Positive architectural patterns

1. **Delete-first replacement.** The old chat module and old `/chat` component tree are largely removed instead of kept as a parallel implementation.
2. **More cohesive controller directories.** `engines/`, `system/`, `models/`, and `proxy/` are clearer than the old lifecycle/monitoring/download split.
3. **Pi owns the agent loop.** The frontend server spawns Pi RPC rather than reimplementing a coding-agent loop in this repo.
4. **Selected-directory execution is first-class.** `cwd` travels through URL/project selection, `ChatPane`, `/api/agent/turn`, and `PiRpcSession.ensureStarted()`.
5. **Session replay uses Pi’s durable JSONL.** The app does not invent a separate canonical chat database for new agent sessions.
6. **Tests were added for the new seams.** New tests cover engine coordinator/routes, proxy request normalization, Pi usage aggregation, model normalization, model lifecycle hook, usage normalization, and chat replay.
7. **Local verification path is faster.** The repo’s agent instructions point to `localhost:3001/agent` rather than Docker staging for every iteration.

## 5. Merge blockers / correctness risks

### P0. Frontend test suite is red

Command run:

```text
cd frontend && npm test -- --run src/app/agent/_components/chat-pane.test.ts
```

Result:

```text
1 failed: replaySessionEvents > hydrates current Pi message events from stored sessions
Expected tool block omitted args/argsText; received block includes args and argsText.
```

This looks like a stale test expectation after the tool-args streaming work, but it still blocks a clean merge. Fix the expectation or adjust replay output if the new fields should not be public UI state.

### P0. Root `package.json` is probably accidental

Root `package.json` changed from root tooling:

```json
{"devDependencies":{"knip":"^6.4.1"}}
```

to a partial copy of the frontend package:

```json
{
  "name": "frontend",
  "version": "0.2.1",
  "private": true,
  "dependencies": { ... },
  "main": "desktop/dist/main.js"
}
```

But root `package-lock.json` still describes the old root package:

```text
package-lock.json root: devDependencies { knip: ^6.4.1 }
frontend/package-lock.json root: real frontend deps including @mariozechner/pi-coding-agent, highlight.js, react-markdown, rehype-highlight, remark-gfm
```

This is a high-signal cleanliness issue and can confuse installs, audit, CI, and desktop build assumptions. Revert root `package.json` or intentionally regenerate root lock if the repo is becoming a workspace.

### P0. Setup still routes to deleted `/chat`

`frontend/src/app/setup/hooks/use-setup.ts` still contains:

```text
router.push("/chat?new=1")
```

The old chat app was deleted. This should route to `/agent?new=1` or be renamed at the setup UI boundary. Also update user-facing labels from “Open Chat” if the intended product surface is Agent.

### P0. Local branch is behind remote

The branch is `ahead 11, behind 1`. Before merge, reconcile the remote merge commit with the local microcommits and regenerate the final diff stats.

### P0. Decide `droid-wiki/`

`droid-wiki/` is untracked and about 740K / many markdown files. It looks like generated review/wiki material. It should not accidentally enter the PR. If useful, collapse it into one curated report or keep it outside tracked source.

## 6. Frontend `/agent` analysis

### 6.1 `chat-pane.tsx` is doing too much

Current size: **1,720 lines**.

Responsibilities inside one file:

- data types for messages, tabs, tool blocks, attachments
- file attachment encoding and prompt construction
- Pi session event replay reducer
- live Pi event reducer
- SSE turn submission
- steer/follow-up/abort control messages
- optimistic message creation
- keyboard behavior
- tab bar and tab pill UI
- timeline rendering
- markdown rendering handoff
- tool block rendering and file preview extraction

This is hard to test and high-risk for future changes. The pure parts are already visible and should be extracted first:

| Extract | Suggested file | Why |
|---|---|---|
| Message/session/tool types | `frontend/src/lib/agent/chat-types.ts` | Shared by reducer, test, UI |
| Replay reducer | `frontend/src/lib/agent/replay-session-events.ts` | Pure testable unit; current red test belongs here |
| Live Pi event reducer | `frontend/src/lib/agent/pi-event-reducer.ts` | Separates protocol changes from React rendering |
| Turn sender hook | `frontend/src/app/agent/_hooks/use-agent-turn.ts` | Isolates SSE, abort, steer/follow-up |
| Attachment hook/helpers | `frontend/src/app/agent/_hooks/use-attachments.ts` | Removes FileReader/UI coupling |
| Session tabs | `session-tabs-bar.tsx` | Keeps tabs from dragging the chat file upward |
| Timeline/tool UI | `timeline-message.tsx`, `tool-block-view.tsx` | Pure render components |

Expected outcome: similar functionality, lower risk, probably **150-300 LOC net reduction** through duplicate branch removal and simpler tests. Even if net LOC does not shrink immediately, review surface drops sharply.

### 6.2 `agent-workspace.tsx` is also a god component

Current size: **1,041 lines**.

Responsibilities inside one file:

- model loading
- project loading and selection
- pane layout persistence
- active sessions event broadcasting to sidebar
- browser command bridge
- browser URL/file-path normalization
- right panel layout/resize
- localStorage migrations
- URL query consumption
- split-pane CRUD
- Computer panel rendering

Suggested split:

| Extract | Suggested file |
|---|---|
| Project bootstrap and selected project persistence | `use-agent-projects.ts` |
| Pane layout state and localStorage | `use-agent-pane-layout.ts` |
| Browser tool toggle + command EventSource | `use-browser-bridge.ts` |
| Browser URL normalization | `browser-url.ts` |
| Right Computer panel | `computer-panel.tsx` |
| Model loading/selection | `use-agent-models.ts` |

Expected outcome: **100-200 LOC net reduction** and fewer accidental regressions when changing browser/pane/project behavior.

### 6.3 `projects-nav-section.tsx` is becoming a second session manager

Current size: **803 lines**.

It now owns:

- project list UI
- active agent session list
- recent session list
- pinned/hidden/renamed session preferences in localStorage
- drag/drop session handling
- project add/remove controls

The pinned/hidden/rename preference logic is useful, but it should not live in the sidebar component. Move it to a small store/hook such as:

```text
frontend/src/lib/agent/session-prefs.ts
frontend/src/hooks/use-agent-session-prefs.ts
```

This also lets `ChatPane`/`AgentWorkspace` reuse titles and avoids custom browser events spread through UI files.

### 6.4 LocalStorage migration sprawl

There are many hardcoded keys across agent components:

- browser tool enabled/default-off migration
- computer panel open/files/browser/default-closed migration
- pane layout
- selected project
- session prefs
- show hidden sessions

Centralize keys and migrations in one module:

```text
frontend/src/lib/agent/preferences.ts
```

Expected outcome: small LOC reduction, much cleaner failure behavior, easier deletion of one-time migrations later.

### 6.5 Setup still assumes chat

This is both product copy drift and a real broken route after deleting `/chat`. Fix before merge.

## 7. Agent runtime/API analysis

### 7.1 Good seam: Pi runtime manager

`frontend/src/lib/agent/pi-runtime.ts` provides a clear server-side boundary:

- normalizes backend URL
- fetches controller `/v1/models`
- writes Pi `models.json`
- resolves cwd safely enough for local filesystem execution
- spawns and manages one `PiRpcSession` per runtime session key

This is a good architecture decision: the app delegates agent behavior to Pi and keeps this repo focused on UI, persistence, and provider/config bridging.

### 7.2 Risk: process lifetime is tied to Next server lifetime

`piRuntimeManager` is global in the Next server process. That is fine for local dev and packaged Electron, but it means:

- reloads/restarts lose in-memory runtime sessions;
- existing Pi child cleanup depends on process lifecycle;
- multiple Next instances would not share runtime state;
- concurrent tabs are isolated only by generated runtime IDs.

This is acceptable for current local app scope, but the reportable boundary should stay explicit.

### 7.3 CWD/project selection can diverge in desktop

There are two project stores:

```text
frontend/src/lib/agent/projects-store.ts        -> ../data/agentfs/projects.json
frontend/desktop/logic/projects-store.ts       -> app.getPath("userData")/projects.json
```

The stores are similar but not identical. Desktop can persist projects in Electron userData while the Next server code also has its own `data/agentfs` path unless all paths are routed through API/bridge consistently.

Recommendation: one project-store implementation with a base path adapter:

```text
createProjectsStore({ baseDir })
```

Then reuse it from both Electron main and Next route handlers.

Expected outcome: **80-150 LOC deleted** plus fewer packaged-app cwd bugs.

### 7.4 Agent API route files are thin, which is good

The route files under `frontend/src/app/api/agent/*` are generally small and route-shaped. Preserve that. Do not move Pi process orchestration into route handlers.

## 8. Browser / desktop / security analysis

### 8.1 Electron hardening partially preserved

`frontend/desktop/logic/window-manager.ts` keeps:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
webSecurity: true
allowRunningInsecureContent: false
navigateOnDragDrop: false
webviewTag: true
```

`frontend/desktop/logic/security.ts` strips webview preload and forces guest preferences:

```text
nodeIntegration = false
contextIsolation = true
sandbox = true
```

That preserves the important desktop AGENTS.md constraints.

### 8.2 Webview/browser bridge still needs explicit policy

The PR enables `webviewTag: true` and the rendered webview uses `allowpopups="true"`. The app hardens popup/navigation behavior, but there is no obvious central policy for which destinations a webview may visit. That may be intentional for an agent browser, but it should be stated and tested.

Recommended additions:

- test that webview preferences cannot be weakened;
- test that app-window navigation stays origin-locked;
- decide whether webview popups should be denied rather than allowed;
- add a browser-tool enabled nonce so only the active renderer can answer `/api/agent/browser/events` commands.

### 8.3 Reader-mode SSRF hardening is incomplete

`frontend/src/app/api/agent/browser/fetch/route.ts` delegates to `sanitizeEmbeddedBrowserUrl()`, which blocks:

- non-http(s)
- localhost / `.localhost` / `.local`
- literal private IPv4 ranges
- basic literal IPv6 local/private ranges

Gaps:

- public hostnames that resolve to private IPs are not blocked;
- redirects are followed automatically and final URL/IP is not revalidated;
- DNS rebinding is not addressed;
- unusual IP encodings are only partially covered by the URL parser/hostname path.

Recommendation: resolve DNS before fetch, reject private/loopback/link-local ranges after resolution, set `redirect: "manual"`, and revalidate every redirect hop before following.

### 8.4 Deleted security docs/tests need replacement

Deleted:

```text
.factory/threat-model.md
.factory/security-config.json
controller/src/http/security-middleware.test.ts
```

If `.factory` artifacts are being removed intentionally, move the current threat model into `docs/security/` or explicitly replace it with a leaner security note. More importantly, restore/replace the security middleware tests if the middleware still exists.

### 8.5 Entitlements should be justified

`frontend/desktop/resources/entitlements.mac.plist` includes:

```text
com.apple.security.cs.disable-library-validation = true
```

This may be needed for Electron/native dependencies, but it is a risk-bearing entitlement. Document why it is required and test the signed app path if it remains.

## 9. Controller/backend analysis

### 9.1 Strong improvements

The controller refactor deletes old directories and creates clearer module seams:

- `downloads/` absorbed by `engines/layers/*`
- `lifecycle/*` absorbed by `engines/`, `system/`, and `models/`
- `monitoring/` moved into `system/`
- monolithic `tool-call-core.ts` split into parser/normalizer/reasoning/streaming pieces

This is a real reduction in conceptual overhead.

### 9.2 `AppContext` is still a broad bag

`controller/src/types/context.ts` still exposes:

```text
launchState
processManager
downloadManager
engineService
jobManager
stores.recipeStore/downloadStore/metrics/jobStore
```

`MIGRATION.md` says `processManager` and `downloadManager` remain for backward compatibility. That is a legitimate bridge, but it means the refactor has not fully reached the intended `EngineService` boundary.

Recommendation:

1. Search consumers of `processManager`, `downloadManager`, and `launchState`.
2. Move remaining lifecycle/download calls behind `engineService` or a narrow query adapter.
3. Remove these from `AppContext` once no route requires them directly.

Expected outcome: lower coupling more than raw LOC, but likely **100-250 LOC** of adapter/legacy code can disappear after migration.

### 9.3 `engines/routes.ts` mixes too many route families

Current file: **327 lines**.

It owns:

- recipes CRUD
- launch/cancel/evict/wait-ready
- downloads
- runtime config/info
- runtime upgrade routes

Split by route family:

```text
engines/routes/recipes-routes.ts
engines/routes/lifecycle-routes.ts
engines/routes/download-routes.ts
engines/routes/runtime-routes.ts
```

No functional rewrite needed; just route-family files registered by `engines/routes.ts`.

### 9.4 `openai-routes.ts` is still route-owned orchestration

Current file: **385 lines**.

It owns:

- session ID extraction
- usage attachment
- recipe matching
- active recipe detection/activation
- provider routing
- request rewrite
- upstream fetch
- lifetime usage accounting
- response normalization
- stream transformation

Suggested split:

```text
proxy/session-id.ts
proxy/model-routing.ts
proxy/activation-policy.ts
proxy/usage-accounting.ts
proxy/response-normalizers.ts
```

This aligns with the prior canonical-controller target: route handlers should adapt HTTP; service/reconciler code should own behavior.

### 9.5 Usage is preserved but fragmented

`/usage` merges:

- current controller DB
- legacy `chats.db`
- Pi JSONL sessions

This is a good compatibility move. But `controller/src/modules/system/usage/chat-database.ts` is **531 lines** and Pi usage is **290 lines**. After one migration window, make the legacy chat DB reader an explicit compatibility adapter or migration script instead of a permanent core `/usage` dependency.

### 9.6 Orphan chat DTOs remain

`controller/src/types/chat.ts` still defines chat/session DTOs even though the controller chat module was deleted. `rg` did not show active controller imports. Verify and delete if unused.

## 10. Tests and verification

### 10.1 Commands run during this review

| Command | Result |
|---|---|
| `cd frontend && npm test -- --run src/app/agent/_components/chat-pane.test.ts` | **FAIL** — stale/new args fields mismatch |
| `cd frontend && npx tsc --noEmit` | **PASS** |
| `cd controller && ~/.bun/bin/bun test && ~/.bun/bin/bun run typecheck` | **PASS** — 100 tests |

`npx next build` and desktop packaging were not run because this was an analysis/report task, not feature completion or deployment.

### 10.2 Added tests

New tests include:

```text
controller/src/modules/engines/layers/engine-coordinator.test.ts
controller/src/modules/engines/routes.test.ts
controller/src/modules/proxy/openai-routes.test.ts
controller/src/modules/system/usage/chat-database.test.ts
controller/src/modules/system/usage/pi-sessions.test.ts
frontend/src/app/agent/_components/chat-pane.test.ts
frontend/src/app/usage/lib/normalize-usage-stats.test.ts
frontend/src/hooks/use-model-lifecycle.test.ts
frontend/src/lib/agent/models.test.ts
```

### 10.3 Deleted test coverage

Notable deletions:

```text
controller/src/http/security-middleware.test.ts
controller/src/modules/chat/** tests
controller/src/modules/lifecycle/** tests
frontend/src/app/chat/** tests
frontend/src/lib/systems/run-machine/run-machine.test.ts
frontend/src/lib/systems/tools/tool-tracker.test.ts
frontend/tests/chat-agent-files-proof.spec.ts
frontend/tests/discover-quant-vram-proof.spec.ts
frontend/tests/rocm-dashboard-platform.spec.ts
frontend/tests/voice-call-mode-proof.spec.ts
```

Some deletions are appropriate because their modules were deleted. The gaps to replace are:

1. `/agent` selected-directory Pi proof.
2. session replay/resume from sidebar.
3. split pane + per-tab Pi runtime isolation.
4. browser tool command loop in Electron.
5. reader-mode fetch security tests.
6. filesystem panel file read/write/comment flow.
7. desktop project picker persistence.
8. setup flow route to `/agent`.
9. controller security middleware behavior.

## 11. Documentation/package hygiene

### 11.1 `MIGRATION.md` is useful but partly stale

It says Phase 4 chat module extraction was completed, but the current PR later deletes `controller/src/modules/chat/` entirely. It also contains old verification counts such as `113/114` and `175/179`, while current controller tests are `100/100`.

Keep the migration doc, but update it to final PR reality:

- Phase 4 should say “chat module removed/replaced by Pi `/agent` flow,” not only extracted.
- Verification should reflect current commands.
- Any remaining compatibility bridges should be listed as TODOs, not “done.”

### 11.2 `scope.md` and `plan.md` are large but useful

They add 803 lines combined. That is acceptable if they are living planning docs, but keep them anchored to current implementation. If they are just scratch planning, move to `docs/` or condense before merge.

### 11.3 `frontend/package-lock.json` dominates the PR

The lockfile churn is expected if dependencies were added, but it accounts for almost the entire insertion side of the PR. Verify it was generated from `frontend/package.json` only. Do not mix root and frontend package installation state.

## 12. High-ROI simplification / LOC-reduction plan

### Immediate blockers / tiny deletes

| Priority | Action | Impact |
|---|---|---:|
| P0 | Fix `chat-pane.test.ts` expected tool block or replay output | unblock tests |
| P0 | Revert/fix root `package.json` mismatch | small LOC, high cleanliness |
| P0 | Change setup `router.push("/chat?new=1")` to `/agent?new=1` | correctness |
| P0 | Decide and exclude/condense `droid-wiki/` | prevents noisy accidental add |
| P0 | Reconcile local branch with remote merge commit | accurate PR diff |

### Simplification pass 1: frontend reducers/hooks

| Area | Action | Estimated effect |
|---|---|---:|
| `chat-pane.tsx` | Extract replay reducer + live Pi reducer + turn hook | -150 to -300 LOC / lower risk |
| `agent-workspace.tsx` | Extract projects, pane layout, browser bridge, model loading hooks | -100 to -200 LOC / lower risk |
| `projects-nav-section.tsx` | Extract session prefs store/hook | -50 to -100 LOC / reusable prefs |
| agent preferences | Centralize localStorage keys and one-time migrations | -20 to -80 LOC / less sprawl |

### Simplification pass 2: duplicate persistence and docs

| Area | Action | Estimated effect |
|---|---|---:|
| project stores | Create one project store with base path adapter | -80 to -150 LOC |
| root package | Remove duplicate frontend manifest | -14 LOC + avoid tooling bugs |
| docs | Update MIGRATION and collapse scratch docs if needed | not necessarily LOC, better truth |
| chat DTOs | Delete `controller/src/types/chat.ts` if unused | -120 LOC approx |

### Simplification pass 3: backend boundaries

| Area | Action | Estimated effect |
|---|---|---:|
| `AppContext` | Remove `processManager`, `downloadManager`, `launchState` direct exposure after migration | -100 to -250 LOC and lower coupling |
| `engines/routes.ts` | Split by route family | no net LOC necessarily; better reviewability |
| `openai-routes.ts` | Extract routing/activation/usage/session helpers | small net LOC; much cleaner behavior tests |
| usage | Move legacy chat DB reader behind migration/adapter | future deletion opportunity |

### Simplification pass 4: security and E2E proofs

| Area | Action | Impact |
|---|---|---|
| reader fetch | DNS + redirect revalidation for SSRF | security correctness |
| browser bridge | per-renderer nonce/session binding | limits local cross-talk |
| Electron webview | tests for hardened prefs and navigation policy | prevents regressions |
| setup/agent | Playwright or browser-use proof for selected cwd + Pi session | protects core flow |

## 13. Recommended merge gate

Do not merge until these are true:

1. `git status` contains no accidental untracked generated report directory.
2. Local branch is reconciled with `origin/feat/plop-t3code-with-pi`.
3. `frontend` targeted/full test suite is green.
4. `frontend` typecheck remains green.
5. `controller` tests/typecheck remain green.
6. Root package manifest is intentional and lockfile-consistent.
7. Setup route no longer points to deleted `/chat`.
8. Security middleware coverage is restored or replacement tests/docs are added.
9. One local browser proof of `http://localhost:3001/agent` selected-directory Pi execution is captured after the final rebase/merge.
10. If this is being shipped to desktop, run `cd frontend && npm run desktop:dist` and replace `/Applications/vLLM Studio.app` per AGENTS.md.

## 14. Bottom line

This PR is a strong net-delete refactor with the right product direction: old chat out, Pi-backed `/agent` in, controller modules clearer. The risk is that the replacement surface accumulated complexity quickly in a few large frontend files and a few compatibility bridges.

The first merge pass should be narrow and mechanical: red test, package mismatch, `/chat` route, branch sync, untracked report cleanup. The second pass should be extraction/deletion-focused: reducers/hooks, single project store, narrower controller context, security tests.
