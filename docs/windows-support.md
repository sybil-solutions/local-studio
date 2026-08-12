# Windows support

Local Studio supports Windows 11 x64 as an additive platform port. The macOS
and Linux implementations remain the reference paths for their platforms.

## Supported Windows configuration

- Windows 11 x64
- Node.js 22.19+, npm 10+, Bun 1.3.14+, Python 3.10+, and Git
- Electron desktop UI and a controller running on the same machine
- PowerShell 7 when available, Windows PowerShell next, and `cmd.exe` as the
  final PTY fallback
- Native llama.cpp inference with CPU or NVIDIA CUDA release artifacts
- Model discovery, Hugging Face downloads, recipes, lifecycle, GPU telemetry,
  OpenAI-compatible proxying, logs, usage, settings, and local workspaces

The managed llama.cpp installer downloads the matching official Windows x64
release. On an NVIDIA host it installs the CUDA 12.4 archive and its companion
CUDA runtime archive together. A CUDA toolkit is not required for that binary
distribution, but a compatible NVIDIA driver and working `nvidia-smi` are.

Native vLLM and SGLang are not supported by this port. The Windows controller
offers them only through an explicitly selected WSL2 distribution or an
unchanged remote Linux controller. WSL2 is a distinct recipe runtime, not a
native Windows process disguised by the UI. MLX remains Apple Silicon-only, and
native Windows exllamav3 remains disabled until it passes an independent
experimental gate.

## Explicit WSL2 bridge

The bridge is opt-in and limited to vLLM and SGLang. Configure lists eligible
WSL2 distributions without starting them. Selecting or inspecting a target also
does not start WSL2; the selected distribution starts only when its recipe is
launched. llama.cpp continues to run natively on Windows and remote controllers
are unchanged.

Settings > System > Runtime engines exposes distribution-scoped Install,
Update, and Remove actions. Local Studio installs a dedicated Python 3.12 and
virtual environment below the selected Linux user's home directory; it does
not modify the distribution's system Python or place a virtual environment on
a Windows-mounted filesystem. The environment is staged, probed for its CLI,
CUDA, and GPU visibility, and activated only after validation. A controller-side
receipt records the exact managed path.

vLLM and SGLang remain separate Linux targets. The SGLang installer also aligns
its Torch CUDA wheels and selects the matching upstream `sgl_kernel` wheel
before activation. Installation does not make either engine a native Windows
capability.

The bridge supervises the Linux process group, persists Linux PID identity for
controller restart recovery, translates absolute Windows drive paths with the
selected distribution's `wslpath`, and captures the engine log in the Windows
controller data directory. UNC translation depends on the distribution's mount
and interoperability configuration and has not completed real-host acceptance.

