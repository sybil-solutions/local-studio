# Windows port audit

## Scope and baseline

This audit covers the conservative Windows port requested in
`WINDOWS_PORT_HANDOFF.md`. The existing macOS behavior remains the reference
implementation. Windows support is additive; Linux and remote-controller
behavior remain in scope for regression protection.

- Upstream: <https://github.com/sybil-solutions/local-studio>
- Port branch: `windows-port`
- Baseline branch: `origin/dev`
- Baseline commit: `88b56e36bd5c84930dbe364296ba4ae669f72689`
- Audit date: 2026-08-10
- Audit host: Windows x64, NT build 26200
- GPUs observed through `nvidia-smi`: RTX 3090 24 GB and RTX 3080 Ti 12 GB,
  driver 610.62
- WSL: Ubuntu, default version 2

No implementation source was changed before this audit and the companion
port plan were written.

## Repository guidance and structure

The root `AGENTS.md`, root `README.md`, package manifests, package READMEs,
desktop source and packaging, controller source and tests, agent runtime,
shared contracts, scripts, workflows, compute devices, compute engines, PTY,
filesystem handling, updater, and release automation were inspected.

`AGENTS.md` says `docs/workflow.md` is the workflow source of truth, but that
file is absent at the baseline commit. Its short-form rules are therefore the
available repository guidance: branch from `dev`, use conventional commits,
run `npm run check`, add integration coverage for controller/runtime work, and
do not bypass hooks.

The repository has five relevant layers:

| Layer | Runtime | Responsibility | Audit classification |
| --- | --- | --- | --- |
| `controller/` | Bun/Hono | Controller API, model lifecycle, downloads, engines, telemetry, proxy, logs, usage, SQLite | Mostly portable with incomplete win32 process/runtime handling |
| `frontend/src/` | Next.js/React | UI, proxy routes, Workbench, filesystem and workspace APIs | Mostly portable; several path/test assumptions require win32 fixes |
| `services/agent-runtime/` | Node/Bun | Pi runtime, PTY, sessions, browser host, local files and projects | Partly win32-aware; current Windows tests expose path and permission failures |
| `frontend/desktop/` | Electron/Node | Desktop lifecycle, embedded servers, IPC, PTY, updater, packaging | Partly win32-aware; packaging target exists but smoke/update/process paths are macOS-led |
| `scripts/` and `.github/` | Node, Bash, Actions | Setup, install, services, CI, release | macOS/Linux-led; root entrypoint fails in a default Windows checkout |

## Baseline validation

### Toolchain

| Tool | Observed | Required | Result |
| --- | --- | --- | --- |
| Node.js | 22.22.2 | 22.19+ | Pass |
| npm | 10.9.7 | 10+ | Pass |
| Bun | 1.3.13 | 1.3.14+ | Baseline mismatch |
| Python | 3.12.10 as `python` | 3.10+ | Installed, but root doctor only probes `python3` |
| Git | 2.54.0.windows.1 | 2+ | Pass |

### Baseline commands and failures

| Check | Baseline result on Windows | Classification |
| --- | --- | --- |
| `npm run doctor` | Fails before checks because `scripts/project.mjs` is a plain 31-byte symlink placeholder | Existing Windows checkout failure |
| `npm run setup` | Same entrypoint failure | Existing Windows checkout failure |
| Direct locked installs | Succeed sequentially; concurrent Bun 1.3.13 installs hit a shared-cache `ENOTEMPTY` race | Environment/Bun baseline issue |
| Controller typecheck | Pass | Portable |
| Controller lint | Pass | Portable |
| Controller tests | 80 pass, 5 fail, 1 module-load error | Existing Windows failures; `/bin/sh` process test is definitely POSIX-only, module initialization failures may be Bun-version-sensitive |
| Frontend typecheck | Pass | Portable |
| Desktop typecheck | Pass | Portable |
| Frontend lint | Pass | Portable |
| Frontend tests | 123 pass, 4 fail | Three Bash fake-binary failures and one POSIX system-directory test failure |
| Agent runtime tests | 54 pass, 38 fail, 1 error | Windows path encoding, POSIX permission-bit enforcement, and root-script entrypoint dominate |
| Frontend/agent build | Blocked by root symlink entrypoint | Existing Windows automation failure |
| Desktop package smoke | macOS `.app` layout and POSIX PTY command are hard-coded | Requires win32 implementation |

The failures above are the pre-port baseline, not regressions from port work.

## Required global search

The required platform terms were searched across source, tests, scripts, and
workflows, excluding lockfiles and binary assets.

