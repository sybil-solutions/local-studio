# Local Studio

> **Built on [T3 Code](https://github.com/pingdotgg/t3code)** by Theo Browne, Julius Marminge and the T3 Tools team, used under the MIT License (Copyright (c) 2026 T3 Tools Inc.).
> Local Studio is a thin fork that tracks upstream T3 Code closely. Almost all of the app — the agent UI, providers, threads, terminal, source control, remote access and mobile app — is their work. Please star and support [the upstream project](https://github.com/pingdotgg/t3code).

Local Studio is T3 Code for people who run their own models. It adds:

- **Pi and Oh My Pi providers.** Both run next to Codex, Claude, Cursor, Grok, OpenCode and Antigravity. They support streaming, tool calls, reasoning, interrupt, compaction, rollback, model/thinking selection, session import and token usage.
- **A bundled local controller.** It discovers the inference servers on each machine (vLLM, SGLang, llama.cpp, anything serving `/v1/models`) and exposes them through one OpenAI/Anthropic-compatible gateway. It can launch pinned registry recipes on free NVIDIA GPUs.
- **A machine fleet over Tailscale.** **Settings → Local** finds the devices on your tailnet and connects existing controllers. On Linux and macOS machines that have none, it installs a controller with one click, so a model loaded on any machine is usable from every machine.

`LOCAL_STUDIO_UPSTREAM.json` records the pinned upstream import. `node scripts/local-check.mjs --budget` keeps Local Studio's own source under 4,000 lines on top of it, so upstream updates stay easy to merge.

## Download

Get the latest release from [GitHub Releases](https://github.com/sybil-solutions/local-studio/releases/latest). Every installer, `.deb` package and controller binary is listed there:

| Platform             | Installer                                                                        |
| -------------------- | -------------------------------------------------------------------------------- |
| macOS, Apple silicon | [Local-Studio-mac-arm64.dmg](https://github.com/sybil-solutions/local-studio/releases/latest/download/Local-Studio-mac-arm64.dmg)        |
| macOS, Intel         | [Local-Studio-mac-x64.dmg](https://github.com/sybil-solutions/local-studio/releases/latest/download/Local-Studio-mac-x64.dmg)            |
| Windows x64          | [Local-Studio-win-x64.exe](https://github.com/sybil-solutions/local-studio/releases/latest/download/Local-Studio-win-x64.exe)              |
| Linux x64            | [Local-Studio-linux-x64.AppImage](https://github.com/sybil-solutions/local-studio/releases/latest/download/Local-Studio-linux-x64.AppImage)         |
| Linux arm64          | [Local-Studio-linux-arm64.AppImage](https://github.com/sybil-solutions/local-studio/releases/latest/download/Local-Studio-linux-arm64.AppImage) |

macOS builds are signed and notarized. Windows builds are not yet code-signed, so SmartScreen asks for confirmation. Each release also attaches `SHA256SUMS` and standalone controller binaries for Linux, macOS and Windows.

Install and log in to at least one agent CLI before first use. For Pi, install `pi`; for Oh My Pi, install `omp`. Both use their own configured models and credentials. The other providers are covered in the [upstream provider guides](./docs/user).

## Local models and the fleet

The desktop app starts its bundled controller on `127.0.0.1:18091` unless one is already running. Its configuration lives in `~/.local-studio-t3/config.json` (mode 0600). That file holds the machine name, the controller URL, the private `fleetKey` and the linked peers.

Open **Settings → Local** to see every connected machine with its GPUs, live models, launchable recipes and usage. Machines on your tailnet appear automatically:

- **Connect**: the machine already runs a controller; this links it.
- **Install**: the machine is Linux or macOS with no controller. Local Studio installs one over `ssh` as a user service (systemd or launchd), binds it to the machine's Tailscale address, gives it your fleet key, and links it. This needs key-based `ssh` access to that machine. Machines that already have a controller are never overwritten.

Every controller serves `/v1/models`, `/v1/chat/completions`, `/v1/completions`, `/v1/messages` and `/v1/responses`. Requests stream through to the engine that holds the model, on whichever machine it runs. The model id `auto` picks the live model with the most successful requests. Keep the fleet key private. More detail is in [docs/local-studio/controller.md](./docs/local-studio/controller.md).

## Phone and tablet

The [T3 Code mobile app](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) ([Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)) connects to Local Studio like any T3 Code environment. Pair it from **Settings → Connections**; over Tailscale, use the machine's tailnet address. See [remote access](./docs/user/remote-access.md).

## Development

Use Node 24, pnpm 11 and Bun 1.3.14.

```bash
pnpm install
pnpm --filter @local-studio/controller start
pnpm dev:desktop --port 18773 --home-dir .t3
```

`dev:desktop` opens **Local Studio Dev** with hot reload and its own state. It runs React in development mode, which is many times slower in long threads. For daily use, build and run the production app instead:

```bash
pnpm build:desktop
T3CODE_HOME="$PWD/.t3" pnpm start:desktop   # installed builds keep data in ~/.local-studio
```

`node scripts/local-check.mjs` runs the type checks, the web build, the controller end-to-end checks and the source budget. Upstream development notes are in [docs/operations/development.md](./docs/operations/development.md).

## Releases

`.github/workflows/release.yml` builds and publishes a release from a `vX.Y.Z` tag or a manual run. It produces:

- signed and notarized macOS DMGs for arm64 and x64
- a Windows NSIS installer
- Linux AppImage and `.deb` packages for x64 and arm64
- controller binaries
- updater manifests and checksums

The process is in [docs/local-studio/release.md](./docs/local-studio/release.md).

## Upstream T3 Code

The [docs/](./docs) folder is upstream's documentation and still describes most of the app. Upstream's own builds, install script (`t3.codes`), package-manager entries and T3 Connect service belong to T3 Tools. Local Studio does not publish to them.

## License

MIT. See [LICENSE](./LICENSE). Copyright (c) 2026 T3 Tools Inc. for T3 Code. Local Studio changes are released under the same license. Oh My Pi's license is in [assets/OMP-LICENSE.txt](./assets/OMP-LICENSE.txt).
