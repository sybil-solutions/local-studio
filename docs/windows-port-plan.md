# Windows port plan

## Principles

- Preserve the baseline macOS implementation and release flow.
- Keep Linux behavior unchanged unless a shared, demonstrated defect requires
  a narrow fix.
- Add platform adapters only at real operating-system boundaries.
- Reuse current win32-aware code instead of replacing it.
- Never advertise a runtime merely because its package imports.
- Keep WSL2 and remote-controller execution explicit.
- Commit each milestone separately with the repository's conventional commit
  style.

## Milestone gate

Every implementation milestone follows the same gate:

1. Implement the smallest coherent change.
2. Run focused existing and new tests.
3. Run `npm run check` when root automation permits it.
4. Run `npm run test:integration` for controller/runtime changes.
5. Run relevant typecheck and build commands.
6. Inspect `git status`, `git diff --stat`, and the complete diff.
7. Verify that unrelated Darwin/Linux files and behavior did not change.
8. Commit the milestone separately.

Pre-existing Windows baseline failures stay listed in
`docs/windows-port-audit.md` until the milestone that owns them fixes them.

## Milestone 0 - Audit and plan

Deliverables:

- Record the exact upstream `dev` baseline.
- Classify platform-specific and portable code.
- Record baseline failures separately from port regressions.
- Verify current upstream engine support claims.
- Write this plan before broad implementation changes.

Acceptance:

- `docs/windows-port-audit.md` and `docs/windows-port-plan.md` exist.
- No implementation source changed in this milestone.
- Commit: `docs(windows): audit port requirements and milestones`.

## Milestone 1 - Windows-safe repository automation

Scope:

- Replace the fragile root symlink entrypoint with a tiny portable JavaScript
  forwarding entrypoint while retaining one canonical implementation.
- Make root doctor accept `python3`, `python`, or the Windows `py -3` launcher
  without weakening version validation.
- Make hook installation safe on Windows; do not require POSIX executable bits
  to express Windows hook behavior.
- Replace POSIX-only Electron dev environment assignment with a small portable
  launcher or direct Node platform handling.
- Keep the existing automation layout checks meaningful on all platforms.

Tests:

- Root doctor unit/self-test coverage for tool candidate selection.
- Windows checkout test that executes `node scripts/project.mjs doctor` with
  the normal non-symlink entrypoint.
- Existing release automation self-tests remain green.

Acceptance:

- `npm run doctor` and `npm run setup` work in a default Windows checkout.
- Existing Linux/macOS invocations keep the same command names and behavior.
- Root check can advance past automation bootstrap.

## Milestone 2 - Platform paths, projects, sessions, and PTY

Scope:

- Add a small shared shell resolver used by desktop and agent-runtime PTY:
  PowerShell 7, Windows PowerShell, then `COMSPEC`/`cmd.exe`; preserve the
  current non-Windows shell path.
- Add platform-specific PTY test commands without changing session semantics.
- Replace project name/trailing-separator string parsing with `node:path`.
- Add Windows venv executable resolution (`Scripts/python.exe`) alongside the
  existing POSIX `bin/python` layout.
- Fix Pi session-directory encoding so drive letters and backslashes never
  become invalid path components, while preserving existing POSIX encodings.
- Gate POSIX mode-bit assertions on platforms where they are meaningful; keep
  atomic creation and Windows ACL ownership assumptions explicit.

Tests:

- PowerShell preference and cmd fallback as pure injected tests.
- Drive-letter, non-C: drive, spaces, Unicode, trailing backslash, and UNC
  project path tests.
- Windows and POSIX venv layout tests.
- Windows session encoding/lookup tests.
- Existing macOS/Linux path and PTY tests remain unchanged or receive explicit
  platform cases rather than replacement expectations.

Acceptance:

- Workbench project selection and file access preserve Windows paths exactly.
- Agent runtime tests no longer fail because a drive colon becomes a path
  separator or because Windows lacks POSIX permission bits.
- PTY resolves PowerShell first on Windows and keeps zsh/SHELL behavior on
  macOS/Linux.

## Milestone 3 - Windows controller process lifecycle and telemetry

Scope:

- Introduce a narrow process-platform adapter for PID liveness, command-line
  ownership, tree termination, and escalation.
- Preserve `/proc`, `ps`, process groups, and POSIX signals in the existing
  Darwin/Linux implementation.
- Use a real Windows process query and process-tree stop mechanism without
  constructing shell strings from runtime arguments.
- Keep command timeouts and abort semantics consistent.
- Add injectable NVIDIA SMI parsing/probe tests, including missing fields and
  missing tooling.
