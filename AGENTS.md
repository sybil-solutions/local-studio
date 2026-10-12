# AGENTS.md

Local Studio is a local-first workstation whose Bun/Hono controller and Next.js/Electron frontend share one controller API for model lifecycle, serving, system state, settings, usage, and agent sessions.
Work decisively without asking questions during execution, preserve user changes, never expose credentials, never use `disable cuda graphs`, `enforce eager`, or `max_tokens` with vLLM or SGLang, and leave no code comments in touched code.
Keep code composable and typed, use Effect for async and streaming, use the shared UI kit and design tokens, validate boundary data with Effect Schema, and keep contracts defined once in `controller/contracts/` or `shared/agent/` as appropriate.

NEVER WRITE TESTS. Do not add or restore unit, integration, end-to-end, snapshot, browser, smoke, or any other automated test code.

Branch from the current `origin/dev`, keep one owner and one scoped pull request per branch, target `dev`, and never push directly to `dev` or `main`.

semantic-release's computed version is the authority for stable desktop releases. The release workflow injects that exact version into Electron package metadata, signing, staging, updater metadata, and versioned asset names before publishing the tag and GitHub release. Checked-in versions for the root app, frontend, controller, controller contracts, and agent runtime are synchronized development fallbacks for local and dev builds; they do not predict or define the next stable release. `shared/package.json` intentionally remains independently versioned at `0.0.0` and is not a desktop release version source.

Run `npm run check` before handoff. It is `node scripts/project.mjs check` — every gate CI runs (repo layout/contracts/structure, controller, agent-runtime tests, frontend quality including the production build) in one command. Never bypass git hooks.
Repo automation lives in `frontend/desktop/automation/*.mjs` as plain readable modules; `scripts/project.mjs` (a symlink to `frontend/desktop/project.mjs`) only dispatches. Edit the module, not the entry.
Commit conventionally as you go. CI builds and packages the desktop app on every run, so rebuild and reinstall locally only when you need to verify something by hand — use `scripts/install-desktop-app.sh [stable|dev]`, never a hand-rolled backup copy.
Use the documented local, remote, deployment, and agent-runtime workflows in the repository, keep secrets in ignored `.env.local`, and treat the live browser, controller, installed app, or deployed domain as the acceptance target for visible behavior.
