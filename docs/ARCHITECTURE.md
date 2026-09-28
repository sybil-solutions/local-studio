# Local Studio: architecture

Local Studio runs local models on a fleet of machines and proves that every configuration it runs works. One binary serves the controller, the web UI and the command line. The recipe registry is the source of truth for what can run where.

## Layout

```
apps/
  controller/      the local-studio binary: controller (serve) and command line (probe, check, render, try, verify, deploy, agent, key)
  ui/              the web UI the controller serves at /  (control · live · usage)
  desktop/         Electron shell: starts the bundled controller and opens the UI
packages/
  contracts/       wire types between controller, UI and peers; formulas and formatters
  registry/        the recipe spec: types, load, pin, render, check, card matching
  probe/           accelerator detection: NVIDIA, AMD, Intel, Apple
  gates/           the six gates, run against any OpenAI-compatible endpoint
scripts/release.sh builds the binary for linux-x64, linux-arm64 and darwin-arm64, with the UI
```

## Boundaries

| Layer | May import | Must not |
|---|---|---|
| `packages/contracts` | nothing | know about the controller, the registry or the UI |
| `packages/registry` | node:crypto | read disk (except `registry/fs`), spawn, fetch |
| `packages/probe` | contracts | know about recipes; it takes a card matcher |
| `packages/gates` | registry (gate names, thresholds) | launch or stop anything |
| `apps/controller` | all packages | re-implement render, pinning, detection or gates |
| `apps/ui` | contracts | import anything from the controller or the registry |

Each job has exactly one implementation:

| Job | Where |
|---|---|
| Recipe → launch (template or frozen, container or host) | `packages/registry` `render` |
| Pins (image digest, or sha256 of a host launch) | `packages/registry` `pin` |
| Recipe validation | `packages/registry` `check` |
| Which card a GPU is | `packages/probe` detects, `packages/registry` `matchCard` decides |
| Does a configuration work | `packages/gates` `runGates` |
| Run a launch | controller lifecycle: `docker run` for containers, a supervised process for host programs |

## The registry

A checkout of [local-ai-registry](https://github.com/0xSero/local-ai-registry): `registry/cards`, `engines` (templates), `launches` (frozen launches), `recipes`, `models.json`. The controller reads it from git (`registry-ref`, default `main`) and keeps a cache. The command line reads a checkout with `--registry DIR`.

- A **card** is a GPU at one memory size and how programs recognise it.
- An **engine** is a template with `defaults`: a pinned image (container) or a command with pinned packages (host).
- A **launch** is a launch frozen exactly as it was validated.
- A **recipe** is weights at a commit, an engine or launch pinned by digest, the settings that differ from its defaults, the card, and its proofs. It is written only by a passing run.

## A configuration's life

```
probe ──▶ card ──▶ recipe ──render──▶ launch ──plan──▶ docker run | process ──▶ /v1/models ready
                                                                                     │
                                                         gates (load chat reasoning tools context speed)
                                                                                     │
                                                              proof ──▶ recipe file (only if all pass)
```

`local-studio try <weights> --model M --engine E --card C [--set k=v]` renders the recipe from the registry checkout, sends it to the running controller (`POST /api/lab/try`), which downloads the pinned weights, launches through the same lifecycle the UI uses, runs the gates and returns the proof; the command writes the recipe and the evidence into the checkout. `local-studio verify <model>` and the UI's Verify run the same gates against a model that is already running. No answer is ever capped.

## Runtime

Every machine runs the same binary; a hub is a controller with peers. Controllers signed in to the same Tailscale account trust each other and link automatically; keys still work. The gateway serves `/v1` in three dialects and routes each model to the one machine that serves it. Metrics are recorded where a request is served.
