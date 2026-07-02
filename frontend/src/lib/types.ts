/**
 * Shared frontend types: re-exports of the shared contracts plus the
 * frontend-only view models used across multiple features.
 */
import type { RecipeBase, RecipePayload } from "@local-studio/contracts/recipes";

// --- Shared contract re-exports ---

export type {
  Backend,
  DownloadFileInfo,
  DownloadFileStatus,
  DownloadStatus,
  ModelDownload,
  ModelInfo,
  RecipeBase,
  RecipePayload,
  StorageInfo,
} from "@local-studio/contracts/recipes";

export type {
  CompatibilityCheck,
  CompatibilityReport,
  CompatibilitySeverity,
  ConfigData,
  EngineBackend,
  EngineJob,
  EnvironmentInfo,
  RuntimeBackendInfo,
  RuntimeCudaInfo,
  RuntimeGpuInfoSummary,
  RuntimeGpuMonitoringInfo,
  RuntimeGpuMonitoringTool,
  RuntimeKind,
  RuntimePlatformInfo,
  RuntimePlatformKind,
  RuntimeRocmInfo,
  RuntimeRocmSmiTool,
  RuntimeTarget,
  RuntimeTorchBuildInfo,
  RuntimeUpgradeResult,
  ServiceInfo,
  SystemConfig,
  SystemRuntimeInfo,
} from "@local-studio/contracts/system";

export type { ControllerUsageStats, UsageStats } from "@local-studio/contracts/usage";

export type {
  GPU,
  LogSession,
  Metrics,
  PeakMetrics,
  ProcessInfo,
  StudioDiagnostics,
  StudioSettings,
  VRAMCalculation,
} from "@local-studio/contracts/observability";

// --- Recipes ---

/**
 * Recipe payload shape accepted by the controller for create/update.
 * Only `id`, `name`, and `model_path` are required; everything else can be omitted.
 */
export type Recipe = RecipePayload;

export interface RecipeWithStatus extends RecipeBase {
  status: "running" | "stopped" | "starting" | "error";
  crash_loop?: {
    recipe_id: string;
    failure_count: number;
    limit: number;
    window_ms: number;
    reset_at: string;
    blocked: boolean;
  } | null;
  tp?: number;
  pp?: number;
}

// --- Docker environments (a recipe pinned to an official engine image) ---

export type { Environment, EnvironmentEngineId } from "@local-studio/contracts/environments";
import type { Environment, EnvironmentEngineId } from "@local-studio/contracts/environments";

export interface EnvironmentWithStatus extends Environment {
  image: string;
  imagePulled: boolean;
  running: boolean;
}

export interface EnvironmentPayload {
  id: string;
  name: string;
  recipeId: string;
  engineId: EnvironmentEngineId;
  version: string;
  variant?: string;
  image?: string;
}

export type {
  EngineImage,
  EngineImagePull,
  EngineImagesInfo,
} from "@local-studio/contracts/environments";

// --- Launch progress ---

export type LaunchStage =
  | "preempting"
  | "evicting"
  | "launching"
  | "waiting"
  | "ready"
  | "cancelled"
  | "error";

export interface LaunchProgress {
  stage: LaunchStage;
  message?: string;
  progress?: number;
}

export interface LaunchProgressData extends LaunchProgress {
  recipe_id: string;
  message: string;
}

// --- Model discovery + recommendation ---

export interface ModelRecommendation {
  id: string;
  name: string;
  size_gb: number | null;
  min_vram_gb: number | null;
  description: string;
  tags: string[];
}

export interface HuggingFaceModel {
  _id: string;
  modelId: string;
  downloads: number;
  likes: number;
  tags: string[];
  pipeline_tag?: string;
  library_name?: string;
  lastModified?: string;
  /** Hugging Face repo creation time (when returned by the API). */
  createdAt?: string;
  author?: string;
  private: boolean;
  /** Total weight-file size in bytes (from HF siblings with full=true).
   * Present when the API route enriches results; used for accurate VRAM sizing. */
  weightBytes?: number;
}