- Propagate driver data only where the existing contracts can represent it
  truthfully; do not fabricate CUDA toolkit versions.

Tests:

- Windows process ownership and stop planning through injected runners.
- Real short-lived child lifecycle on Windows CI.
- NVIDIA CSV parsing with two GPUs, unavailable counters, and no-GPU cases.
- Existing Linux process launcher/lifecycle tests remain green.

Acceptance:

- Controller boot, health, SQLite, downloads, model metadata, logs, usage,
  settings, and proxy routes pass focused Windows integration tests.
- Lifecycle can start and stop a test server without orphaning its child tree.
- Real audit-host NVIDIA telemetry reports both cards and honest capabilities.

## Milestone 4 - Native Windows llama.cpp

Scope:

- Make llama.cpp runtime discovery accept `llama-server.exe` and Windows PATH
  semantics.
- Implement a Windows-managed runtime path that uses an experimentally
  validated upstream artifact or build path.
- Preserve the existing macOS/Linux source-build implementation.
- Keep companion CUDA DLLs beside the executable when the selected upstream
  artifact requires them.
- Validate archive contents, executable identity, version, and final managed
  path before marking installation successful.
- Keep vLLM/SGLang native win32 unavailable; mark exllamav3 unavailable until
  separately validated.

Tests:

- Asset selection and archive-path validation without a GPU.
- Windows executable/output path tests.
- Capability matrix tests for native, WSL2, remote, and unavailable engines.
- Real audit-host smoke: install/discover `llama-server.exe`, launch a small
  GGUF with CUDA offload, query health/models/chat, stream a response, stop,
  and confirm GPU/process cleanup.

Acceptance:

- Native Windows llama.cpp is the only initially advertised local Windows
  inference engine unless another engine completes its own experimental gate.
- Model discovery, download, launch, proxy streaming, and eviction work on the
  target host.
- vLLM/SGLang remain Linux targets through explicit WSL2/remote paths.

## Milestone 5 - Windows controller installation and startup lifecycle

Scope:

- Add a PowerShell controller installer beside, not inside, the current Bash
  launchd/systemd installer.
- Use a per-user Windows Scheduled Task or another validated per-user startup
  mechanism behind the same install/start/health contract.
- Generate and persist the API key and directories without exposing secrets in
  process arguments or logs.
- Keep install/update/removal idempotent and port-scoped.
- Preserve remote SSH+Bash deployment for macOS/Linux controllers.

Tests:

- Pure configuration/task-definition tests without requiring elevation.
- Install into a temporary path containing spaces and Unicode.
- Start, health, restart, update, and remove on the audit host.

Acceptance:

- A non-admin Windows user can install the local controller, have it return
  after login, inspect its logs, and remove it cleanly.
- launchd and systemd scripts are unchanged except for shared documentation or
  independently proven shared fixes.

## Milestone 6 - Windows Electron package and smoke test

Scope:

- Add explicit Windows desktop scripts and NSIS/package configuration while
  retaining all macOS targets, signing, entitlements, DMG, notarization, and
  release jobs.
- Add a Windows icon only as a packaging asset; branding remains unchanged.
- Make `afterPack` validate the correct packaged Pi launcher for each platform.
- Generalize desktop smoke to locate `.app` or `.exe`, use a platform-specific
  temporary cwd and PTY command, and terminate the process tree correctly.
- Disable production updater claims for unsigned Windows developer builds.
  Do not add Windows publishing or signing in this port.

Tests:

- Desktop main/extension tests.
- Windows unpacked package build and launch smoke.
- Embedded frontend health, agent runtime health, desktop bridge, browser host,
  project dialog contract, PTY roundtrip, and clean shutdown.
- Existing macOS package smoke remains intact.

Acceptance:

- An unsigned local Windows x64 developer package builds and boots.
- The packaged app connects to the local controller and exercises Workbench,
  model lifecycle, logs, usage, settings, files, and PTY.
- No macOS signing/notarization/release configuration is removed or weakened.

## Milestone 7 - Windows CI

Scope:

- Add a separate `windows-latest` job or jobs for locked dependency install,
  typecheck, unit tests, build, and Electron compile/package smoke where
  feasible.
- Pin the same Node and Bun versions as existing CI.
- Keep existing Ubuntu and macOS jobs unchanged.
- Skip hardware-only validation only with an explicit reason; test hardware
  parsing and capability logic through fixtures.

Acceptance:

- Windows CI proves repository setup, controller/frontend/agent checks, unit
  tests, production build, desktop TypeScript compilation, and an unpacked
  Electron package smoke.
