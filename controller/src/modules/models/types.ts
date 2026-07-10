import type { Backend as SharedBackend, RecipeBase } from "@local-studio/contracts/recipes";
import type { GPU, ProcessInfo as PublicProcessInfo } from "@local-studio/contracts/observability";
import type { ConfigData } from "@local-studio/contracts/system";

export type { ModelInfo } from "@local-studio/contracts/recipes";
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
} from "@local-studio/contracts/system";

export type Brand<Primitive, Label extends string> = Primitive & {
  readonly __brand: Label;
};

export type RecipeId = Brand<string, "RecipeId">;

export const asRecipeId = (value: string): RecipeId => value as RecipeId;

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

export type GpuInfo = Omit<GPU, "id"> & Required<Pick<GPU, "power_draw" | "power_limit">>;

export type SystemConfigResponse = ConfigData;
