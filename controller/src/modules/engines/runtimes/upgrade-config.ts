const normalizeEnvironmentCommand = (envKey: string): string | null => {
  const value = process.env[envKey]?.trim();
  return value && value.length > 0 ? value : null;
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
