import type { GPU } from "../../shared/contracts/observability";
import type { RecipePayload } from "../../shared/contracts/recipes";

export type View = 'dashboard' | 'recipes' | 'status' | 'config';

export type GpuSummary = Required<
  Pick<
    GPU,
    "index" | "name" | "memory_used" | "memory_total" | "utilization" | "temperature" | "power_draw"
  >
>;

export type RecipeSummary = Pick<
  RecipePayload,
  "id" | "name" | "model_path" | "backend" | "tensor_parallel_size" | "max_model_len"
>;

export interface Status {
  running: boolean;
  launching: boolean;
  model?: string;
  backend?: string;
  pid?: number;
  port?: number;
  error?: string;
}

export interface ControllerConfig {
  port: number;
  inference_port: number;
  models_dir: string;
  data_dir: string;
}

export interface LifetimeMetrics {
  total_tokens: number;
  total_requests: number;
  total_energy_kwh: number;
}

export interface AppState {
  view: View;
  selectedIndex: number;
  gpus: GpuSummary[];
  recipes: RecipeSummary[];
  status: Status;
  config: ControllerConfig | null;
  lifetime: LifetimeMetrics;
  error: string | null;
}
