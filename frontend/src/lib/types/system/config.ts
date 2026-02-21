// CRITICAL
export interface ServiceInfo {
  name: string;
  port: number;
  internal_port: number;
  protocol: string;
  status: string;
  description: string | null;
}

export interface SystemConfig {
  host: string;
  port: number;
  inference_port: number;
  api_key_configured: boolean;
  models_dir: string;
  data_dir: string;
  db_path: string;
  sglang_python: string | null;
  tabby_api_dir: string | null;
  llama_bin: string | null;
}

export interface EnvironmentInfo {
  controller_url: string;
  inference_url: string;
  litellm_url: string;
  frontend_url: string;
}

export interface RuntimeBackendInfo {
  installed: boolean;
  version: string | null;
  python_path?: string | null;
  binary_path?: string | null;
  upgrade_command_available?: boolean;
}

export type RuntimePlatformKind = "cuda" | "rocm" | "unknown";

export type RuntimeRocmSmiTool = "amd-smi" | "rocm-smi";

export type RuntimeGpuMonitoringTool = "nvidia-smi" | RuntimeRocmSmiTool;

export interface RuntimeCudaInfo {
  driver_version: string | null;
  cuda_version: string | null;
  upgrade_command_available: boolean;
}

export interface RuntimeRocmInfo {
  rocm_version: string | null;
  hip_version: string | null;
  smi_tool: RuntimeRocmSmiTool | null;
  gpu_arch: string[];
  upgrade_command_available: boolean;
}

export interface RuntimeTorchBuildInfo {
  torch_version: string | null;
  torch_cuda: string | null;
  torch_hip: string | null;
}

export interface RuntimePlatformInfo {
  kind: RuntimePlatformKind;
  vendor: "nvidia" | "amd" | null;
  rocm: RuntimeRocmInfo | null;
  torch: RuntimeTorchBuildInfo;
}

export interface RuntimeGpuMonitoringInfo {
  available: boolean;
  tool: RuntimeGpuMonitoringTool | null;
}

export interface RuntimeGpuInfoSummary {
  count: number;
  types: string[];
}

export interface SystemRuntimeInfo {
  platform: RuntimePlatformInfo;
  gpu_monitoring: RuntimeGpuMonitoringInfo;
  cuda: RuntimeCudaInfo;
  gpus: RuntimeGpuInfoSummary;
  backends: {
    vllm: RuntimeBackendInfo;
    sglang: RuntimeBackendInfo;
    llamacpp: RuntimeBackendInfo;
  };
}

export interface ConfigData {
  config: SystemConfig;
  services: ServiceInfo[];
  environment: EnvironmentInfo;
  runtime: SystemRuntimeInfo;
}

export type CompatibilitySeverity = "info" | "warn" | "error";

export interface CompatibilityCheck {
  id: string;
  severity: CompatibilitySeverity;
  message: string;
  evidence: string | null;
  suggested_fix: string | null;
}

export interface CompatibilityReport {
  platform: {
    kind: RuntimePlatformKind;
  };
  gpu_monitoring: RuntimeGpuMonitoringInfo;
  torch: RuntimeTorchBuildInfo;
  backends: SystemRuntimeInfo["backends"];
  checks: CompatibilityCheck[];
}

export interface DeepResearchConfig {
  enabled: boolean;
  maxSources: number;
  searchDepth: "shallow" | "medium" | "deep";
  autoSummarize: boolean;
  includeCitations: boolean;
}