- No existing job is weakened to make Windows green.

## Milestone 8 - Support documentation and final acceptance

Scope:

- Create `docs/windows-support.md` with Windows 11 x64 prerequisites, NVIDIA
  driver/CUDA expectations, native engine matrix, WSL2/remote distinctions,
  setup, developer build, package build, service lifecycle, and limitations.
- Record exact commands and results from real-host acceptance.
- Re-run the full gate and inspect the complete branch diff from the baseline.

Final Windows acceptance:

- Controller, UI, and packaged desktop boot.
- Local/remote controller selection remains functional.
- Workbench/Pi sessions, local files, Git, and PowerShell PTY work.
- Model discovery and download work on a non-C: drive path with spaces and
  Unicode.
- Native Windows llama.cpp launches with NVIDIA CUDA, serves the
  OpenAI-compatible endpoint, streams chat, reports logs/usage/telemetry, and
  evicts cleanly.
- Settings persist and clean shutdown leaves no owned runtime processes.
- WSL2/remote engines are labeled explicitly; unsupported native engines are
  unavailable.

Final regression acceptance:

- Current non-Windows tests pass in their CI environments.
- Darwin platform files, MLX behavior, Electron activation behavior, app
  bundle configuration, entitlements, signing, notarization, DMG, updater, and
  release publishing remain present.
- Linux `/proc`, sysfs, systemd, Docker GPU, vLLM, and SGLang paths remain
  present.
- No Windows assumption replaces a portable or existing platform-specific
  implementation.
- Every implementation milestone is a separate conventional commit.

## Explicitly deferred

- Publishing or signing a Windows release.
- Changing branding or licensing.
- Claiming native Windows vLLM or SGLang support.
- Claiming native Windows exllamav3 until an independent experimental gate
  passes.
- Broad architecture rewrites unrelated to an observed platform boundary.

## Milestone 9 - Explicit WSL2 inference bridge

This milestone was requested after the initial Windows acceptance completed.
It does not change the native engine matrix: vLLM and SGLang remain Linux
engines, while llama.cpp remains the native Windows engine.

Status: bridge implementation and host-level lifecycle acceptance complete.
Milestone 10 supersedes this milestone's distribution-termination policy and
completes real vLLM/SGLang model inference acceptance.

Scope:

- Add `wsl2` as an explicit recipe and compute runtime, never as an alias for a
  Windows process runtime.
- Discover installed WSL2 distributions without starting them and expose
  opt-in vLLM/SGLang runtime targets for each eligible distribution.
- Start the selected Linux engine only when a WSL2 recipe is launched.
- Translate Windows drive paths through the selected distribution's `wslpath`
  at launch time; preserve Linux-native model paths unchanged.
- Supervise the Linux PID and process group inside the distribution, including
  ownership, TERM/KILL escalation, logs, health, cancellation, and stale-record
  recovery.
- Forward the selected Windows GPU UUIDs through the WSL environment while
  retaining the existing controller GPU lease.
- Keep the distro alive if it was already running before Local Studio. When the
  bridge started a stopped distro, terminate it after eviction by default so
  its VM memory is released; allow operators to disable this policy.
- Do not edit `.wslconfig` automatically. Document Microsoft's
  `autoMemoryReclaim` option as an independent global WSL policy.
- Keep llama.cpp, MLX, Docker, native process, remote-controller, macOS, and
  Linux launch behavior unchanged.

Tests:

- UTF-16/NUL WSL command-output and distribution-list parsing fixtures.
- WSL command construction, argument isolation, path translation, PID identity,
  log isolation, and conditional distro termination policy tests.
- Recipe serialization and UI runtime-option tests proving `wsl2` is labeled
  explicitly and only offered for vLLM/SGLang.
- Real Windows/Ubuntu smoke using a small Linux HTTP fixture: stopped distro,
  translated non-C: path, Windows localhost health, logs, stop, and distro
  memory teardown. Repeat recovery from a second controller process using the
  persisted Linux process identity.

Acceptance:

- Merely opening Configure does not start a stopped WSL distribution.
- A vLLM/SGLang recipe explicitly names `wsl2`, its distro, and Linux binary.
- Launch, proxy health, logs, cancellation, eviction, and restart recovery work
  through the Linux PID rather than trusting the transient `wsl.exe` proxy PID.
- A distro started by the bridge returns to `Stopped` after eviction under the
  default policy; a distro that was already running is not terminated.
- Unsupported or missing distros/binaries fail with a precise capability error.

Acceptance result:

