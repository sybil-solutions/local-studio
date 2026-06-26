// Time to wait for a backend to report ready before declaring launch failure.
// Large MoE models in Docker (weights + AOT compile + full CUDA-graph capture)
// can take well over the 5-minute default, so allow an env override.
const parseReadyTimeoutMs = (): number => {
  const raw = process.env["LOCAL_STUDIO_READY_TIMEOUT_MS"];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
};
export const LIFECYCLE_READY_TIMEOUT_MS = parseReadyTimeoutMs();

export const DOWNLOAD_DEFAULT_IGNORE_FILENAMES = [".gitattributes", ".gitignore"];
export const DOWNLOAD_PROGRESS_THROTTLE_MS = 750;

export const DEFAULT_CANONICAL_PYTHON_PATH = "/opt/venvs/active/vllm-latest/bin/python";
export const VLLM_RUNTIME_COMMAND_TIMEOUT_MS = 10_000;
export const VLLM_UPGRADE_TIMEOUT_MS = 600_000;
export const LLAMACPP_HELP_TIMEOUT_MS = 15_000;
export const RUNTIME_UPGRADE_TIMEOUT_MS = 10 * 60_000;
// Managed first-installs pull large torch/CUDA wheels; give them longer than upgrades.
export const ENGINE_INSTALL_TIMEOUT_MS = 1_800_000;