| Term or family | Files with hits | Principal areas |
| --- | ---: | --- |
| `darwin` | 28 | desktop, compute engines/devices, setup UI, tests, installer |
| `linux` | 13 | compute devices, launcher, speech worker, CI/docs |
| `win32` | 13 | PTY, browser discovery, compute contracts/engines, config, packaging helper |
| `process.platform` | 11 | desktop, PTY, browser, controller config/service |
| `launchctl` | 1 | controller Bash installer |
| `systemctl` | 1 | controller Bash installer |
| `/bin/` | 20 | tests, engine defaults, PTY, runtime paths, scripts |
| `bash` | 12 | installers, remote deploy, tests, documentation |
| `chmod` | 31 | stores, credentials, tests, release automation |
| `SIGTERM` | 11 | controller/desktop/agent process shutdown |
| `SIGKILL` | 11 | controller/desktop process escalation |
| `HOME` | 36 | scripts, tests, controller command search, agent paths |
| `USERPROFILE` | 0 | no direct support |
| `path.delimiter` | 4 | workspace, Git, directory browser, desktop PATH |
| DMG | 7 | macOS installer, updater, packaging and docs |
| notarization | 4 | macOS package/release path |
| codesign | 2 | macOS installer/release self-tests |

## Classification by subsystem

### Already cross-platform or reusable

- The controller API, Hono routing, SSE, OpenAI-compatible proxy, download
  manager, usage accounting, settings contracts, and SQLite stores mostly use
  runtime APIs and `node:path`.
- `controller/src/config/env.ts` already gives Windows a user-home model
  directory instead of `/models`.
- Compute contracts already model `linux`, `darwin`, and `win32`, and carry an
  explicit `wsl` flag.
