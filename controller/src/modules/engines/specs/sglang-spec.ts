import { existsSync } from "node:fs";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsync } from "../../../core/command";
import type { ProcessInfo, Recipe } from "../../models/types";
import type {
  RuntimeBackendInfo,
  RuntimeUpgradeResult,
} from "@local-studio/contracts/system";
import {
  getDefaultReasoningParser,
  getDefaultToolCallParser,
} from "../process/model-runtime-defaults";
import { appendExtraArguments, getExtraArgument, getPythonPath } from "../process/backend-builder";
import { stripForeignFlagKeys } from "@local-studio/contracts/engine-args";
import {
  extractFlag,
  hasCliServeInvocation,
  hasModuleInvocation,
  positionalAfterServe,
} from "../argument-utilities";
import type {
  BinaryProbeResult,
  ConfigHelpResult,
  EngineSpec,
  InstallOptions,
} from "../engine-spec";
import { installIntoManagedVenv, managedVenvPython, venvConsoleScriptPath } from "../runtimes/managed-venv";
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

/**
 * Resolve the SGLang CLI binary from a Python path's venv.
 * SGLang's pip package installs a `sglang` console script alongside `python`.
 */
const resolveSglangCliBinary = (pythonPath: string | null): string | null => {
  if (!pythonPath) return null;
  const sglangBin = venvConsoleScriptPath(pythonPath, "sglang");
  return existsSync(sglangBin) ? sglangBin : null;
};

/** Engine args shared by the native launch and the environment container:
 * everything after the `sglang serve` / `launch_server` head. */
export const buildSglangRecipeArguments = (recipe: Recipe): string[] => {
  const command: string[] = ["--model-path", recipe.model_path];
  command.push("--host", recipe.host, "--port", String(recipe.port));

  if (recipe.served_model_name) {
    command.push("--served-model-name", recipe.served_model_name);
  }
  if (recipe.tensor_parallel_size > 1) {
    command.push("--tensor-parallel-size", String(recipe.tensor_parallel_size));
  }
  if (recipe.pipeline_parallel_size > 1) {
    command.push("--pipeline-parallel-size", String(recipe.pipeline_parallel_size));
  }
  command.push("--context-length", String(recipe.max_model_len));
  command.push("--mem-fraction-static", String(recipe.gpu_memory_utilization));
  if (recipe.max_num_seqs > 0) {
    command.push("--max-running-requests", String(recipe.max_num_seqs));
  }
  if (recipe.trust_remote_code) {
    command.push("--trust-remote-code");
  }
  if (recipe.quantization) {
    command.push("--quantization", recipe.quantization);
  }
  if (recipe.dtype) {
    command.push("--dtype", recipe.dtype);
  }
  if (recipe.kv_cache_dtype && recipe.kv_cache_dtype !== "auto") {
    command.push("--kv-cache-dtype", recipe.kv_cache_dtype);
  }
  if (getExtraArgument(recipe.extra_args, "enable-metrics") === undefined) {
    command.push("--enable-metrics");
  }

  const toolCallParser =
    recipe.tool_call_parser !== null ? recipe.tool_call_parser : getDefaultToolCallParser(recipe);
  if (toolCallParser) {
    command.push("--tool-call-parser", toolCallParser);
  }
  const reasoningParser =
    recipe.reasoning_parser !== null ? recipe.reasoning_parser : getDefaultReasoningParser(recipe);
  if (reasoningParser) {
    command.push("--reasoning-parser", reasoningParser);
  }

  return appendExtraArguments(command, stripForeignFlagKeys("sglang", recipe.extra_args));
};

const buildSglangCommand = (recipe: Recipe, config: Config): string[] => {
  const recipePython = getPythonPath(recipe) ?? null;
  const managedPython = managedVenvPython(config, "sglang");
  const resolvedManagedPython = existsSync(managedPython) ? managedPython : null;
  const python = recipePython || config.sglang_python || resolvedManagedPython || "python";
  const cliBinary =
    resolveSglangCliBinary(recipePython) ??
    resolveSglangCliBinary(config.sglang_python ?? null) ??
    resolveSglangCliBinary(resolvedManagedPython);
  const head =
    cliBinary && existsSync(cliBinary)
      ? [cliBinary, "serve"]
      : [python, "-m", "sglang.launch_server"];
  return [...head, ...buildSglangRecipeArguments(recipe)];
};

