import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsyncEffect } from "../../../core/command";
import type { RuntimeUpgradeResult, EngineBackend } from "@local-studio/contracts/system";
import { ENGINE_INSTALL_TIMEOUT_MS, RUNTIME_UPGRADE_TIMEOUT_MS } from "../configs";
import { probePythonRuntime } from "./runtime-target-probes";

export type ManagedPythonBackend = Extract<EngineBackend, "vllm" | "sglang" | "mlx">;

export const isManagedPythonBackend = (
  backend: EngineBackend | string,
): backend is ManagedPythonBackend =>
  backend === "vllm" || backend === "sglang" || backend === "mlx";

export const managedVenvName = (backend: ManagedPythonBackend): string => `${backend}-latest`;

export const managedVenvPath = (
  config: Pick<Config, "data_dir">,
  backend: ManagedPythonBackend,
): string => join(config.data_dir, "runtime", "venvs", managedVenvName(backend));

export const venvPythonPath = (venvDirectory: string): string =>
  process.platform === "win32"
    ? join(venvDirectory, "Scripts", "python.exe")
    : join(venvDirectory, "bin", "python");

export const venvConsoleScriptPath = (pythonPath: string, scriptName: string): string =>
  process.platform === "win32"
    ? join(dirname(pythonPath), `${scriptName}.exe`)
    : join(dirname(pythonPath), scriptName);

export const managedVenvPython = (
  config: Pick<Config, "data_dir">,
  backend: ManagedPythonBackend,
): string => venvPythonPath(managedVenvPath(config, backend));

export interface InstallProgressUpdate {
  progress?: number;
  message?: string;
  outputTail?: string;
}

export interface ManagedInstallOptions {
  config: Config;
  backend: ManagedPythonBackend;
  packageSpec: string;
  pythonPath?: string | null | undefined;
  createManagedVenv?: boolean | undefined;
  installTimeoutMs?: number | undefined;
  onProgress?: ((update: InstallProgressUpdate) => void) | undefined;
  onSpawn?: ((child: ChildProcess) => void) | undefined;
}

const UV_INSTALL_HINT = "curl -LsSf https://astral.sh/uv/install.sh | sh";
const MAX_OUTPUT_TAIL_LENGTH = 4000;
const PIP_PREFLIGHT_TIMEOUT_MS = 10_000;
const JOB_OUTPUT_THROTTLE_MS = 1_000;

const tailOutput = (value: string): string =>
  value.length > MAX_OUTPUT_TAIL_LENGTH ? value.slice(-MAX_OUTPUT_TAIL_LENGTH) : value;

const timeoutMinutes = (timeoutMs: number): number => Math.round(timeoutMs / 60_000);

const createVenvEffect = (
  basePython: string,
  venvDirectory: string,
  options: ManagedInstallOptions,
): Effect.Effect<RuntimeUpgradeResult | null> =>
  Effect.gen(function* () {
    const venvPython = venvPythonPath(venvDirectory);
    if (existsSync(venvPython)) return null;
    mkdirSync(dirname(venvDirectory), { recursive: true });
    options.onProgress?.({ message: `Creating ${options.backend} virtual environment...` });
    const create = yield* runCommandAsyncEffect(basePython, ["-m", "venv", venvDirectory], {
      timeoutMs: RUNTIME_UPGRADE_TIMEOUT_MS,
      onSpawn: options.onSpawn,
    });
    if (create.status !== 0) {
      return {
        success: false,
        version: null,
        output: create.stdout || null,
        error: create.timedOut
          ? `Creating the ${options.backend} virtual environment timed out after ${timeoutMinutes(RUNTIME_UPGRADE_TIMEOUT_MS)} minutes`
          : create.stderr || `Failed to create managed ${options.backend} virtual environment`,
        used_command: `${basePython} -m venv ${venvDirectory}`,
      };
    }
    return null;
  });

