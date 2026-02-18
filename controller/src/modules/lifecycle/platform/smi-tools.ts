import type { RuntimeGpuMonitoringTool, RuntimeRocmSmiTool } from "../types";
import { resolveBinary } from "../../../core/command";

type SmiPathEnv = "NVIDIA_SMI_PATH" | "AMD_SMI_PATH" | "ROCM_SMI_PATH";

const resolveConfiguredBinary = (envKey: SmiPathEnv, fallback: string): string | null => {
  const configured = process.env[envKey]?.trim();
  return resolveBinary(configured && configured.length > 0 ? configured : fallback);
};

export const resolveNvidiaSmiBinary = (): string | null =>
  resolveConfiguredBinary("NVIDIA_SMI_PATH", "nvidia-smi");

export const resolveAmdSmiBinary = (): string | null =>
  resolveConfiguredBinary("AMD_SMI_PATH", "amd-smi");

export const resolveRocmSmiBinary = (): string | null =>
  resolveConfiguredBinary("ROCM_SMI_PATH", "rocm-smi");

export const resolveForcedGpuMonitoringTool = (): RuntimeGpuMonitoringTool | null => {
  const forced = process.env["VLLM_STUDIO_GPU_SMI_TOOL"]?.trim();
  if (forced === "nvidia-smi" || forced === "amd-smi" || forced === "rocm-smi") {
    return forced;
  }
  return null;
};

export const resolveForcedRocmTool = (): RuntimeRocmSmiTool | null => {
  const forced = resolveForcedGpuMonitoringTool();
  return forced === "amd-smi" || forced === "rocm-smi" ? forced : null;
};
