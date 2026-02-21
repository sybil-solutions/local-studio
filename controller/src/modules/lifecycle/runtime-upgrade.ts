// CRITICAL
import type { Config } from "../../config/env";
import { resolveBinary, runCommand } from "../../core/command";
import { getLlamacppRuntimeInfo, getSglangRuntimeInfo } from "./runtime-info";
import { getCudaInfo } from "./runtime-info";
import { getRocmInfo, resolveRocmSmiTool } from "./platform/rocm-info";
import { resolveVllmPythonPath } from "./vllm-python-path";
import {
  CUDA_UPGRADE_ENV,
  LLAMACPP_UPGRADE_ENV,
  SGLANG_UPGRADE_ENV,
  ROCM_UPGRADE_ENV,
  getUpgradeCommandFromEnvironment,
} from "./runtime-upgrade-config";

export interface RuntimeUpgradeResult {
  success: boolean;
  version: string | null;
  output: string | null;
  error: string | null;
  used_command: string | null;
}

export interface RuntimeUpgradeOptions {
  command?: string;
  args?: string[];
  version?: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

const resolveCommand = (command: string | undefined, envKey: string): string | null => {
  if (command?.trim()) {
    return command.trim();
  }
  return getUpgradeCommandFromEnvironment(envKey);
};

const parseCommandInput = (args: unknown): string[] | null => {
  if (!Array.isArray(args)) {
    return null;
  }
  const parsed = args
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return parsed.length > 0 ? parsed : null;
};

const runCommandUpgrade = (command: string, args: string[]): RuntimeUpgradeResult => {
  const result = runCommand(command, args, DEFAULT_TIMEOUT_MS);
  const success = result.status === 0;
  return {
    success,
    version: null,
    output: result.stdout || null,
    error: success ? null : result.stderr || "Upgrade command failed",
    used_command: `${command} ${args.join(" ")}`.trim(),
  };
};

export const getSglangRuntimePython = (config: Config): string => {
  return config.sglang_python || resolveVllmPythonPath() || "python3";
};

export const upgradeSglangRuntime = async (
  config: Config,
  options: RuntimeUpgradeOptions = {},
): Promise<RuntimeUpgradeResult> => {
  const command = resolveCommand(options.command, SGLANG_UPGRADE_ENV);
  const parsedArguments = parseCommandInput(options.args);
  const python = getSglangRuntimePython(config);
  if (command) {
    return runCommandUpgrade(command, parsedArguments ?? []);
  }

  const useUv = Boolean(resolveBinary("uv"));
  const args = useUv
    ? ["pip", "install", "--python", python, "--upgrade", "sglang"]
    : ["-m", "pip", "install", "--upgrade", "sglang"];

  const commandResult = runCommand(
    python,
    args,
    DEFAULT_TIMEOUT_MS,
  );
  const runtime = await getSglangRuntimeInfo(config);
  if (commandResult.status !== 0) {
    return {
      success: false,
      version: runtime.version,
      output: commandResult.stdout || null,
      error: commandResult.stderr || "Failed to upgrade SGLang",
      used_command: useUv
        ? `uv ${args.join(" ")}`
        : `${python} ${args.join(" ")}`,
    };
  }

  return {
    success: runtime.installed,
    version: runtime.version,
    output: commandResult.stdout || null,
    error: runtime.installed ? null : "Version check failed after upgrade",
    used_command: useUv ? `uv ${args.join(" ")}` : `${python} ${args.join(" ")}`,
  };
};

export const upgradeLlamacppRuntime = async (
  config: Config,
  options: RuntimeUpgradeOptions,
): Promise<RuntimeUpgradeResult> => {
  const command = resolveCommand(options.command, LLAMACPP_UPGRADE_ENV);
  if (!command) {
    return {
      success: false,
      version: null,
      output: null,
      error:
        "No llama.cpp upgrade command configured. Set VLLM_STUDIO_LLAMACPP_UPGRADE_CMD or provide command in request body.",
      used_command: null,
    };
  }

  const parsedArguments = parseCommandInput(options.args);
  const result = runCommandUpgrade(command, parsedArguments ?? []);
  const runtime = getLlamacppRuntimeInfo(config);

  return {
    ...result,
    success: result.success && runtime.installed,
    version: runtime.version,
  };
};

export const runPlatformUpgrade = (
  platform: "cuda" | "rocm",
  options: RuntimeUpgradeOptions,
): RuntimeUpgradeResult => {
  const envKey = platform === "cuda" ? CUDA_UPGRADE_ENV : ROCM_UPGRADE_ENV;
  const command = resolveCommand(options.command, envKey);
  if (!command) {
    return {
      success: false,
      version: null,
      output: null,
      error: `No ${platform.toUpperCase()} upgrade command configured. Set ${envKey} or provide command in request body.`,
      used_command: null,
    };
  }
  const parsedArguments = parseCommandInput(options.args);
  const result = runCommandUpgrade(command, parsedArguments ?? []);
  if (!result.success) {
    return result;
  }

  if (platform === "cuda") {
    const info = getCudaInfo();
    return {
      ...result,
      version: info.cuda_version || info.driver_version,
      output: result.output,
    };
  }

  const smiTool = resolveRocmSmiTool();
  const info = getRocmInfo(smiTool);
  return {
    ...result,
    version: info.rocm_version || info.hip_version,
    output: result.output,
  };
};
