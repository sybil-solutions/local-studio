import type { ChildProcess } from "node:child_process";
import { runCommandAsync } from "../../../core/command";
import type { RuntimeUpgradeResult } from "@local-studio/contracts/system";

const normalizeEnvironmentCommand = (envKey: string): string | null => {
  const value = process.env[envKey]?.trim();
  return value && value.length > 0 ? value : null;
};

const UPGRADE_COMMAND_TIMEOUT_MS = 10 * 60_000;

export const runEnvironmentUpgradeCommand = async (
  command: string,
  onSpawn?: ((child: ChildProcess) => void) | undefined,
  timeoutMs: number = UPGRADE_COMMAND_TIMEOUT_MS,
): Promise<RuntimeUpgradeResult> => {
  const result = await runCommandAsync(command, [], { timeoutMs, onSpawn });
  if (result.status === 0) {
    return {
      success: true,
      version: null,
      output: result.stdout || null,
      error: result.stderr || null,
      used_command: command,
    };
  }
  return {
    success: false,
    version: null,
    output: result.stdout || null,
    error: result.timedOut
      ? `Upgrade command timed out after ${Math.round(timeoutMs / 60_000)} minutes`
      : result.stderr || "Upgrade command failed",
    used_command: command,
  };
};

const normalizeTextOrDefault = (envKey: string, fallbackValue: string): string => {
  const value = process.env[envKey]?.trim();
  return value && value.length > 0 ? value : fallbackValue;
};

export const LLAMACPP_UPGRADE_ENV = "LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD";
export const SGLANG_UPGRADE_ENV = "LOCAL_STUDIO_SGLANG_UPGRADE_CMD";
export const VLLM_UPGRADE_ENV = "LOCAL_STUDIO_VLLM_UPGRADE_CMD";
export const CUDA_UPGRADE_ENV = "LOCAL_STUDIO_CUDA_UPGRADE_CMD";
export const ROCM_UPGRADE_ENV = "LOCAL_STUDIO_ROCM_UPGRADE_CMD";
export const VLLM_UPGRADE_VERSION_ENV = "LOCAL_STUDIO_VLLM_UPGRADE_VERSION";
// Empty default means "upgrade the controller-owned runtime to the package
// manager's latest vLLM" instead of showing a stale hard-coded target as if it
// were the installed version.
const DEFAULT_VLLM_UPGRADE_VERSION = "";

export const getUpgradeCommandFromEnvironment = (envKey: string): string | null =>
  normalizeEnvironmentCommand(envKey);

export const getVllmUpgradeVersion = (): string =>
  normalizeTextOrDefault(VLLM_UPGRADE_VERSION_ENV, DEFAULT_VLLM_UPGRADE_VERSION);

export const isUpgradeCommandConfigured = (envKey: string): boolean =>
  Boolean(getUpgradeCommandFromEnvironment(envKey));
