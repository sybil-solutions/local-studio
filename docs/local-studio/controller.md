# Local controller and fleet

The controller is a small Bun service (`apps/local-controller`). It watches the inference servers on one machine and serves them to the rest of your machines. Each machine runs its own controller. Controllers that share a fleet key link into one graph.

## Where it runs

| Situation                           | How it runs                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop app (packaged)              | The app's server starts `Resources/local-controller/local-studio-controller` when nothing answers on the controller port, and stops it on quit.                                                                                                                                                                                    |
| Installed from **Settings → Local** | A user service. On Linux it is the systemd unit `local-studio-controller` with linger enabled, falling back to a background process when no user systemd is available. On macOS it is the LaunchAgent `ai.localstudio.controller`. The binary is `~/.local/bin/local-studio-controller` and it binds the machine's Tailscale IPv4. |
| Development                         | `pnpm --filter @local-studio/controller start`                                                                                                                                                                                                                                                                                     |
| Manual                              | Download `local-studio-controller-<os>-<arch>` from a release and run it.                                                                                                                                                                                                                                                          |

## Configuration

`~/.local-studio-t3/config.json` is written on first start with mode 0600:

| Field                   | Meaning                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| `id`, `name`            | Machine identity shown in the UI                                                 |
| `url`                   | The URL other controllers use to reach this one                                  |
| `fleetKey`              | Shared secret; every request except `/api/health` must send it as a bearer token |
| `peers`                 | URLs of linked controllers                                                       |
| `excludePorts`          | Local ports never treated as inference servers                                   |
| `engineKeys`            | API keys for local engines, by port                                              |
| `registry`, `modelsDir` | Recipe registry checkout and weights directory                                   |

The following environment variables change the defaults:

| Variable                          | Default                                                                    |
| --------------------------------- | -------------------------------------------------------------------------- |
| `LOCAL_STUDIO_T3_HOME`            | `~/.local-studio-t3`                                                       |
| `LOCAL_STUDIO_T3_PORT`            | `18091`                                                                    |
| `LOCAL_STUDIO_T3_HOST`            | `127.0.0.1`                                                                |
| `LOCAL_STUDIO_CONTROLLER_RELEASE` | `https://github.com/sybil-solutions/local-studio/releases/latest/download` |

To link machines by hand:

1. Bind each controller to its tailnet address with `LOCAL_STUDIO_T3_HOST`.
2. Set `url` to that address.
3. Give every machine the same `fleetKey`.
4. Add the peers in **Settings → Local**.

## Installing on a tailnet machine

**Settings → Local → Scan tailnet** lists online Linux and macOS devices from `tailscale status`. A device with a controller shows **Connect**, and one without shows **Install**. Install runs these steps from your machine's controller:

1. `ssh <tailnet-ip> sh -s` with `BatchMode`, so key-based access is required. A new host key is accepted.
2. On the remote machine, it refuses if `~/.local-studio-t3/config.json` exists or anything answers on port 18091. An existing controller is never replaced.
3. It downloads the matching binary from `LOCAL_STUDIO_CONTROLLER_RELEASE`.
4. It writes a config with your fleet key and the device's tailnet URL.
5. It installs and starts the user service.
6. It waits until `/api/health` answers, then adds the device to your peers.

To remove a controller, stop the user service on that machine and delete `~/.local/bin/local-studio-controller` and `~/.local-studio-t3`. Then remove the peer in **Settings → Local**.

## API

All routes except `/api/health` require the fleet key.

| Route                                                                                             | Purpose                                                               |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /api/health`                                                                                 | Identity and version                                                  |
| `GET /v1/models`, `POST /v1/chat/completions`, `/v1/completions`, `/v1/messages`, `/v1/responses` | Gateway across the whole fleet; `auto` selects the busiest live model |
| `GET /api/snapshot`, `/api/node`, `/api/recipes`                                                  | State for the Local settings page                                     |
| `GET /api/tailnet`, `POST /api/tailnet/deploy`                                                    | Tailnet scan and install                                              |
| `POST /api/recipes/<id>/run`, `/api/runs/<id>/stop`, `/api/ports/<port>/stop`                     | Launch and stop engines                                               |
| `POST /api/name`, `/api/peers`                                                                    | Rename, link and unlink                                               |
| `GET /api/registry`, `/api/registry/records/<id>`, `POST /api/registry/download`                  | Registry models matched to this machine's hardware, records, weights  |
| `GET /api/registry/share?port=<port>`, `POST /api/registry/share`                                 | Preview and share a running server's config to local-ai-registry      |

Registry launches use pinned container images and weight revisions on free matching NVIDIA GPUs, on ports 18100–18299. They never evict running engines.

The registry backs captured fleet configurations up next to the catalog. They are shown but stay read-only, as do host-specific, privileged and multi-machine launches; the UI says why instead of quietly rewriting them. Missing weights or scripts are reported, never invented. Cancelling a request is forwarded to the engine, but an engine that ignores client disconnects (the tested SGLang build, for example) may keep generating. `auto` ranks successful requests these controllers have observed, not an engine's earlier traffic.

The Registry section on **Settings → Local** reads `data/registry` from the same checkout. It matches each machine's GPUs, or an Apple Silicon chip and its unified memory, to registry hardware records within 1 GB, groups recipes by Hugging Face repository, and keeps one variant per hardware, engine, format and precision. **All hardware** lists every model. **Inspect** shows the full recipe, model instance, model and hardware records; **Use config** copies the launch command and **Download weights** runs `hf download` at the pinned revision on that machine.

**Share** on a running server builds registry records from its launch command or container, sends one short validation request, scrubs credentials, home paths, hostnames, private addresses and device IDs, and validates the records against the registry's JSON Schemas at the checked-out commit. Nothing is sent until you choose **Share** and then **Create PR**; the controller then forks `0xSero/local-ai-registry` and opens the pull request with your `gh` CLI login. `POST /api/registry/share` with `"dryRun": true` lists the `gh` calls without running them.
