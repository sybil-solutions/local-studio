# Home Mission — "make it a home for people"

Overnight autonomous loop, started 2026-07-03. Branch: `loop/home-for-people`.
Guiding question at every step: **how can I make this a home for people?**

## Brief (from Sero, verbatim intent)
- Download, onboarding, setup, config — everything must be *perfectly simple*.
- Deploying a controller should be possible from the app.
- The app itself should have more polish (Hermes desktop is the cleanliness bar;
  every visual component can be refined — but keep the dense hairline
  instrument-sheet aesthetic, no card redesigns).
- Plugin system: Local Studio must reach email, X, Google, YouTube, GitHub, and
  all the user's computers. Simple, clean, reproducible, registry-compatible,
  pluggable.
- New `/site` module: product site, one-click download of the desktop app.
- Onboarding ships 3 preconfigured models — `qwen3.6-35b` (exo-cli/vLLM,
  Spark NVFP4), `lfm2.5`, `deepseek-v4-flash` — downloadable during onboarding.
  If the user has no configs, show these 3.
- All testing on the DGX Spark (`spark-2822`).

## Test bed
- `ssh spark-2822` (Tailscale, user sero, key ~/.ssh/dgx-spark-node). GB10,
  aarch64, 121GB unified, CUDA 13.
- Controller ALREADY RUNNING on Spark :8080 (`~/local-studio`, bun, healthy).
  Service file at `~/vllm-studio-controller.service` (not yet installed as unit).
- `~/exo-cli` — Sero's ollama-style CLI (bun, 742 LOC): `exo run qwen3.6-35b`
  etc. Engines: vLLM (:8000), llama.cpp (:8081). Models incl. qwen3.6-35b
  (NVFP4), step3.7-flash, qwen3.6-27b, gemma-4-31b. `~/models` has
  Qwen3.6-35B-A3B-NVFP4 already downloaded.
- `deepseek-v4-flash` = the model live on api.homelabai.org (remote preset).
- `lfm2.5` = LiquidAI LFM 2.5 small model — needs recipe + weights source
  (confirm exact HF repo before wiring).

## Workstreams (task list #1–#5)
1. **W1 zero-config onboarding** — 3 preconfigured models when no recipes
   exist; download + launch from the wizard. Existing code:
   `frontend/src/features/setup/` (~1.5k lines), controller
   `modules/models/recipes/`.
2. **W2 controller deploy from app** — SSH-based remote install (bun +
   controller sync + systemd user unit), then register controller in app.
3. **W3 connector plugins** — registry-compatible (MCP-style) manifest system;
   email/X/Google/YouTube/GitHub/computers. Prior art:
   `frontend/desktop/resources/` pi-extensions.
4. **W4 UI polish** — Hermes-grade refinement, keep instrument-sheet aesthetic.
   Hermes reference clone: scratchpad `hermes-agent/apps/desktop` (DESIGN.md).
5. **W5 /site** — product site module, one-click download.

