// Merged configs from lifecycle/configs.ts and downloads/configs.ts

export const LIFECYCLE_MODULE_DEFAULTS = {
  modelStartTimeoutMs: 120_000,
};

export const LIFECYCLE_READY_TIMEOUT_MS = 300_000;

export const DOWNLOADS_MODULE_DEFAULTS = {
  concurrentDownloads: 2,
};

export const DOWNLOAD_DEFAULT_IGNORE_FILENAMES = [".gitattributes", ".gitignore"];
export const DOWNLOAD_PROGRESS_THROTTLE_MS = 750;

export const DEFAULT_CANONICAL_PYTHON_PATH = "/opt/venvs/active/vllm-latest/bin/python";
export const VLLM_RUNTIME_COMMAND_TIMEOUT_MS = 10_000;
export const VLLM_UPGRADE_TIMEOUT_MS = 600_000;
export const LLAMACPP_HELP_TIMEOUT_MS = 15_000;
export const RUNTIME_UPGRADE_TIMEOUT_MS = 10 * 60_000;