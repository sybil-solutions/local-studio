import { runCommandAsync } from "../../../core/command";
import { getCudaInfo } from "./runtime-info";
import { getRocmInfo, resolveRocmSmiTool } from "../../system/platform/rocm-info";
import type { RuntimeUpgradeResult } from "@local-studio/contracts/system";
import {
  CUDA_UPGRADE_ENV,
  getUpgradeCommandFromEnvironment,
  ROCM_UPGRADE_ENV,
} from "./upgrade-config";
import { RUNTIME_UPGRADE_TIMEOUT_MS } from "../configs";

export type { RuntimeUpgradeResult } from "@local-studio/contracts/system";

export interface RuntimeUpgradeOptions {
  version?: string;
  pythonPath?: string | null;
}

export { getSglangRuntimePython } from "../specs/sglang-spec";

const upgradeTimeoutMessage = (): string =>
  `Upgrade command timed out after ${Math.round(RUNTIME_UPGRADE_TIMEOUT_MS / 60_000)} minutes`;

export const runPlatformUpgrade = async (
  platform: "cuda" | "rocm",
  _options: RuntimeUpgradeOptions,
): Promise<RuntimeUpgradeResult> => {
  const envKey = platform === "cuda" ? CUDA_UPGRADE_ENV : ROCM_UPGRADE_ENV;
  const command = getUpgradeCommandFromEnvironment(envKey);
  if (!command)
    return {
      success: false,
      version: null,
      output: null,
      error: `No ${platform.toUpperCase()} upgrade command configured. Set ${envKey}.`,
      used_command: null,
    };
  const result = await runCommandAsync(command, [], {
    timeoutMs: RUNTIME_UPGRADE_TIMEOUT_MS,
  });
  const success = result.status === 0;
  if (!success) {
    return {
      success: false,
      version: null,
      output: result.stdout || null,
      error: result.timedOut ? upgradeTimeoutMessage() : result.stderr || "Upgrade command failed",
      used_command: command,
    };
  }
  if (platform === "cuda") {
    const info = getCudaInfo();
    return {
      success,
      version: info.cuda_version || info.driver_version,
      output: result.stdout || null,
      error: null,
      used_command: command,
    };
  }
  const smiTool = resolveRocmSmiTool();
  const info = getRocmInfo(smiTool);
  return {
    success,
    version: info.rocm_version || info.hip_version,
    output: result.stdout || null,
    error: null,
    used_command: command,
  };
};