- `controller/src/modules/compute/devices/storage.ts` uses `statfsSync` and
  selects `C:\` for win32.
- GPU discovery resolves `nvidia-smi` through PATH/configuration and uses a
  real CSV query for UUID, PCI bus id, model, VRAM, utilization, temperature,
  power, and driver version. It works on the audit host without a Windows-only
  shell command.
- Electron closes when all windows close on non-Darwin and preserves the
  standard macOS activate behavior.
- Electron file/folder dialogs, external URL handling, user-data paths,
  frontend/agent server paths, and most IPC use Node/Electron platform APIs.
- Workspace allowlists use `path.delimiter`, `path.relative`, `path.sep`, and
  native `realpath` in their security boundaries.
- `@lydell/node-pty` ships platform-specific native packages, and both desktop
  and agent runtime already branch for win32.
- `frontend/desktop/project.mjs` already creates a Windows directory junction
  for shared frontend dependencies.
- `electron-builder.yml` already declares `nsis` x64 and Linux AppImage
  targets in addition to the existing macOS targets.
- vLLM and SGLang compute plans already reject native win32 and permit Linux
  under WSL; MLX remains Darwin/Apple-Silicon only.

### macOS-only behavior that must remain intact

- `scripts/install-desktop-app.sh` is a macOS install/rollback flow built
  around app bundles, DMGs, Launch Services, `codesign`, Gatekeeper, `ditto`,
  `hdiutil`, `osascript`, and `/Applications`.
- `.github/workflows/release.yml` builds, signs, notarizes, staples, stages,
  and publishes the macOS release. It must not be repurposed for Windows.
- The current stable updater feed is documented and tested around
  `latest-mac.yml`, signed ZIP/DMG assets, and macOS signature verification.
- `electron-builder.yml` retains the macOS icon, category, arm64 DMG/ZIP,
  hardened runtime, entitlements, microphone description, and signing identity.
- Apple Metal telemetry and MLX support are explicitly Darwin/arm64-only.
- Quick-panel animation and Electron `panel` window type are already guarded
  to Darwin and should remain so.
- Desktop smoke assumes `.app/Contents/MacOS`, `/tmp`, a POSIX `printf`
  command, and negative process-group signalling.

### Linux-only behavior that must remain intact

- The controller installer uses `systemd --user` with a `nohup` fallback.
- Linux memory uses `/proc/meminfo`; thermal telemetry uses `/sys/class/hwmon`;
  Intel GPU discovery uses sysfs.
- Process ownership/start tokens use `/proc/<pid>/stat`; runtime discovery uses
  `ps`; process-group shutdown signals `-pid`.
- vLLM/SGLang CUDA and ROCm paths, Docker GPU passthrough, and canonical
  `/opt/venvs` discovery are Linux targets.
- Speech worker parent-death behavior uses Linux `prctl` when available.

### Existing win32 awareness that should be preserved and extended

- `HostPlatform` includes `win32`; host info falls back to Node's memory APIs.
- `systemRoot()` uses `C:\` and storage sampling works on the audit host.
- `defaultModelsDirectory()` uses the Windows home directory.
- Browser discovery checks common Chrome/Edge Windows locations.
- PTY currently selects `COMSPEC`/`cmd.exe` on Windows.
- The desktop dependency linker uses a junction on Windows.
- Engine capability tests already assert that vLLM native win32 is refused,
  vLLM under WSL is accepted, and llama.cpp process execution is accepted.
- Electron Builder contains an NSIS x64 target.

### Requires a Windows implementation

#### Setup and repository automation

- `scripts/project.mjs` is a Git symlink to
  `frontend/desktop/project.mjs`. With `core.symlinks=false`, the default on
  many Windows Git installations, it becomes invalid JavaScript. The hook
  files have the same checkout problem.
- The doctor probes only `python3`, while the standard Windows command is often
  `python` or `py`.
- `setupHooks()` applies `chmod` to symlink hook entries and assumes they can
  directly execute the project script.
- The automation layout gate expects the symlink/executable-mode layout.
- `desktop:start:dev` assigns an environment variable with POSIX syntax.

#### Paths and filesystem

- `projects-store-core.ts` strips and splits only `/`, so Windows backslashes,
  drive roots, and trailing separators produce incorrect project names and
  duplicate records.
- Managed Python environments hard-code `bin/python`; Windows venvs use
  `Scripts/python.exe`.
- Runtime target scanning searches only POSIX venv layouts and uses `/` to
  classify configured llama.cpp paths.
- The managed llama.cpp result is hard-coded as
  `src/build/bin/llama-server`; Windows produces an `.exe`, often in a
  configuration directory for multi-config generators.
- Windows drive-letter, UNC, backslash, spaces, Unicode, and non-C: paths lack
  focused tests across controller config, project storage, and runtime targets.
- Pi session directory encoding carries `C:` into a path component in some
  test/runtime flows, producing invalid nested paths on Windows.

#### Shell and PTY

- Windows PTY falls directly to `cmd.exe`; the requirement is PowerShell 7,
  Windows PowerShell, then `cmd.exe`.
- PTY tests send POSIX arithmetic, `pwd`, and Bash syntax.
- Environment setup injects `TERM`, `COLORTERM`, and `LANG` unconditionally;
  these are harmless for many shells but should not be relied upon as Windows
  capability signals.
- Frontend package scripts use POSIX inline environment assignment for the
  Electron dev launch.

#### Process spawning, ownership, and shutdown

- Controller process ownership falls back to `ps` when `/proc` is absent; that
  cannot prove ownership on Windows.
- Controller process stop sends negative process-group IDs and POSIX signals.
- Command timeout escalation, engine jobs, desktop embedded servers, agent
  runtime, controller main shutdown, and log tail processes use
  `SIGTERM`/`SIGKILL`. Node maps some signals on Windows, but process-tree
  semantics are not equivalent and must be explicit.
- Desktop package smoke kills negative process groups, which is POSIX-only.
- Runtime discovery uses `ps -eo`; no Windows process enumeration adapter
  exists.

#### Controller install/service lifecycle

- `install-controller.sh` supports launchd, systemd, and a POSIX nohup fallback
  only.
- The remote deploy flow is intentionally SSH+Bash and remains valid for
  macOS/Linux remote controllers; it is not a local Windows installer.
- At the audit baseline, no Windows user startup/task/service implementation
  existed.

#### Hardware and engines

- NVIDIA telemetry itself works natively, but tests need injected command
  results so Windows CI does not require a GPU.
- Accelerator records currently discard the driver version queried by
  `nvidia-smi`; CUDA toolkit metadata is separate and may be absent even when
  the driver can run CUDA applications.
- Managed llama.cpp installation builds from source only and assumes POSIX
  output paths and `nvcc` fallback. A native Windows implementation should
  either use the upstream Windows release artifacts with integrity/version
  validation or support a tested CMake generator/toolchain path. Initial work
  will use the smallest validated path.
- `exllamav3` currently reports process support on any non-Darwin CUDA host,
  which inaccurately advertises native win32 without validation.
- The older runtime/installation APIs can still offer vLLM, SGLang, or MLX
  installation based on package discovery without consulting the newer
  compute capability matrix. The UI must not equate a Python import with a
  supported native Windows engine.

#### Electron packaging, updater, and CI

- The NSIS target exists but is not exercised locally or in CI.
- There is no Windows icon/installer customization, Windows package script,
  artifact naming, or Windows-specific `extraResources` validation.
- `afterPack` requires macOS Pi helper markers in the bundled runtime source
  even though the helper executable check itself is Darwin-only. The packaged
  Pi launcher contract needs a Windows branch.
- Desktop package smoke only understands macOS app layout and shell syntax.
- The updater defaults/documentation are macOS-specific. Windows builds must
  not claim a production update channel until signed Windows artifacts and
  `latest.yml` are actually published.
- CI quality gates run on Ubuntu and desktop packaging runs on macOS only.
  There is no `windows-latest` job.

## Engine capability reality

The matrix below distinguishes repository behavior from upstream engine
support. It is intentionally conservative.

| Engine | Native Windows status | WSL2/remote status | Port decision |
| --- | --- | --- | --- |
| llama.cpp | Supported upstream. Current releases publish Windows x64 CPU, CUDA 12/13, Vulkan, SYCL, and HIP artifacts; Winget is also documented. | Also works as a Linux target | Initial native inference engine; validate CUDA artifact/runtime end to end |
| vLLM | Official requirements say Linux and explicitly say Windows is not supported natively | Official docs recommend WSL with a compatible Linux distribution; remote Linux remains supported | Keep native win32 unavailable; expose explicit WSL2/remote route only |
| SGLang | Official installation documentation provides Linux-style CUDA, Python, and Docker paths and no validated native Windows path | Treat WSL2/remote Linux as the supported Windows route after integration validation | Keep native win32 unavailable |
| MLX | Apple Silicon/macOS only | Remote macOS controller only | Preserve existing Darwin implementation; unavailable locally on Windows |
| exllamav3/TabbyAPI | Not validated in this audit as a supported Local Studio native Windows server lifecycle | Remote/WSL may be investigated later | Do not advertise native Windows yet |

Upstream evidence:

- vLLM GPU installation requirements:
  <https://docs.vllm.ai/en/v0.17.0/getting_started/installation/gpu/>
- SGLang installation documentation:
  <https://docs.sglang.io/docs/get-started/install>
- llama.cpp installation documentation:
  <https://github.com/ggml-org/llama.cpp/blob/master/docs/install.md>
- llama.cpp release artifacts:
  <https://github.com/ggml-org/llama.cpp/releases>
- Microsoft WSL installation and distribution selection:
  <https://learn.microsoft.com/en-us/windows/wsl/install>

## Electron assumptions

- The main window, renderer hardening, IPC boundary, external link handling,
  dialogs, quick panel, and single-instance lifecycle are largely portable.
- Packaged frontend and agent runtime processes are forked through Electron's
  Node runtime; shutdown currently relies on POSIX-like signal names.
- The menu is removed globally; there is no macOS menu implementation to
  replace.
- `window-all-closed` already follows standard Windows/Linux quit behavior and
  preserves macOS activation behavior.
- The global quick-panel accelerator uses `CommandOrControl`, which is
  cross-platform. Panel animation/type are correctly Darwin-only.

## Controller/service assumptions

- The controller can bind loopback and use its API/SQLite stores on Windows;
  config defaults, data directories, and model directories use Node path APIs.
- Persistent installation is coupled to a Bash script with launchd/systemd.
- Local Electron currently starts the frontend and agent runtime, not a bundled
  controller. The UI defaults to `http://localhost:8080`, so a Windows desktop
  acceptance build still needs a separately running local controller until a
  deliberate bundled-controller lifecycle is designed.
