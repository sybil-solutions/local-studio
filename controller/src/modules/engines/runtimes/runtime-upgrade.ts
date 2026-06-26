import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsync } from "../../../core/command";
import { getLlamacppRuntimeInfo, getCudaInfo } from "./runtime-info";
import { getRocmInfo, resolveRocmSmiTool } from "../../system/platform/rocm-info";
import { resolveVllmPythonPath } from "./vllm-python-path";
import { probePythonRuntime } from "./runtime-target-probes";
import type { RuntimeUpgradeResult } from "../../../../../shared/contracts/system";
import {
  CUDA_UPGRADE_ENV,
  LLAMACPP_UPGRADE_ENV,
  SGLANG_UPGRADE_ENV,
  ROCM_UPGRADE_ENV,
  getUpgradeCommandFromEnvironment,
} from "./upgrade-config";
import { RUNTIME_UPGRADE_TIMEOUT_MS } from "../configs";

export type { RuntimeUpgradeResult } from "../../../../../shared/contracts/system";

export interface RuntimeUpgradeOptions {
  version?: string;
  pythonPath?: string | null;
}

const resolveCommand = (envKey: string): string | null =>
  getUpgradeCommandFromEnvironment(envKey);

const upgradeTimeoutMessage = (): string =>
  `Upgrade command timed out after ${Math.round(RUNTIME_UPGRADE_TIMEOUT_MS / 60_000)} minutes`;

const runCommandUpgrade = async (command: string, args: string[]): Promise<RuntimeUpgradeResult> => {
  const result = await runCommandAsync(command, args, { timeoutMs: RUNTIME_UPGRADE_TIMEOUT_MS });
  const success = result.status === 0;
  return {
    success,
    version: null,
    output: result.stdout || null,
    error: success
      ? null
      : result.timedOut
        ? upgradeTimeoutMessage()
        : result.stderr || "Upgrade command failed",
    used_command: `${command} ${args.join(" ")}`.trim(),
  };
};

export const getSglangRuntimePython = (
  config: Config,
  options: Pick<RuntimeUpgradeOptions, "pythonPath"> = {}
): string => {
  return options.pythonPath?.trim() || config.sglang_python || resolveVllmPythonPath() || "python3";
};

export const upgradeSglangRuntime = async (
  config: Config,
  options: RuntimeUpgradeOptions = {}
): Promise<RuntimeUpgradeResult> => {
  const command = resolveCommand(SGLANG_UPGRADE_ENV);
  const python = getSglangRuntimePython(config, options);
  if (command) return runCommandUpgrade(command, []);
  const uv = resolveBinary("uv");
  const args = uv
    ? ["pip", "install", "--python", python, "--upgrade", "sglang"]
    : ["-m", "pip", "install", "--upgrade", "sglang"];
  const commandResult = await runCommandAsync(uv ?? python, args, {
    timeoutMs: RUNTIME_UPGRADE_TIMEOUT_MS,
  });
  const runtime = await probePythonRuntime("sglang", python);
  const usedCommand = uv ? `${uv} ${args.join(" ")}` : `${python} ${args.join(" ")}`;
  if (commandResult.status !== 0) {
    return {
      success: false,
      version: runtime.version,
      output: commandResult.stdout || null,
      error: commandResult.timedOut
        ? upgradeTimeoutMessage()
        : commandResult.stderr || "Failed to upgrade SGLang",
      used_command: usedCommand,
    };
  }
  return {
    success: runtime.installed,
    version: runtime.version,
    output: commandResult.stdout || null,
    error: runtime.installed ? null : "Version check failed after upgrade",
    used_command: usedCommand,
  };
};

export const upgradeLlamacppRuntime = async (
  config: Config,
  _options: RuntimeUpgradeOptions
): Promise<RuntimeUpgradeResult> => {
  const command = resolveCommand(LLAMACPP_UPGRADE_ENV);
  if (!command)
    return {
      success: false,
      version: null,
      output: null,
      error: "No llama.cpp upgrade command configured. Set LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD.",
      used_command: null,
    };
  const result = await runCommandUpgrade(command, []);
  const runtime = getLlamacppRuntimeInfo(config);
  return { ...result, success: result.success && runtime.installed, version: runtime.version };
};

export const runPlatformUpgrade = async (
  platform: "cuda" | "rocm",
  _options: RuntimeUpgradeOptions
): Promise<RuntimeUpgradeResult> => {
  const envKey = platform === "cuda" ? CUDA_UPGRADE_ENV : ROCM_UPGRADE_ENV;
  const command = resolveCommand(envKey);
  if (!command)
    return {
      success: false,
      version: null,
      output: null,
      error: `No ${platform.toUpperCase()} upgrade command configured. Set ${envKey}.`,
      used_command: null,
    };
  const result = await runCommandUpgrade(command, []);
  if (!result.success) return result;
  if (platform === "cuda") {
    const info = getCudaInfo();
    return { ...result, version: info.cuda_version || info.driver_version, output: result.output };
  }
  const smiTool = resolveRocmSmiTool();
  const info = getRocmInfo(smiTool);
  return { ...result, version: info.rocm_version || info.hip_version, output: result.output };
};
