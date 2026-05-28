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
- Entry point: `src/lib/agent/pi-runtime.ts` exposes `piRuntimeManager.getSession(sessionId)` returning a `PiAgentSession` (interface in `pi-runtime-types.ts`). The implementation is `PiSdkSession` in `pi-sdk-runtime.ts`.
- Extensions (browser/parchi/canvas/timeouts/mcp-plugin) and skills are loaded via `buildAgentSessionOptions` in `pi-runtime-helpers.ts`. Extensions are dynamically imported as ESM (`pathToFileURL`); skills are passed as filesystem paths through `resourceLoaderOptions`.
- Agent directory is `<dataDir>/pi-agent` (`refreshPiModels` writes `models.json` there, the SDK colocates `auth.json` and `settings.json`). Do not point the runtime at the user's `~/.pi/agent`.
- Resume: when the API route passes a `piSessionId`, `PiSdkSession.ensureStarted` locates the JSONL via `findSessionFile(cwd, id)` and calls `sessionManager.setSessionFile(...)` before constructing the runtime. `sessionStartEvent.reason` reflects whether the file was found (`"resume"` vs `"startup"`).
- Do not reintroduce the legacy RPC subprocess, `pi-binary.ts`, `buildPiLaunchPlan`, or the `desktop:prepare-pi` script.

### Pi packages marketplace

- Install/list/uninstall/update Pi packages (extensions, skills, prompts,
  themes) via `GET/POST /api/agent/extensions[/install|/uninstall|/update]`,
  which wrap the SDK's `DefaultPackageManager` against `<agentDir>` and persist
  to `<agentDir>/settings.json`.
- Per-package on/off (without uninstalling) lives in
  `<agentDir>/extension-config/enabled.json`. The runtime applies these as a
  `resourceLoaderOptions.extensionsOverride` filter so disabled extensions
  load (errors still surface) but never contribute tools/handlers to the
  active session. Toggle via `POST /api/agent/extensions/enable`.
- Per-package JSON config lives in
  `<agentDir>/extension-config/<sanitizedKey>.json` and is read/written via
  `GET|POST /api/agent/extensions/configure`.
- Runtime fingerprint (`pluginFingerprint` in `pi-runtime-helpers.ts`) includes
  the disabled-overrides set and a mtime-based `piPackagesToken` for
  `<agentDir>/settings.json`. Installing, uninstalling, updating, or toggling
  a package invalidates the cached `PiSdkSession` runtime so the next call to
  `getSession()` reloads with the new resource set.
- Dev-mode caveat: Next.js HMR can retain stale module bindings for the
  singleton `piRuntimeManager`. After installing or toggling an extension,
  the UI panel refreshes immediately, but for the runtime filter to re-run
  you may need to abort the in-flight turn (or start a new chat / restart
  `npm run dev`). Production builds do not exhibit this caching behaviour.

### Auto-discovered extensions

- The SDK's package manager auto-discovers extension entries placed in
  `<agentDir>/extensions/` (currently `<dataDir>/pi-agent/extensions/`) and
  `<cwd>/.pi/extensions/`. Drop a `.ts` / `.js` file or a directory containing
  `package.json` (with a `pi` manifest) or `index.ts` there and it is picked up
  on the next session start — no settings edit required.
- Built-in extensions registered via `buildAgentSessionOptions` (browser,
  parchi, canvas, timeouts, mcp-plugin) are still passed explicitly through
  `additionalExtensionPaths`; auto-discovery is purely additive for user files.
- Load failures are captured into `piResourceDiagnostics()` (see
  `pi-sdk-runtime.ts`) and surfaced via `GET /api/agent/setup-checks` as the
  `diagnostics` field. Check that endpoint when a drop-in extension does not
  appear active.
