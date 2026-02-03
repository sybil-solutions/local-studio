<!-- CRITICAL -->
# Possibility Roadmap (Prioritized)

1. Reliability Gate: Full CI + Deployment Smoke Suite
Why: We need confidence that controller, frontend, and OpenAI-compatible endpoints stay green for every release.
Scope: Add scripted checks for `/health`, `/v1/models`, `/v1/chat/completions` streaming, and `/chat` UI smoke; run in CI and on deploy.
Deliverables: Automated smoke script, CI workflow step, deploy-time checklist.
Success: Zero manual guesswork on deploy; failures block release.

2. OpenAI-Compat Contract Tests
Why: Compatibility is a core promise for external clients.
Scope: Contract tests for request/response shapes, tool-call parsing, streaming semantics, and error responses.
Deliverables: Test suite with golden responses; versioned fixtures.
Success: Any breaking change is caught in CI before merge.

3. Pi-Mono Runtime Unit Tests
Why: Agent loop is the core user experience; regressions are costly.
Scope: Unit tests for run-manager, tool-registry, message mapping, and tool execution persistence.
Deliverables: Coverage for tool call results, plan updates, run aborts.
Success: Deterministic tests for run lifecycle events and storage writes.

4. Frontend Stream State Simplification
Why: Chat UI logic is complex; maintenance cost is high.
Scope: Extract run stream handling into a dedicated hook and reduce `chat-page.tsx` responsibilities.
Deliverables: Refactored hooks + smaller ChatPage; no UI changes.
Success: Fewer regressions and faster feature work.

5. Backend Observability Pack
Why: Debugging inference, tool calls, and streaming is time-consuming without unified logs.
Scope: Add structured logging for run events, tool executions, and model routing decisions.
Deliverables: Logging schema + dashboards (Prometheus/Grafana if used).
Success: Can answer “what happened in this run” in under 2 minutes.

6. Model Routing Profiles
Why: Different models need different tool/streaming settings.
Scope: Formalize per-model settings (tool parser, UTF-8 fixes, reasoning flags) with defaults.
Deliverables: Declarative model profile config + validation.
Success: Fewer per-model hacks; safer additions.

7. Agent Files Inline Editor
Why: Agent file workflows are limited without editing in UI.
Scope: Add read/edit/save in Agent Files panel (no new storage model).
Deliverables: Editor view, autosave toggle, file size guardrails.
Success: Users can edit generated files without leaving the app.

8. RAG Integration Hardening
Why: RAG endpoint is optional but currently lightly verified.
Scope: Health checks, retries, better error surfacing in UI.
Deliverables: Health probe + user-visible status and errors.
Success: RAG failures are obvious and recoverable.

9. Release Automation
Why: Releases are manual and easy to drift.
Scope: Standardized release script, changelog validation, tag creation.
Deliverables: `scripts/release.sh` + CI guard.
Success: One command creates a consistent release.

10. Migration Cleanup (Legacy Removal)
Why: Legacy proxy/parser code increases cognitive load.
Scope: Remove or archive unused legacy logic, update docs.
Deliverables: Cleanup PR + docs update.
Success: Fewer files and clearer ownership of runtime paths.