## Ledger
| when | what | state |
|---|---|---|
| 2026-07-03 | Mission set up, branch cut, Spark recon done | done |
| 2026-07-03 | W1: starter presets (controller `/studio/presets` + wizard rail + remote-provider connect + first-run redirect) — d92024e4 | done, verified route live on Spark |
| 2026-07-03 | W1: LFM2.5 single-file GGUF download via allow_patterns verified on Spark (5.15 GB, resume-after-restart worked) | done |
| 2026-07-03 | W1: managed llama.cpp installer (source build w/ CUDACXX) — 50d5ceb7 + fix; build job running on Spark | in flight |
| 2026-07-03 | W5: /site build delegated (static instrument-sheet page) | in flight |
| 2026-07-03 | NOTE: GitHub releases have no installer assets — need desktop:dist upload for real one-click download | todo |
| 2026-07-03 | W1 VERIFIED E2E on Spark: managed llama.cpp CUDA build OK → lfm2-5 recipe → launch → real completion (clean content + reasoning_content). Remote provider create/delete verified. LFM2.5 left running on :8000 | done |
| 2026-07-03 | W5: /site committed (444 lines, self-contained, amber instrument sheet, OS-aware download) | done, assets pending |
| 2026-07-03 | W1 residue: wizard visual walkthrough in browser (do with W4 polish pass) | todo |
| 2026-07-03 | W2 DONE: install-controller.sh + desktop IPC + settings deploy panel — 7e4fdfaf. Verified live twice on Spark (:8090 ls-deploy-test, :8091 ls-deploy-test2, both systemd units healthy & remotely reachable). UI panel visual QA queued with W4 | done |
| 2026-07-03 | Spark state: LFM2.5 live :8000 (lfm2-5 recipe, main controller :8080); test controllers :8090/:8091 (throwaway dirs ls-deploy-test*, NOT deleted per no-wipe rule) | note |
| 2026-07-03 | W3 CORE DONE — 03f4b02d: MCP client (verified vs server-everything), ssh-remote server (verified vs Spark), connectors.json service+pool, pi bridge extension, API routes, Connectors settings section w/ verified catalog (github/google/gmail/x/computer npm pkgs all exist). Remaining: live pi-turn E2E (frontend rebuild in flight), visual QA w/ W4 | in flight |

## W3 design (decided 2026-07-03, implement exactly this)
Connector = MCP server entry. Schema mirrors de-facto mcp.json (Claude/Cursor
compatible) → registry-compatible + reproducible.
1. `<agent dataDir>/connectors.json` (0600, write-rename like
   settings-service.ts): `{ connectors: [{ id, name, transport: "stdio"|"http",
   command?, args?, env?, url?, headers?, enabled }] }`.
2. `services/agent-runtime/src/connectors-service.ts` — CRUD + masking (env
   values masked in views like maskApiKey); Next API routes
   `/api/agent/connectors` (GET/POST/PUT/DELETE) + `/api/agent/connectors/test`
   (connect → tools/list → {ok, toolCount, toolNames}).
3. Minimal MCP stdio+http client `services/agent-runtime/src/mcp-client.ts`
   (initialize / tools/list / tools/call; newline-delimited JSON-RPC for stdio,
   POST for streamable-http). No new deps.
4. Bridge extension `frontend/desktop/resources/pi-extensions/connectors.ts`:
   reads connectors.json path from env `LOCAL_STUDIO_CONNECTORS_PATH`, connects
   enabled servers, pi.registerTool per MCP tool as `<connectorId>_<tool>`
   (TypeBox schema from the MCP inputSchema via Type.Unsafe), execute proxies
   tools/call. Register in runtimeExtensionPaths + env injection
   (pi-runtime-helpers.ts:260,286) when any enabled connector exists.
   NOTE: extension runs inside agent-runtime process; reuse mcp-client via
   HTTP bridge to Next route `/api/agent/connectors/call` instead of importing
   (extensions are jiti-loaded standalone files — follow browser.ts pattern of
   fetch(FRONTEND_BASE)).
5. Built-in ssh computer connector: `frontend/desktop/resources/mcp/ssh-remote.mjs`
   stdio MCP server (env SSH_HOST) exposing run_command / read_file /
   write_file / list_dir over `ssh -o BatchMode=yes` (crib framing from
   sitegeist-relay.mjs). Catalog entry per machine.
6. Settings UI "Connectors" section (features/settings/connectors-section.tsx):
   list + enable/disable + add-from-catalog + custom; catalog: GitHub
   (`npx -y @modelcontextprotocol/server-github`, GITHUB_PERSONAL_ACCESS_TOKEN),
   Gmail/Google/YouTube/X entries (verify exact npm packages via web search
   before baking — placeholders must be real), Remote computer (ssh-remote.mjs,
   host field), Custom.
7. E2E verify headless with `npx -y @modelcontextprotocol/server-everything`
   + ssh-remote against spark-2822; then a live pi turn calling a connector tool.

## Rules
- Gates green before every commit (`npm run check` etc. per repo convention).
- Never wipe data; never kill the pop-os controller (kills live model).
- Verify on Spark after each meaningful change; check processes/files really run.
- Commit early, commit often on this branch; do not push without asking.
