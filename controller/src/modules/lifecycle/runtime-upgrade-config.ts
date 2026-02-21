// CRITICAL

const normalizeEnvCommand = (envKey: string): string | null => {
  const value = process.env[envKey]?.trim();
  return value && value.length > 0 ? value : null;
};

export const LLAMACPP_UPGRADE_ENV = "VLLM_STUDIO_LLAMACPP_UPGRADE_CMD";
export const CUDA_UPGRADE_ENV = "VLLM_STUDIO_CUDA_UPGRADE_CMD";
export const ROCM_UPGRADE_ENV = "VLLM_STUDIO_ROCM_UPGRADE_CMD";

export const getUpgradeCommandFromEnv = (envKey: string): string | null => normalizeEnvCommand(envKey);

export const isUpgradeCommandConfigured = (envKey: string): boolean => Boolean(getUpgradeCommandFromEnv(envKey));