// `sglang[all]` (not bare `sglang`) so the server runtime, tokenizer, and all backends are pulled in.
const managedPackageSpec = (version?: string | null): string =>
  normalizePackageSpec("sglang[all]", version);

const detectInvocation = (args: string[]): boolean => {
  if (hasModuleInvocation(args, "sglang.launch_server")) return true;
  if (hasCliServeInvocation(args, "sglang")) return true;
  return false;
};

const extractModelPath = (args: string[]): string | null => {
  const flagModelPath = extractFlag(args, "--model-path");
  if (flagModelPath) return flagModelPath;
  const flagModel = extractFlag(args, "--model");
  if (flagModel) return flagModel;
  // sglang serve CLI may use positional model path
  return positionalAfterServe(args);
};

const extractServedModelName = (args: string[]): string | null => {
  return extractFlag(args, "--served-model-name") ?? null;
};

/**
 * Probe the `sglang` CLI binary for version info.
 * Mirrors probeVllmBinaryRuntime but for SGLang.
 */
const probeBinary = async (binary: string): Promise<BinaryProbeResult> => {
  const version = await runCommandAsync(binary, ["--version"], { timeoutMs: 5_000 });
  if (version.status === 0) {
    // SGLang --version output format: "sglang, version X.Y.Z"
    const match = version.stdout.match(/(\d+(?:\.\d+){1,3}[A-Za-z0-9.+-]*)/);
    return {
      installed: true,
      version: match?.[1] ?? (version.stdout.trim() || null),
      binaryPath: binary,
    };
  }
  // Fall back to --help check
  const help = await runCommandAsync(binary, ["--help"], { timeoutMs: 5_000 });
  if (help.status === 0) {
    return {
      installed: true,
      version: null,
      binaryPath: binary,
    };
  }
  return {
    installed: false,
    version: null,
    binaryPath: binary,
    message: version.stderr || "sglang binary is not runnable",
  };
};

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

const getRuntimeInfoAsync = async (
  config: Config,
  runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Promise<RuntimeBackendInfo> => {
  const runningPython =
    runningProcess?.backend === "sglang"
      ? await probeRunningProcessPython(runningProcess.pid)
      : null;
  const probe = await probeBackendRuntime("sglang", [
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
};

const getConfigHelp = async (config: Config): Promise<ConfigHelpResult> => {
  const sglangBin = resolveBinary("sglang");
  if (sglangBin) {
    const result = await runCommandAsync(sglangBin, ["serve", "--help"], { timeoutMs: 5_000 });
    if (result.status === 0) {
      return { config: result.stdout || null, error: null };
    }
  }

  const python = resolvePythonPath(config) ?? "python3";
  const result = await runCommandAsync(python, ["-m", "sglang.launch_server", "--help"], {
    timeoutMs: 5_000,
  });
  if (result.status !== 0) {
    return {
      config: result.stdout || null,
      error: result.stderr || "Failed to fetch SGLang config",
    };
  }
  return { config: result.stdout || null, error: null };
};

export const getSglangRuntimePython = (
  config: Config,
  options: { pythonPath?: string | null } = {},
): string => {
  return options.pythonPath?.trim() || config.sglang_python || resolveVllmPythonPath() || "python3";
};

const installSglang = async (options: InstallOptions): Promise<RuntimeUpgradeResult> => {
  const envCommand = getUpgradeCommandFromEnvironment(SGLANG_UPGRADE_ENV);
  if (envCommand) return runEnvironmentUpgradeCommand(envCommand, options.onSpawn);

  const packageSpec = managedPackageSpec(options.version);
  const pythonPath = options.pythonPath ?? getSglangRuntimePython(options.config);
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
  healthPath: "/health",
  cliBinary: "sglang",
  buildCommand: buildSglangCommand,
  managedPackageSpec,
  install: installSglang,
  detectInvocation,
  extractModelPath,
  extractServedModelName,
  probeBinary,
  resolvePythonPath,
  getRuntimeInfo: getRuntimeInfoAsync,
  getConfigHelp,
};
