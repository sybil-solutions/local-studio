import type { RecipeId } from "../../types/brand";
import type { Backend as SharedBackend, ModelInfo, RecipeBase } from "../shared/recipe-types";
import type { ProcessInfo as PublicProcessInfo } from "../../../../shared/contracts/observability";
import type {
  ServiceInfo,
  SystemConfig,
  EnvironmentInfo,
  SystemRuntimeInfo,
  ConfigData,
} from "../shared/system-types";

export type { ModelInfo } from "../shared/recipe-types";
export type {
  ServiceInfo,
  SystemConfig,
  EnvironmentInfo,
  RuntimeBackendInfo,
  EngineBackend,
  RuntimeKind,
  RuntimeTarget,
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
  ConfigData,
} from "../shared/system-types";

export interface ControllerRecipe extends Omit<RecipeBase, "id"> {
  id: RecipeId;
}

export type { ControllerRecipe as Recipe };

interface EngineProcessInfo extends PublicProcessInfo {
  backend: SharedBackend | "unknown";
  served_model_name: string | null;
}

export type { EngineProcessInfo as ProcessInfo };

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

export type SystemConfigResponse = ConfigData;

export interface ModelsModuleConfig {
  feature: "models";
}

export interface ModelBrowserRecord {
  id: string;
}
