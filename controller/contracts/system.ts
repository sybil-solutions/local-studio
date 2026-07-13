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
  llama_bin: string | null;
  mlx_python: string | null;
}

export interface EnvironmentInfo {
  controller_url: string;
  inference_url: string;
  frontend_url: string;
}

export interface RuntimeBackendInfo {
  installed: boolean;
  version: string | null;
  python_path?: string | null;
  binary_path?: string | null;
  upgrade_command_available?: boolean;
}

export type EngineBackend = "vllm" | "sglang" | "llamacpp" | "mlx";

export type RuntimeKind = "venv" | "docker" | "binary" | "system";

export interface RuntimeTarget {
  id: string;
  backend: EngineBackend;
  kind: RuntimeKind;
  label: string;
  installed: boolean;
  active: boolean;
  version: string | null;
  pythonPath?: string | null;
  binaryPath?: string | null;
  dockerImage?: string | null;
  source: "configured" | "discovered" | "running" | "bundled";
  capabilities: {
    canLaunch: boolean;
    canUpdate: boolean;
    canInspectOptions: boolean;
    supportsDocker: boolean;
  };
  health: {
    status: "ok" | "warning" | "error" | "unknown";
    message?: string;
  };
  update?: {
    currentVersion: string | null;
    targetVersion: string;
    packageSpec: string;
    releaseNotesUrl: string;
    restartRequired: boolean;
    changes: string[];
  };
}

export interface EngineJob {
  id: string;
  backend: EngineBackend;
  targetId?: string;
  type: "install" | "update" | "download" | "inspect";
  status: "queued" | "running" | "success" | "error" | "cancelled";
  progress?: number;
  message: string;
  command?: string;
  startedAt: string;
  finishedAt?: string;
  outputTail?: string;
  error?: string;
}

export type RuntimePlatformKind = "cuda" | "rocm" | "unknown";

export type RuntimeRocmSmiTool = "amd-smi" | "rocm-smi";

export type RuntimeGpuMonitoringTool = "nvidia-smi" | "intel-sysfs" | RuntimeRocmSmiTool;

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

export type CompatibilitySeverity = "info" | "warn" | "error";

export interface CompatibilityCheck {
  id: string;
  severity: CompatibilitySeverity;
  message: string;
  evidence: string | null;
  suggested_fix: string | null;
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
    mlx?: RuntimeBackendInfo;
  };
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

export interface ConfigData {
  config: SystemConfig;
  services: ServiceInfo[];
  environment: EnvironmentInfo;
  runtime: SystemRuntimeInfo;
}

export interface RuntimeUpgradeResult {
  success: boolean;
  version: string | null;
  output: string | null;
  error: string | null;
  used_command: string | null;
}
