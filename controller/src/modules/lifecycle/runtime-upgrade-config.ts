// CRITICAL

const normalizeEnvironmentCommand = (envKey: string): string | null => {
  const value = process.env[envKey]?.trim();
  return value && value.length > 0 ? value : null;
};

const normalizeTextOrDefault = (envKey: string, fallbackValue: string): string => {
  const value = process.env[envKey]?.trim();
  return value && value.length > 0 ? value : fallbackValue;
};

export const LLAMACPP_UPGRADE_ENV = "VLLM_STUDIO_LLAMACPP_UPGRADE_CMD";
export const SGLANG_UPGRADE_ENV = "VLLM_STUDIO_SGLANG_UPGRADE_CMD";
export const VLLM_UPGRADE_ENV = "VLLM_STUDIO_VLLM_UPGRADE_CMD";
export const CUDA_UPGRADE_ENV = "VLLM_STUDIO_CUDA_UPGRADE_CMD";
export const ROCM_UPGRADE_ENV = "VLLM_STUDIO_ROCM_UPGRADE_CMD";
export const VLLM_UPGRADE_VERSION_ENV = "VLLM_STUDIO_VLLM_UPGRADE_VERSION";
const DEFAULT_VLLM_UPGRADE_VERSION = "0.15.1";

export const getUpgradeCommandFromEnvironment = (envKey: string): string | null =>
  normalizeEnvironmentCommand(envKey);

export const getVllmUpgradeVersion = (): string =>
  normalizeTextOrDefault(VLLM_UPGRADE_VERSION_ENV, DEFAULT_VLLM_UPGRADE_VERSION);

export const isUpgradeCommandConfigured = (envKey: string): boolean =>
  Boolean(getUpgradeCommandFromEnvironment(envKey));
