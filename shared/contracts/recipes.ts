export type Backend = "vllm" | "sglang" | "llamacpp" | "mlx";

/**
 * Canonical recipe shape as sent over the wire.
 */
export interface RecipeBase {
  id: string;
  name: string;
  model_path: string;
  backend: Backend;
  env_vars: Record<string, string> | null;
  tensor_parallel_size: number;
  pipeline_parallel_size: number;
  max_model_len: number;
  gpu_memory_utilization: number;
  kv_cache_dtype: string;
  max_num_seqs: number;
  trust_remote_code: boolean;
  tool_call_parser: string | null;
  reasoning_parser: string | null;
  enable_auto_tool_choice: boolean;
  quantization: string | null;
  dtype: string | null;
  host: string;
  port: number;
  served_model_name: string | null;
  python_path: string | null;
  extra_args: Record<string, unknown>;
  max_thinking_tokens: number | null;
  thinking_mode: string;
}

/**
 * Recipe payload accepted by the controller for create/update.
 * Only `id`, `name`, and `model_path` are required; all other fields may be
 * omitted and defaulted server-side.
 */
export type RecipePayload = Pick<RecipeBase, "id" | "name" | "model_path"> &
  Partial<Omit<RecipeBase, "id" | "name" | "model_path">>;

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export type DownloadFileStatus = "pending" | "downloading" | "completed" | "error";

export interface DownloadFileInfo {
  path: string;
  size_bytes: number | null;
  downloaded_bytes: number;
  status: DownloadFileStatus;
}

export interface ModelDownload {
  id: string;
  model_id: string;
  revision: string | null;
  status: DownloadStatus;
  source?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  target_dir: string;
  total_bytes: number | null;
  downloaded_bytes: number;
  speed_bytes_per_second?: number | null;
  files: DownloadFileInfo[];
  error: string | null;
}

export interface StorageInfo {
  models_dir: string;
  model_count: number;
  model_bytes: number;
  disk: {
    path: string;
    total_bytes: number | null;
    free_bytes: number | null;
    available_bytes: number | null;
  };
}

export interface ModelInfo {
  path: string;
  name: string;
  size_bytes?: number | null;
  modified_at?: number | null;
  architecture?: string | null;
  quantization?: string | null;
  context_length?: number | null;
  recipe_ids?: string[];
  has_recipe?: boolean;
  num_hidden_layers?: number | null;
  num_kv_heads?: number | null;
  hidden_size?: number | null;
  head_dim?: number | null;
}
