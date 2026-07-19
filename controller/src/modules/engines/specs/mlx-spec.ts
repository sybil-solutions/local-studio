import { existsSync } from "node:fs";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import type { ProcessInfo, Recipe } from "../../models/types";
import type { RuntimeBackendInfo, RuntimeUpgradeResult } from "@local-studio/contracts/system";
import { appendExtraArguments, getPythonPath } from "../process/backend-builder";
import { stripForeignFlagKeys } from "@local-studio/contracts/engine-args";
import { extractFlag, hasModuleInvocation } from "../argument-utilities";
import type { EngineSpec, InstallOptions } from "../engine-spec";
import { installIntoManagedVenv, managedVenvPython } from "../runtimes/managed-venv";
import { probeBackendRuntime, probeRunningProcessPython } from "../runtimes/runtime-target-probes";

const buildMlxCommand = (recipe: Recipe, config: Config): string[] => {
  const managedPython = managedVenvPython(config, "mlx");
  const python =
    getPythonPath(recipe) ||
    config.mlx_python ||
    (existsSync(managedPython) ? managedPython : "python3");
  const command = [python, "-m", "mlx_lm.server"];
  command.push("--model", recipe.model_path, "--host", recipe.host, "--port", String(recipe.port));
  return appendExtraArguments(command, stripForeignFlagKeys("mlx", recipe.extra_args));
};

const managedPackageSpec = (_version?: string | null): string => {
  return "mlx-lm";
};

const detectInvocation = (args: string[]): boolean => {
  const joined = args.join(" ");
  if (joined.includes("mlx_lm.server") || joined.includes("mlx-lm")) return true;
  if (hasModuleInvocation(args, "mlx_lm.server")) return true;
  return false;
};

const extractModelPath = (args: string[]): string | null => {
  return extractFlag(args, "--model") ?? null;
};

const extractServedModelName = (_args: string[]): string | null => {
  return null;
};

const resolvePythonPath = (config: Config): string | null => {
  const explicit = process.env["LOCAL_STUDIO_MLX_PYTHON"]?.trim();
  if (explicit && existsSync(explicit)) return explicit;

  const managed = managedVenvPython(config, "mlx");
  return existsSync(managed) ? managed : null;
};

const getRuntimeInfo = (
  config: Config,
  runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Effect.Effect<RuntimeBackendInfo> =>
  Effect.gen(function* () {
    const runningPython =
      runningProcess?.backend === "mlx"
        ? yield* probeRunningProcessPython(runningProcess.pid)
        : null;
    const probe = yield* probeBackendRuntime("mlx", [
      runningPython,
      config.mlx_python,
      resolvePythonPath(config),
      "python3",
      "python",
    ]);
    return {
      installed: probe.installed,
      version: probe.version,
      python_path: probe.pythonPath ?? config.mlx_python ?? null,
      upgrade_command_available: false,
    };
  });

const installMlx = (options: InstallOptions): Effect.Effect<RuntimeUpgradeResult> => {
  const packageSpec = managedPackageSpec(options.version);
  const pythonPath = options.pythonPath ?? options.config.mlx_python ?? null;
  return installIntoManagedVenv({
    config: options.config,
    backend: "mlx",
    packageSpec,
    pythonPath,
    createManagedVenv: !pythonPath,
    onProgress: options.onProgress,
    onSpawn: options.onSpawn,
  });
};

export const mlxSpec: EngineSpec = {
  id: "mlx",
  healthPath: "/v1/models",
  cliBinary: null,
  buildCommand: buildMlxCommand,
  managedPackageSpec,
  install: installMlx,
  detectInvocation,
  extractModelPath,
  extractServedModelName,
  resolvePythonPath,
  getRuntimeInfo,
};
