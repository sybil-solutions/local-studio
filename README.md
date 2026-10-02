# Local Studio

Local Studio is a pinned T3 Code fork with Pi and Oh My Pi providers, a Local registry/fleet page, and a small federated inference controller. Upstream source and MIT attribution are preserved below. `LOCAL_STUDIO_UPSTREAM.json` records the import; `npm run check:budget` limits maintained custom source additions to 4,000 lines, excluding the upstream import itself.

Use Node 24, pnpm 11 and Bun 1.3.14. Run `pnpm install`, `pnpm --filter @local-studio/controller start`, then `pnpm dev:desktop --port 18773 --home-dir .t3`. This opens **Local Studio Dev** with hot reload and independent state. `npm run check` runs type checks, the web build and process-level controller E2E checks; no new unit tests are included.

The controller defaults to loopback port **18091** and `~/.local-studio-t3/config.json` (0600). To link machines, set their reachable `url`, bind `LOCAL_STUDIO_T3_HOST` to the tailnet address, and give them the same private `fleetKey`. Add peer URLs on the Local page. Never publish the key. `engineKeys` supplies credentials by port; `excludePorts` excludes other gateways. Configuration changes require restarting only the new controller.

Controllers discover local `/v1/models` listeners and expose `/v1/models`, `/v1/chat/completions`, `/v1/completions`, `/v1/messages` and `/v1/responses`. Requests and streams pass through natively; unsupported protocols retain the engine's error. `auto` chooses the live model with the most completed successful requests across the reachable graph. This measures traffic through these controllers, not historical engine traffic.

Registry launches use pinned container images and weight revisions on free matching NVIDIA GPUs, with separate ports **18100–18299**. Existing engines are never evicted. Captured configurations remain read-only; host-specific, multi-machine and privileged launches show their limitations instead of being silently rewritten. Cancellation is forwarded, but an engine that ignores client disconnects may continue generating. Pi/OMP use their installed CLI credentials and configuration; add them in Settings → Providers.

Connections uses direct, revocable pairing links to your environment and Local Studio desktop URL handlers. T3-owned cloud services are optional and disabled unless configured. The current migration runs as a development app alongside the existing install; stable release packaging is not enabled by this change.

## Upstream T3 Code

T3 Code is an "agent harness control surface". It enables control of the agents on your machine with a best-in-class mobile app ([iOS](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824), [Android](https://play.google.com/store/apps/details?id=com.t3tools.t3code)), [web app](https://app.t3.codes) and [Electron-based desktop app](https://t3.codes).

Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity. If they're set up on your computer, T3 Code can control them.

## "Wait, what are you selling me?"

Nothing. We built T3 Code because we wanted the best possible development experience with agents. We were inspired by existing solutions like the Codex desktop app, Conductor, Claude Desktop and Cursor Glass, but none met our bar.

We wanted something performant, remote-ready, and truly open. If we ever go the wrong direction, we want you to have everything you need to fork and build the editor that you want.

## Installation

> [!WARNING]
> T3 Code currently supports Codex, Claude, Cursor, Grok Build, OpenCode, and Antigravity. Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.

### Command line

```bash
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://t3.codes/install.ps1 | iex
```

Then run `t3` to start the server and open the local web app. `t3 service install` keeps it running in the background, `t3 update` moves to a newer release, and `t3 --help` has the full reference.

To try it once without installing, run `npx t3@latest` instead.

### Desktop app

Install the latest version of the desktop app from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), or from your favorite package registry:

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Debian, Ubuntu (`.deb`)

Download the `.deb` from [GitHub Releases](https://github.com/pingdotgg/t3code/releases), then:

```bash
sudo apt install ./T3-Code-*.deb
```

#### Arch Linux (AUR)

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

The AUR packaging is maintained in this repository under [`packaging/aur`](./packaging/aur).

## Some notes

We are very very early in this project. Expect bugs.

We are (mostly) not accepting contributions yet. Small fixes may be considered. Big features will not be.

## Documentation

Full docs live in [docs/](./docs). There's no docs site yet.

- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Keeping app and server in sync](./docs/user/updating.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Run T3 Code as a background service](./docs/user/background-service.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## If you REALLY want to contribute still.... read this first

### Install `vp`

T3 Code uses Vite+ so you'll need to install the global `vp` command-line tool.

#### macOS / Linux

```bash
curl -fsSL https://vite.plus | bash
```

#### Windows

```bash
irm https://vite.plus/ps1 | iex
```

Checkout their getting started guide for more information: https://viteplus.dev/guide/

### Install dependencies

```bash
vp i
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before reporting a bug or opening a PR.

Have a feature request? Start an [Ideas discussion](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
