// CRITICAL
import type { RecipeId } from "../../types/brand";
import type { Backend as SharedBackend, RecipeBase } from "../../../../shared/src";

export type Backend = SharedBackend;

export interface Recipe extends Omit<RecipeBase, "id"> {
  id: RecipeId;
}

export interface ProcessInfo {
  pid: number;
  backend: string;
  model_path: string | null;
  port: number;
  served_model_name: string | null;
}

export interface LaunchResult {
  success: boolean;
  pid: number | null;
  message: string;
  log_file: string | null;
}

export interface HealthResponse {
  status: string;
  version: string;
  inference_ready: boolean;
  backend_reachable: boolean;
  running_model: string | null;
}

export interface GpuInfo {
  index: number;
  name: string;
  memory_total: number;
  memory_total_mb: number;
  memory_used: number;
  memory_used_mb: number;
  memory_free: number;
  memory_free_mb: number;
  utilization: number;
  utilization_pct: number;
  temperature: number;
  temp_c: number;
  power_draw: number;
  power_limit: number;
}

export interface ServiceInfo {
  name: string;
  port: number;
  internal_port: number;
  protocol: string;
  status: string;
  description?: string | null;
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

export interface SystemConfigResponse {
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