- Remote controller deployment over SSH remains a macOS/Linux controller
  installation path and should remain unchanged.

## Test and CI assumptions

- Multiple unit tests create executable Bash fixtures with `chmod` and
  `#!/bin/sh`.
- Filesystem-root tests assume POSIX roots exist even on Windows.
- Controller process tests hard-code `/bin/sh`.
- PTY integration tests use POSIX commands and are skipped under Bun, so they
  do not currently prove the production Node/Electron Windows PTY path.
- Session fixtures encode drive-letter paths incorrectly.
- Permission tests enforce POSIX mode bits on Windows, where those bits do not
  express the Windows ACL security property.
- Next.js file tracing evaluates runtime home-directory discovery as a recursive
  build-time glob on Windows and follows protected compatibility junctions such
  as `Application Data` unless the Windows trace excludes the runtime user home.
- No Windows runner executes install, typecheck, unit tests, build, or package
  smoke.

## Proven, inferred, and missing validation

### Proven in this audit

- Default Windows symlink checkout breaks all root project commands.
- TypeScript compilation and lint already pass for controller, frontend, and
  Electron desktop source.
- Real Windows NVIDIA telemetry can be obtained with the existing
  `nvidia-smi` query on the audit host.
- Windows storage sampling and host snapshot collection execute successfully.
- Current Windows tests expose concrete path, shell, and permission failures.
- The Next.js standalone build reaches application compilation but fails during
  file tracing when runtime user-home discovery is not excluded from packaging.
