# AGENTS.md (frontend addendum)

This addendum introduces commit hygiene rules for agent execution.

## Microcommits (Required)

- On every agent turn that changes files, create a microcommit before handoff.
- Keep each microcommit to one logical change (small, auditable diff).
- Stage only files changed in that turn.
- If a turn has no file changes, do not create an empty commit.

### Required turn-close flow

1. `git add <files-changed-this-turn>`
2. Run pre-commit checks against staged files: `npm run precommit`
3. If checks fail, fix issues and rerun checks.
4. Commit: `git commit -m "micro: <concise change summary>"`
5. Report commit SHA and hook/check output in the handoff.

### Guardrails

- Never bypass hooks with `--no-verify`.
- Never batch unrelated work into one commit.
- If blocked by failing hooks you cannot safely fix in-turn, stop and report the blocker with logs.

## Pi runtime

- The agent page uses the `@earendil-works/pi-coding-agent` SDK directly in the Next.js Node process. There is no `pi --mode rpc` subprocess and no bundled CLI.
- Entry point: `src/features/agent/pi-runtime.ts` exposes `piRuntimeManager.getSession(sessionId)` returning a `PiAgentSession` (interface in `src/features/agent/pi-runtime-types.ts`). The implementation is `PiSdkSession`, defined in the same `pi-runtime.ts` file.
- Extensions (browser/sitegeist/canvas/timeouts/mcp-plugin) and skills are loaded via `buildAgentSessionOptions` in `src/features/agent/pi-runtime-helpers.ts`. Extensions are dynamically imported as ESM (`pathToFileURL`); skills are passed as filesystem paths through `resourceLoaderOptions`.
- Agent directory is `<dataDir>/pi-agent` (`refreshPiModels` writes `models.json` there, the SDK colocates `auth.json` and `settings.json`). Do not point the runtime at the user's `~/.pi/agent`.
- Resume: when the API route passes a `piSessionId`, `PiSdkSession.ensureStarted` locates the JSONL via `findSessionFile(cwd, id)` and calls `sessionManager.setSessionFile(...)` before constructing the runtime. `sessionStartEvent.reason` reflects whether the file was found (`"resume"` vs `"startup"`).
- Do not reintroduce the legacy RPC subprocess, `pi-binary.ts`, `buildPiLaunchPlan`, or the `desktop:prepare-pi` script.

### Plugin policy

- The app's user-facing plugin surface is MCP-only. Do not reintroduce the old
  Pi package marketplace, `/api/agent/extensions/*` routes, chrome/CDP bridge,
  or computer-use shim.
- `PiSdkSession` sets `resourceLoaderOptions.noExtensions = true`; only
  first-party extension paths returned by `buildAgentSessionOptions` are loaded
  through `additionalExtensionPaths`.
- MCP servers are selected through `/api/mcp/servers`, discovered from the
  local MCP store, and bridged by `desktop/resources/pi-extensions/mcp-plugin.ts`.
  Keep new tool integrations behind that MCP store/settings path.
