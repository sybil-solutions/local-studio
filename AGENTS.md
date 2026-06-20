# AGENTS.md

Local Studio is a local-first workstation whose Bun/Hono controller and Next.js/Electron frontend share one controller API for model lifecycle, serving, system state, settings, usage, and agent sessions.
Work decisively without asking questions during execution, preserve user changes, never expose credentials, never use `disable cuda graphs`, `enforce eager`, or `max_tokens` with vLLM or SGLang, and leave no code comments in touched code.
Keep code composable and typed, use Effect for async and streaming, use the shared UI kit and design tokens, validate boundary data with Effect Schema, and keep contracts defined once in `controller/contracts/` or `shared/agent/` as appropriate.
Before handoff run `npm --prefix frontend run check:quality`, `npm run check`, `npm --prefix frontend run test`, and `npm run test:integration` when relevant, and never bypass git hooks.
Every file-changing turn must make one conventional microcommit, while frontend changes must also rebuild and reinstall `/Applications/Local Studio.app` with `desktop:dist`, relaunch it, and confirm `GET /api/desktop-health` returns 200.
Use the documented local, remote, deployment, and agent-runtime workflows in the repository, keep secrets in ignored `.env.local`, and treat the live browser, controller, installed app, or deployed domain as the acceptance target for visible behavior.
Treat semantic-release's computed version as the source of truth for stable desktop releases, apply it to package metadata in the release workspace, and keep checked-in package versions as development fallbacks.
