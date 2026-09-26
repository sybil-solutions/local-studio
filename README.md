# Local Studio

A small controller that finds, launches and stops local models, serves one gateway for OpenAI Chat Completions, OpenAI Responses and Anthropic Messages, records per-request metrics, and links to other controllers. A read-mostly web UI and a thin Electron shell sit on top of it.

- Design contract: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Layout

| Path | Owner | Contents |
|---|---|---|
| `packages/contracts` | scaffold | shared types, zod request bodies, `ROUTES`, formulas, `fmt` |
| `controller/src/{main,app,context}.ts`, `controller/src/core` | scaffold | CLI, composition root, service interfaces, config, db, auth, keys, bus, SSE, exec |
| `controller/src/discovery` | discovery | GPUs, docker, processes, ports, probe, groups, launch/stop/logs |
| `controller/src/gateway`, `controller/src/metrics` | gateway-metrics | `/v1/*` dialects, request store, engine scraper, rollups |
| `controller/src/recipes` | recipes | registry catalog, fit, LaunchPlan, export, registry PR |
| `controller/src/agents`, `controller/src/federation` | agents-federation | workspaces, harness launch, dsh; peers, passthrough, fleet |
| `controller/src/deploy`, `desktop`, `scripts` | deploy-desktop | `local-studio deploy`, release build, Electron shell |
| `ui` | ui | Vite + React SPA |

## Commands

Requires Bun 1.3+.

```sh
bun install                       # workspace install
bun run typecheck                 # tsc across every workspace
bun run build:ui                  # ui/dist, served by the controller at /
bun run serve                     # controller on http://127.0.0.1:8080
bun controller/src/main.ts serve --port 18090 --home /tmp/ls-home --read-only
bun controller/src/main.ts key print-admin   # admin key for non-loopback clients
bun run build:bin                 # dist/local-studio single binary
```

Configuration comes from flags or `LOCAL_STUDIO_*` env (`HOME`, `DATA_DIR`, `HOST`, `PORT`, `MODELS_DIR`, `REGISTRY_DIR`, `READ_ONLY`, `NAME`, `SCAN_PORTS`, `WATCHDOGS`, `API_KEY`, `PUBLIC_URL`, `UI_DIR`). The default home is `~/.local-studio`.

## Releases

Every push to `main` that passes CI runs `.github/workflows/release.yml`. semantic-release (`release.config.cjs`) reads the conventional commits since the last tag and computes the next version (`feat` minor, breaking major, other types patch); that version is the only release version. It is injected into the controller binaries (`LOCAL_STUDIO_VERSION`), the Electron app (`extraMetadata.version`, so `Info.plist`, updater metadata and asset names) and the tag. The macOS job runs in the `release-signing` environment and signs and notarizes when the Apple secrets are present. The final job rechecks that the commit is still `origin/main`, then semantic-release tags it and publishes the GitHub release with the controller tarballs, `Local-Studio-<ver>-mac-arm64.{dmg,zip}`, the stable `Local-Studio-arm64.dmg` alias, `Local-Studio-<ver>-linux-x86_64.AppImage`, `latest-mac.yml`, `latest-linux.yml`, blockmaps, `SHA256SUMS` and `Local-Studio-release.json`. Nothing is deployed elsewhere: the controller serves the UI.

## Rules

No `max_tokens` or thinking caps anywhere, no `--enforce-eager`, no disabled CUDA graphs. Every ssh, docker and network call carries a hard timeout (`core/exec.ts`). Never stop or restart models on a live machine without the owner. No automated test suites: verify against the live system (`docs/ARCHITECTURE.md` §15).
