export type View = 'dashboard' | 'recipes' | 'status' | 'config';

export interface GPU {
  id: number;
  name: string;
  memory_used: number;
  memory_total: number;
  utilization: number;
  temperature: number;
  power_draw: number;
}

export interface Recipe {
  id: string;
  name: string;
  model_path: string;
  backend: string;
  tensor_parallel_size?: number;
  max_model_len?: number;
}

export interface Status {
  status: 'idle' | 'launching' | 'running' | 'error';
  model?: string;
  recipe_id?: string;
  uptime?: number;
  error?: string;
}

export interface Config {
  controller_port: number;
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
  gpus: GPU[];
  recipes: Recipe[];
  status: Status;
  config: Config | null;
  lifetime: LifetimeMetrics;
  error: string | null;
}