const resolveInstallerEffect = (
  venvPython: string,
  packageSpec: string,
  options: ManagedInstallOptions,
): Effect.Effect<{ command: string; args: string[]; installer: string } | RuntimeUpgradeResult> =>
  Effect.gen(function* () {
    const uv = resolveBinary("uv");
    if (!uv) {
      const pipCheck = yield* runCommandAsyncEffect(venvPython, ["-m", "pip", "--version"], {
        timeoutMs: PIP_PREFLIGHT_TIMEOUT_MS,
        onSpawn: options.onSpawn,
      });
      if (pipCheck.status !== 0) {
        return {
          success: false,
          version: null,
          output: pipCheck.stdout || null,
          error: `Neither uv nor a working pip is available to install ${packageSpec}. Install uv with: ${UV_INSTALL_HINT}`,
          used_command: `${venvPython} -m pip --version`,
        };
      }
    }
    const installer = uv ? "uv" : "pip";
    const command = uv ?? venvPython;
    const args = uv
      ? ["pip", "install", "--python", venvPython, "--upgrade", packageSpec]
      : ["-m", "pip", "install", "--upgrade", packageSpec];
    return { command, args, installer };
  });

const installIntoManagedVenvEffect = (
  options: ManagedInstallOptions,
): Effect.Effect<RuntimeUpgradeResult> =>
  Effect.gen(function* () {
    const basePython = resolveBinary("python3") ?? resolveBinary("python");
    if (!basePython) {
      return {
        success: false,
        version: null,
        output: null,
        error: "Python 3 was not found on PATH",
        used_command: null,
      };
    }

    const venvDirectory = managedVenvPath(options.config, options.backend);
    const venvPython = venvPythonPath(venvDirectory);
    const targetPython = options.pythonPath ?? venvPython;

    if (options.createManagedVenv !== false && !options.pythonPath) {
      const venvFailure = yield* createVenvEffect(basePython, venvDirectory, options);
      if (venvFailure) return venvFailure;
    }

    const packageSpec = options.packageSpec;
    const installerResult = yield* resolveInstallerEffect(targetPython, packageSpec, options);
    if ("success" in installerResult) return installerResult;
    const { command, args, installer } = installerResult;
    const usedCommand = [command, ...args].join(" ");

    let outputTail = "";
    let progress = 0.2;
    let lastUpdateAt = 0;
    options.onProgress?.({ progress, message: `Installing ${packageSpec} with ${installer}...` });
    const installTimeout = options.installTimeoutMs ?? ENGINE_INSTALL_TIMEOUT_MS;
    const install = yield* runCommandAsyncEffect(command, args, {
      timeoutMs: installTimeout,
      onSpawn: options.onSpawn,
      onOutput: (chunk) => {
        outputTail = tailOutput(outputTail + chunk);
        const now = Date.now();
        if (now - lastUpdateAt < JOB_OUTPUT_THROTTLE_MS) return;
        lastUpdateAt = now;
        progress = Math.min(0.9, progress + 0.01);
        options.onProgress?.({
          progress,
          message: `Installing ${packageSpec} with ${installer}...`,
          outputTail,
        });
      },
    });
    if (install.status !== 0) {
      return {
        success: false,
        version: null,
        output: install.stdout || null,
        error: install.timedOut
          ? `Install of ${packageSpec} timed out after ${timeoutMinutes(installTimeout)} minutes. Retry the install; large torch/CUDA wheels are the usual cause.`
          : install.stderr || `Failed to install ${packageSpec}`,
        used_command: usedCommand,
      };
    }

    const probe = yield* Effect.promise(() => probePythonRuntime(options.backend, targetPython));
    return {
      success: probe.installed,
      version: probe.version,
      output: install.stdout || null,
      error: probe.installed ? null : (probe.message ?? `${options.backend} import probe failed`),
      used_command: usedCommand,
    };
  });

export const installIntoManagedVenv = (
  options: ManagedInstallOptions,
): Promise<RuntimeUpgradeResult> => Effect.runPromise(installIntoManagedVenvEffect(options));