- vLLM is not supported natively on Windows according to its current official
  installation documentation.
- llama.cpp publishes native Windows x64 CUDA artifacts.
- The official `b10355` Windows CUDA 12.4 and CUDA runtime archives install
  together, `llama-server.exe --version` succeeds, and `--list-devices` reports
  both host NVIDIA GPUs (RTX 3090 and RTX 3080 Ti).
- The managed Windows installer completes its release lookup, artifact
  selection, download, extraction, activation, and version probe end to end.
- The Windows controller installer completes install, health, restart, update,
  configuration reuse, log inspection, and removal from a path containing
  spaces and Unicode without elevation. The audit host denies Scheduled Task
  creation, so the validated fallback is the current user's `HKCU` startup
  entry; controller secrets remain in `.env`, not its startup command.
- An unsigned Windows x64 Electron package boots successfully with the embedded
  frontend, agent runtime, browser host, desktop bridge, and PowerShell PTY. Its
  shutdown leaves no owned processes or smoke directories behind.
- The Windows package contains the controller PowerShell installer and win32
  ConPTY runtime, and the NSIS target produces an unsigned per-user x64
  installer without invoking the macOS release flow.
- The controller downloaded the 105,454,432-byte
  `SmolLM2-135M-Instruct-Q4_K_M.gguf` to an `F:` path containing spaces and
  Unicode, then rediscovered the model through `/v1/studio/models`.
- Native `llama-server.exe` launched the GGUF with CUDA offload, became healthy
  in 1.9 seconds, and served both normal and SSE OpenAI-compatible chat
  completions. The controller recorded 96 tokens across the first two requests,
  exposed NVIDIA telemetry for both GPUs, persisted recipe-linked logs, and
  evicted the Windows process tree without an orphan.
- The aggregated `/config` runtime view recognizes the managed llama.cpp binary
  immediately after installation, and engine logs remain available through the
  controller log API after eviction.
- The unsigned NSIS installer completed a silent ASCII-path install, the
  installed application passed the full packaged desktop smoke, and its silent
  uninstaller removed the installation. A bounded custom-destination attempt
  containing spaces and Unicode did not complete and was terminated; that NSIS
  path case is not claimed as validated.
- The Windows controller exposes eligible WSL2 distributions only as explicit
  vLLM/SGLang targets. Distribution discovery did not start stopped
  distributions, and native Windows Python targets for these engines remained
  unavailable.
- A real Ubuntu WSL2 bridge launch translated an `F:` path containing spaces and
  Unicode, preserved a Unicode environment value, served a fixture through
  Windows localhost, captured logs, and stopped its Linux process group.
- Controller restart recovery reattached through the persisted Linux PID/start
  identity, then health, logs, ownership, and eviction still succeeded.
- Milestone 10 removed distribution termination from every cleanup path. Engine
  stop now signals only the recorded Linux process group and deletes its PID
  file; no path invokes `wsl --terminate` or `wsl --shutdown`.
- Settings installed, updated, and removed receipt-backed Ubuntu targets for
  vLLM 0.27.0 and SGLang 0.5.9. Each target used an isolated managed Python
  3.12 and virtual environment in `/home/pipeline/.local/share/local-studio`.
- SGLang's published package initially selected CPU Torch and a CUDA-12 kernel
  beside CUDA-13 Torch. The managed installer now replaces the Torch family
  coherently, installs the upstream CUDA-13 `sgl_kernel` wheel, aligns the
  compiler packages, and rejects activation if `sgl_kernel` cannot import.
- Both engines detected the two Ubuntu NVIDIA devices, launched
  `HuggingFaceTB/SmolLM2-135M-Instruct`, and returned OpenAI-compatible chat
  completions through Windows localhost. Stop removed only the engine process.
- A second Settings-only cycle clicked Install and Remove for each Ubuntu card.
  Both cards returned to `available / Install`; managed paths, receipts,
  staging directories, and isolated acceptance caches were absent afterward.
- The eight recorded Docker Desktop sentinel PIDs and start times were unchanged
  through all engine lifecycle and package operations. Immediately after each
  engine stop, both Ubuntu and `docker-desktop` remained in the running list.

### Missing collection or experimental validation

- Live model download to a UNC share; drive-letter, spaces, Unicode, and non-C:
  paths are validated.
- Custom NSIS installation destinations containing spaces and Unicode.
- UNC model-path translation through a selected WSL2 distribution.
- Any native Windows exllamav3 support.

These items are not claimed as supported until their milestone acceptance
checks pass.
