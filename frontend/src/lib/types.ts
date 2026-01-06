/**
 * Type definitions for vLLM Studio
 */

// Process info from controller
export interface ProcessInfo {
  pid: number;
  backend: string;
  model_path: string | null;
  port: number;
  served_model_name?: string | null;
}

// Recipe - model launch configuration
export interface Recipe {
  id: string;
  name: string;
  model_path: string;
  backend?: 'vllm' | 'sglang';
  tensor_parallel_size?: number;
  tp?: number;
  pipeline_parallel_size?: number;
  pp?: number;
  max_model_len?: number;
  gpu_memory_utilization?: number;
  kv_cache_dtype?: string;
  max_num_seqs?: number;
  trust_remote_code?: boolean;
  tool_call_parser?: string;
  quantization?: string;
  dtype?: string;
  host?: string;
  port?: number;
  served_model_name?: string;
  python_path?: string;
  extra_args?: Record<string, unknown>;
  env_vars?: Record<string, string>;
  enable_auto_tool_choice?: boolean;
  enforce_eager?: boolean;
  disable_frontend_multiprocessing?: boolean;
  disable_log_requests?: boolean;
  disable_cuda_graph?: boolean;
  allowed_local_media_path?: string;
  chat_template?: string;
  enable_chunked_prefill?: boolean;
  speculative_model?: string;
  num_speculative_tokens?: number;
  guided_decoding_backend?: string;
  enable_prefix_caching?: boolean;
  reasoning_parser?: string;
  block_size?: number;
  max_num_batched_tokens?: number;
  swap_space?: number;
  disable_custom_all_reduce?: boolean;
  enable_expert_parallel?: boolean;
}

export interface RecipeWithStatus extends Recipe {
  status: 'running' | 'stopped' | 'starting' | 'error';
}

// Chat session
export interface ChatSession {
  id: string;
  title: string;
  model?: string;
  parent_id?: string;
  created_at: string;
  updated_at: string;
}

// Health response from controller
export interface HealthResponse {
  status: string;
  version: string;
  backend_reachable: boolean;
  running_model: string | null;
}

// Tool calling types
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
  server?: string;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  name?: string;
  isError?: boolean;
}

// MCP types
export interface MCPServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
  server: string;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  server?: string;
}

// Log session
export interface LogSession {
  id: string;
  recipe_id?: string;
  recipe_name?: string;
  model_path?: string;
  model?: string;
  backend?: string;
  started_at?: string;
  created_at: string;
  ended_at?: string;
  status: 'running' | 'stopped' | 'crashed';
}

// Model info from discovery
export interface ModelInfo {
  path: string;
  name: string;
  size_bytes?: number;
  modified_at?: number;
  architecture?: string | null;
  quantization?: string | null;
  context_length?: number | null;
  recipe_ids?: string[];
  has_recipe?: boolean;
}

export interface StudioModelsRoot {
  path: string;
  exists: boolean;
  sources?: string[];
  recipe_ids?: string[];
}

// VRAM calculation
export interface VRAMCalculation {
  model_size_gb: number;
  context_memory_gb: number;
  overhead_gb: number;
  total_gb: number;
  fits_in_vram: boolean;
  fits: boolean;
  utilization_percent: number;
  breakdown: {
    model_weights_gb: number;
    kv_cache_gb: number;
    activations_gb: number;
    per_gpu_gb: number;
    total_gb: number;
  };
}

// GPU info
export interface GPU {
  id?: string;
  index: number;
  name: string;
  memory_total: number;
  memory_total_mb?: number;
  memory_used: number;
  memory_used_mb?: number;
  memory_free: number;
  memory_free_mb?: number;
  utilization: number;
  utilization_pct?: number;
  temperature?: number;
  temp_c?: number;
  power_draw?: number;  // Watts
  power_limit?: number;  // Watts
}

// Metrics
export interface Metrics {
  requests_total?: number;
  tokens_total?: number;
  latency_avg?: number;
  throughput?: number;
  gpu_utilization?: number;
  memory_used?: number;
  avg_ttft_ms?: number;
  kv_cache_usage?: number;
  generation_throughput?: number;
  prompt_throughput?: number;
  request_success?: number;
  generation_tokens_total?: number;
  prompt_tokens_total?: number;
  running_requests?: number;
  pending_requests?: number;
  // Peak metrics (stored best values)
  peak_prefill_tps?: number;
  peak_generation_tps?: number;
  peak_ttft_ms?: number;
  total_tokens?: number;
  total_requests?: number;
  // Lifetime metrics (cumulative across all sessions)
  lifetime_tokens?: number;
  lifetime_prompt_tokens?: number;
  lifetime_completion_tokens?: number;
  lifetime_requests?: number;
  lifetime_energy_wh?: number;
  lifetime_energy_kwh?: number;
  lifetime_uptime_hours?: number;
  kwh_per_million_tokens?: number;
  kwh_per_million_input?: number;
  kwh_per_million_output?: number;
  current_power_watts?: number;
}

// Artifact types for code rendering
export interface Artifact {
  id: string;
  type: 'html' | 'react' | 'javascript' | 'python' | 'mermaid' | 'svg';
  title: string;
  code: string;
  output?: string;
  error?: string;
  isRunning?: boolean;
}