Engine stop, cancellation, failed launch cleanup, eviction, controller shutdown,
and managed uninstall target only the recorded Linux engine process group and
PID file. Local Studio never calls `wsl --terminate` or `wsl --shutdown` and
never stops a distribution to reclaim memory. WSL may later stop an otherwise
idle distribution under its own lifecycle policy; Docker Desktop and other WSL
workloads are not controller-owned. Local Studio also never edits `.wslconfig`;
Microsoft's global WSL memory controls remain an independent operator choice.
See the official
[WSL command reference](https://learn.microsoft.com/en-us/windows/wsl/basic-commands)
and [advanced configuration reference](https://learn.microsoft.com/en-us/windows/wsl/wsl-config).

## Developer setup

From PowerShell in the repository root:

```powershell
npm run doctor
npm run setup
$env:LOCAL_STUDIO_MODELS_DIR = "F:\Local_Studio\models"
npm run desktop:dev
```

That one command starts the local controller on `127.0.0.1:8080`, the Next.js
frontend on `localhost:3000`, the Pi agent runtime, and the Electron window.
Press `Ctrl+C` in the same PowerShell window to stop the development stack.

The controller and browser frontend can still be run separately when needed:

```powershell
npm run dev:controller
npm run dev
```

Open <http://localhost:3000/setup>. The default controller is
`http://127.0.0.1:8080`. Set `LOCAL_STUDIO_MODELS_DIR` before starting the
controller to place model weights on another drive or share. Drive-letter,
backslash, spaces, Unicode, and UNC path forms are preserved by the application;
access to an actual UNC share still depends on the current user's share and NTFS
permissions.

## Controller startup

The Windows installer is per-user and does not require elevation:

```powershell
pwsh -ExecutionPolicy Bypass -File .\scripts\install-controller.ps1 -Action Install
pwsh -ExecutionPolicy Bypass -File .\scripts\install-controller.ps1 -Action Status
pwsh -ExecutionPolicy Bypass -File .\scripts\install-controller.ps1 -Action Restart
pwsh -ExecutionPolicy Bypass -File .\scripts\install-controller.ps1 -Action Update
pwsh -ExecutionPolicy Bypass -File .\scripts\install-controller.ps1 -Action Remove
```

It prefers a per-user Scheduled Task. If Windows policy denies task creation,
it falls back to the current user's `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
entry. The API key is stored in the installation `.env` file and is not placed
in the startup command or controller logs. Use `-InstallDir`, `-DataDir`,
`-ModelsDir`, `-HostAddress`, and `-Port` to override defaults.

The existing `scripts/install-controller.sh` remains the launchd/systemd
installer for macOS and Linux. Remote SSH deployment is unchanged.

## Windows desktop package

Build an unpacked developer package or an unsigned NSIS installer:

```powershell
npm --prefix frontend run desktop:pack:windows
npm --prefix frontend run desktop:dist:windows
npm --prefix frontend run desktop:smoke -- --app ".\frontend\dist-desktop\win-unpacked\Local Studio.exe" --expected-version 2.1.0
```

The package is intentionally unsigned and is not a published Windows release.
Windows signing, update-feed publication, and release automation are outside
this port. The existing macOS signing, notarization, DMG, updater, and release
flow is unchanged.

## Validation

```powershell
npm run check
npm run test:integration
```

The `windows-latest` CI job additionally installs locked dependencies, checks
the controller, agent runtime, and frontend, builds the application, creates an
unpacked Electron package, and runs its desktop smoke test without requiring a
GPU.

Real-host acceptance was completed on Windows x64 with an RTX 3090 and RTX
3080 Ti. It installed official llama.cpp `b10355`, downloaded a 105,454,432-byte
GGUF to an `F:` path containing spaces and Unicode, launched native CUDA
inference, served normal and SSE chat completions, recorded usage and logs, and
evicted the process tree cleanly. An ASCII-path NSIS install/smoke/uninstall also
passed. A bounded silent-install attempt to a custom destination containing
spaces and Unicode did not finish and was terminated, so that custom NSIS
destination is not yet claimed as validated.

The explicit WSL2 bridge was also exercised against Ubuntu on the same host. A
Linux HTTP fixture received a translated non-`C:` path containing spaces and
Unicode, preserved a Unicode environment value, became reachable through
Windows localhost, wrote controller-visible logs, and survived controller
restart recovery through its persisted Linux process identity.

Managed acceptance then installed vLLM 0.27.0 and SGLang 0.5.9 in separate
user-owned environments. Both detected the two WSL NVIDIA devices, served
`HuggingFaceTB/SmolLM2-135M-Instruct`, and returned OpenAI-compatible chat
completions through Windows localhost. The Settings interface completed
Install, Update, and Remove jobs for both Ubuntu targets. Final removal left
both managed paths and receipts absent and the cards returned to
`available / Install`.

Stopping either engine left Ubuntu and `docker-desktop` running immediately
after stop. All eight recorded Docker Desktop sentinel processes kept the same
PIDs and start times through engine launch, stop, update, install, and uninstall.
No acceptance step invoked distribution termination or global WSL shutdown.

## Deferred work

- Signed and published Windows releases and updater metadata
- Native Windows vLLM, SGLang, or exllamav3 claims
- Hardware CI; GPU parsers and capability decisions use fixtures in CI
- A live UNC-share acceptance run
