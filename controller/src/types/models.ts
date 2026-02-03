// CRITICAL
import type { RecipeId } from "./brand";

/**
 * Supported inference backends.
 */
export type Backend = "vllm" | "sglang" | "llamacpp" | "transformers" | "tabbyapi";

/**
 * Model launch configuration.
 */
export interface Recipe {
  id: RecipeId;
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
 * Running inference process info.
 */
export interface ProcessInfo {
  pid: number;
  backend: string;
  model_path: string | null;
  port: number;
  served_model_name: string | null;
}

/**
 * Result of launching a model.
 */
export interface LaunchResult {
  success: boolean;
  pid: number | null;
  message: string;
  log_file: string | null;
}

/**
 * Health check response payload.
 */
export interface HealthResponse {
  status: string;
  version: string;
  inference_ready: boolean;
  backend_reachable: boolean;
  running_model: string | null;
}

/**
 * OpenAI-compatible model info.
 */
export interface OpenAIModelInfo {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  active: boolean;
  max_model_len?: number | null;
}

/**
 * OpenAI-compatible model list response.
 */
export interface OpenAIModelList {
  object: "list";
  data: OpenAIModelInfo[];
}

/**
 * Information about a service in the system topology.
 */
export interface ServiceInfo {
  name: string;
  port: number;
  internal_port: number;
  protocol: string;
  status: string;
  description?: string | null;
}

/**
 * System configuration settings.
 */
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

/**
 * Environment URLs and connection info.
 */
export interface EnvironmentInfo {
  controller_url: string;
  inference_url: string;
  litellm_url: string;
  frontend_url: string;
}

/**
 * Runtime backend version info.
 */
export interface RuntimeBackendInfo {
  installed: boolean;
  version: string | null;
  python_path?: string | null;
  binary_path?: string | null;
}

/**
 * CUDA runtime info.
 */
export interface RuntimeCudaInfo {
  driver_version: string | null;
  cuda_version: string | null;
}

/**
 * GPU summary info.
 */
export interface RuntimeGpuInfoSummary {
  count: number;
  types: string[];
}

/**
 * Runtime information for the system.
 */
export interface SystemRuntimeInfo {
  cuda: RuntimeCudaInfo;
  gpus: RuntimeGpuInfoSummary;
  backends: {
    vllm: RuntimeBackendInfo;
    sglang: RuntimeBackendInfo;
    llamacpp: RuntimeBackendInfo;
  };
}

/**
 * Full configuration response payload.
 */
export interface SystemConfigResponse {
  config: SystemConfig;
  services: ServiceInfo[];
  environment: EnvironmentInfo;
  runtime: SystemRuntimeInfo;
}

/**
 * MCP server configuration.
 */
export interface McpServer {
  id: string;
  name: string;
  enabled: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
  description: string | null;
  url: string | null;
}

/**
 * MCP tool description.
 */
export interface McpTool {
  name: string;
  description?: string | null;
  inputSchema?: Record<string, unknown> | null;
  server: string;
}

/**
 * GPU information payload.
 */
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

/**
 * Model download status.
 */
export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

/**
 * Download file status.
 */
export type DownloadFileStatus = "pending" | "downloading" | "completed" | "error";

/**
 * Download file payload.
 */
export interface DownloadFileInfo {
  path: string;
  size_bytes: number | null;
  downloaded_bytes: number;
  status: DownloadFileStatus;
}

/**
 * Model download entry.
 */
export interface ModelDownload {
  id: string;
  model_id: string;
  revision: string | null;
  status: DownloadStatus;
  created_at: string;
  updated_at: string;
  target_dir: string;
  total_bytes: number | null;
  downloaded_bytes: number;
  files: DownloadFileInfo[];
  error: string | null;
}

/**
 * Disk usage summary.
 */
export interface DiskInfo {
  path: string;
  total_bytes: number | null;
  free_bytes: number | null;
  available_bytes: number | null;
}

/**
 * Model recommendations.
 */
export interface ModelRecommendation {
  id: string;
  name: string;
  size_gb: number | null;
  min_vram_gb: number | null;
  description: string;
  tags: string[];
}

/**
 * Diagnostics snapshot.
 */
export interface StudioDiagnostics {
  app_version: string;
  timestamp: string;
  platform: string;
  arch: string;
  release: string;
  cpu_model: string | null;
  cpu_cores: number;
  memory_total: number;
  memory_free: number;
  gpus: GpuInfo[];
  runtime: {
    vllm_installed: boolean;
    vllm_version: string | null;
    python_path: string | null;
    vllm_bin: string | null;
  };
  disks: DiskInfo[];
  config: SystemConfig;
}