- Configure/runtime-target discovery left stopped distributions stopped and
  excluded Docker-owned distributions.
- Ubuntu launched the fixture only after an explicit WSL2 recipe launch,
  translated an `F:` path containing spaces and Unicode, preserved Unicode
  environment data, exposed health through Windows localhost, and captured the
  Linux log.
- Linux PID identity survived controller exit and was recovered by a second
  controller process for health, ownership, logs, and eviction.
- Default cleanup terminated only the distribution started by the bridge; an
  already-running Ubuntu instance was preserved. The bridge never used global
  `wsl --shutdown` or modified `.wslconfig`.
- Both host NVIDIA GPUs were visible inside Ubuntu. The absent `vllm` executable
  produced a launch failure and cleanup without claiming engine support.

## Milestone 10 - Managed WSL2 vLLM and SGLang runtimes

This milestone adds interface-managed Linux packages without changing the
native Windows engine matrix. It supersedes only Milestone 9's optional
distribution-termination policy: Local Studio will no longer terminate any WSL
distribution when an engine stops.

Status: implementation, Settings workflow, real inference, lifecycle, Docker
isolation, and final cleanup acceptance complete.

Scope:

- Represent each vLLM/SGLang and WSL2-distribution pair as an available target
  until its isolated managed environment has passed an install probe.
- Keep managed environments in the selected distribution's Linux filesystem,
  separate by engine. Never install into the distribution's system Python or a
  Windows-mounted virtual environment.
- Persist a controller-side receipt only after successful activation so target
  discovery can report managed state without starting a stopped distribution.
- Install or update through the existing runtime-job API and Settings interface.
  Resolve the distribution's Python and installer explicitly, stage the new
  environment, probe its import, version, CLI, and CUDA visibility, then replace
  the managed environment.
- Add a target-scoped uninstall job and Settings action. Remove only the exact
  Local Studio managed environment and receipt after validating their identity.
- Refuse uninstall while the matching managed engine is running.
- Stop only the Linux engine process group. Never call `wsl --terminate` or
  `wsl --shutdown`, including after launch failure, cancellation, eviction, or
  controller shutdown.
- Preserve native llama.cpp, Docker targets, remote controllers, macOS, and
  Linux behavior.

Tests:

- Receipt parsing, target state, managed path validation, install command
  construction, staged activation, uninstall scope, and failure cleanup.
- Runtime-job contract and route tests for install, update, and uninstall.
- Settings tests proving that each explicit WSL2 target offers Install/Update
  and Remove without restoring native Windows Python installation rows.
- Launcher tests proving every cleanup path omits distribution termination.
- Real Windows/Ubuntu acceptance for both engines: Settings-driven install,
  package/CLI/CUDA probes, model-server launch, health, OpenAI-compatible request,
  engine stop, managed uninstall, and absence verification.
- Record the Docker Desktop process identities and running distribution before
  acceptance; assert they survive every engine stop and uninstall unchanged.

Acceptance:

- Configure does not start a stopped distribution and reports receipt-backed
  managed installation state accurately.
- vLLM and SGLang can each be installed, updated, and uninstalled using the same
  controller API invoked by the interface.
- Each engine serves a real model through its WSL2 target and stops without an
  orphaned engine process.
- No engine lifecycle or package operation terminates any WSL distribution.
- Docker Desktop remains running with the same sentinel processes throughout
  real-host acceptance.
- Both managed environments and receipts are absent after the final test.

Acceptance result:

- Settings showed explicit Ubuntu vLLM and SGLang targets with Install, Update,
  and Remove. Both install jobs completed from button clicks; both final Remove
  jobs returned their cards to `available / Install`.
- vLLM 0.27.0 and SGLang 0.5.9 each used a private managed Python 3.12 and
  virtual environment under `/home/pipeline/.local/share/local-studio`.
- vLLM served `HuggingFaceTB/SmolLM2-135M-Instruct` through port 8000 and
  returned an OpenAI-compatible chat completion. SGLang served the same model
  through port 30000 and returned an OpenAI-compatible chat completion.
- SGLang CUDA 13 activation used the matching upstream `sgl_kernel` wheel and
  passed a real kernel import before its receipt was written.
- Each controller stop removed only the recorded Linux engine process. Ubuntu
  and `docker-desktop` remained running immediately afterward, and all eight
  Docker Desktop sentinel process identities were unchanged.
- Final cleanup removed both managed environments, their receipts, temporary
  staging/backup paths, isolated model/kernel caches, and the Windows acceptance
  data directory. The shared `uv` cache was deliberately preserved.
