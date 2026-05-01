import type { RecipeId } from "../../types/brand";
import type { Backend as SharedBackend, RecipeBase } from "../shared/recipe-types";
import type {
  ServiceInfo,
  SystemConfig,
  EnvironmentInfo,
  SystemRuntimeInfo,
} from "../shared/system-types";

export type {
  ServiceInfo,
  SystemConfig,
  EnvironmentInfo,
  RuntimeBackendInfo,
  RuntimePlatformKind,
  RuntimeRocmSmiTool,
  RuntimeGpuMonitoringTool,
  RuntimeCudaInfo,
  RuntimeRocmInfo,
  RuntimeTorchBuildInfo,
  RuntimePlatformInfo,
  RuntimeGpuMonitoringInfo,
  RuntimeGpuInfoSummary,
  CompatibilitySeverity,
  CompatibilityCheck,
  SystemRuntimeInfo,
  CompatibilityReport,
} from "../shared/system-types";

export type Backend = SharedBackend;

export interface Recipe extends Omit<RecipeBase, "id"> {
  id: RecipeId;
}

export interface ProcessInfo {
  pid: number;
  backend: Backend | "unknown";
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

export interface SystemConfigResponse {
  config: SystemConfig;
  services: ServiceInfo[];
  environment: EnvironmentInfo;
  runtime: SystemRuntimeInfo;
}

export interface ModelsModuleConfig {
  feature: "models";
}

export interface ModelBrowserRecord {
  id: string;
}

export interface ModelInfo {
  name: string;
  path: string;
  size_bytes: number | null;
  modified_at: number | null;
  architecture: string | null;
  quantization: string | null;
  context_length: number | null;
  recipe_ids: string[];
  has_recipe: boolean;
}
