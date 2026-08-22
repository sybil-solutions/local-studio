import { existsSync } from "node:fs";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsyncEffect } from "../../../core/command";
import type { ProcessInfo } from "../../models/types";
import type { RuntimeBackendInfo, RuntimeUpgradeResult } from "@local-studio/contracts/system";
import type {
  BinaryProbeResult,
  ConfigHelpResult,
  EngineSpec,
  InstallOptions,
} from "../engine-spec";
import { installIntoManagedVenv, managedVenvPython } from "../runtimes/managed-venv";
import {
  getUpgradeCommandFromEnvironment,
  runEnvironmentUpgradeCommand,
  SGLANG_UPGRADE_ENV,
} from "../runtimes/upgrade-config";
import { resolveVllmPythonPath } from "../runtimes/vllm-python-path";
import {
  normalizePackageSpec,
  probeBackendRuntime,
  probeRunningProcessPython,
  resolvePythonFromScript,
} from "../runtimes/runtime-target-probes";

const managedPackageSpec = (version?: string | null): string =>
  normalizePackageSpec("sglang[all]", version);

const probeBinary = (binary: string): Effect.Effect<BinaryProbeResult> =>
  Effect.gen(function* () {
    const version = yield* runCommandAsyncEffect(binary, ["--version"], { timeoutMs: 5_000 });
    if (version.status === 0) {
      const match = version.stdout.match(/(\d+(?:\.\d+){1,3}[A-Za-z0-9.+-]*)/);
      return {
        installed: true,
        version: match?.[1] ?? (version.stdout.trim() || null),
        binaryPath: binary,
      };
    }
    const help = yield* runCommandAsyncEffect(binary, ["--help"], { timeoutMs: 5_000 });
    if (help.status === 0) {
      return { installed: true, version: null, binaryPath: binary };
    }
    return {
      installed: false,
      version: null,
      binaryPath: binary,
      message: version.stderr || "sglang binary is not runnable",
    };
  });

const resolvePythonPath = (config: Config): string | null => {
  const explicit = process.env["LOCAL_STUDIO_SGLANG_PYTHON"]?.trim();
  if (explicit && existsSync(explicit)) return explicit;

  const managedCandidates = [
    managedVenvPython(config, "sglang"),
    "/opt/venvs/active/sglang-latest/bin/python",
    "/opt/venvs/sglang-latest/bin/python",
  ];
  for (const candidate of managedCandidates) {
    if (existsSync(candidate)) return candidate;
  }

  return resolvePythonFromScript(resolveBinary("sglang"));
};

const getRuntimeInfo = (
  config: Config,
  runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Effect.Effect<RuntimeBackendInfo> =>
  Effect.gen(function* () {
    const runningPython =
      runningProcess?.backend === "sglang"
        ? yield* probeRunningProcessPython(runningProcess.pid)
        : null;
    const probe = yield* probeBackendRuntime("sglang", [
      runningPython,
      config.sglang_python,
      resolvePythonPath(config),
      "python3",
      "python",
    ]);
    return {
      installed: probe.installed,
      version: probe.version,
      python_path: probe.pythonPath ?? config.sglang_python ?? null,
      upgrade_command_available: probe.runnable,
    };
  });

const getConfigHelp = (config: Config): Effect.Effect<ConfigHelpResult> =>
  Effect.gen(function* () {
    const sglangBin = resolveBinary("sglang");
    if (sglangBin) {
      const result = yield* runCommandAsyncEffect(sglangBin, ["serve", "--help"], {
        timeoutMs: 5_000,
      });
      if (result.status === 0) return { config: result.stdout || null, error: null };
    }
    const python = resolvePythonPath(config) ?? "python3";
    const result = yield* runCommandAsyncEffect(python, ["-m", "sglang.launch_server", "--help"], {
      timeoutMs: 5_000,
    });
    if (result.status !== 0) {
      return {
        config: result.stdout || null,
        error: result.stderr || "Failed to fetch SGLang config",
      };
    }
    return { config: result.stdout || null, error: null };
  });

const installSglang = (options: InstallOptions): Effect.Effect<RuntimeUpgradeResult> => {
  const envCommand = getUpgradeCommandFromEnvironment(SGLANG_UPGRADE_ENV);
  if (envCommand) return runEnvironmentUpgradeCommand(envCommand, options.onSpawn);

  const packageSpec = managedPackageSpec(options.version);
  const pythonPath =
    options.pythonPath ?? (options.config.sglang_python || resolveVllmPythonPath() || "python3");
  return installIntoManagedVenv({
    config: options.config,
    backend: "sglang",
    packageSpec,
    pythonPath,
    createManagedVenv: !options.pythonPath,
    onProgress: options.onProgress,
    onSpawn: options.onSpawn,
  });
};

export const sglangSpec: EngineSpec = {
  id: "sglang",
  cliBinary: "sglang",
  managedPackageSpec,
  install: installSglang,
  probeBinary,
  resolvePythonPath,
  getRuntimeInfo,
  getConfigHelp,
};
