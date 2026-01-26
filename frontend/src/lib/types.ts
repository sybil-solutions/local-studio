// CRITICAL
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

// Recipe - model launch configuration (vLLM 0.14+ compatible)
export interface Recipe {
  // Core identification
  id: string;
  name: string;
  model_path: string;
  backend?: "vllm" | "sglang";

  // Server settings
  host?: string;
  port?: number;
  served_model_name?: string;
  api_key?: string;

  // Model loading
  tokenizer?: string;
  tokenizer_mode?: "auto" | "slow" | "mistral";
  trust_remote_code?: boolean;
  dtype?: string;
  seed?: number;
  revision?: string;
  code_revision?: string;
  load_format?: string;

  // Quantization
  quantization?: string;
  quantization_param_path?: string;

  // Parallelism
  tensor_parallel_size?: number;
  tp?: number;
  pipeline_parallel_size?: number;
  pp?: number;
  data_parallel_size?: number;
  distributed_executor_backend?: "ray" | "mp";
  enable_expert_parallel?: boolean;

  // Memory & KV Cache
  gpu_memory_utilization?: number;
  max_model_len?: number;
  kv_cache_dtype?: string;
  block_size?: number;
  swap_space?: number;
  cpu_offload_gb?: number;
  enable_prefix_caching?: boolean;
  num_gpu_blocks_override?: number;

  // Scheduler & Batching
  max_num_seqs?: number;
  max_num_batched_tokens?: number;
  scheduling_policy?: "fcfs" | "priority";
  enable_chunked_prefill?: boolean;
  max_paddings?: number;

  // Performance tuning
  enforce_eager?: boolean;
  disable_cuda_graph?: boolean;
  cuda_graph_max_bs?: number;
  disable_custom_all_reduce?: boolean;
  use_v2_block_manager?: boolean;
  compilation_config?: string;

  // Speculative decoding
  speculative_model?: string;
  speculative_model_quantization?: string;
  num_speculative_tokens?: number;
  speculative_draft_tensor_parallel_size?: number;
  speculative_max_model_len?: number;
  speculative_disable_mqa_scorer?: boolean;
  spec_decoding_acceptance_method?: "rejection_sampler" | "typical_acceptance_sampler";
  typical_acceptance_sampler_posterior_threshold?: number;
  typical_acceptance_sampler_posterior_alpha?: number;
  ngram_prompt_lookup_max?: number;
  ngram_prompt_lookup_min?: number;

  // Reasoning & Tool calling
  reasoning_parser?: string;
  enable_thinking?: boolean;
  thinking_budget?: number;
  tool_call_parser?: string;
  enable_auto_tool_choice?: boolean;
  tool_parser_plugin?: string;

  // Guided decoding
  guided_decoding_backend?: string;

  // Chat & templates
  chat_template?: string;
  chat_template_content_format?: "auto" | "string" | "openai";
  response_role?: string;

  // LoRA
  enable_lora?: boolean;
  max_loras?: number;
  max_lora_rank?: number;
  lora_extra_vocab_size?: number;
  lora_dtype?: string;
  long_lora_scaling_factors?: string;
  fully_sharded_loras?: boolean;

  // Multimodal
  image_input_type?: string;
  image_token_id?: number;
  image_input_shape?: string;
  image_feature_size?: number;
  limit_mm_per_prompt?: string;
  mm_processor_kwargs?: string;
  allowed_local_media_path?: string;

  // Logging & debugging
  disable_log_requests?: boolean;
  disable_log_stats?: boolean;
  max_log_len?: number;
  uvicorn_log_level?: string;

  // Frontend
  disable_frontend_multiprocessing?: boolean;
  enable_request_id_headers?: boolean;
  disable_fastapi_docs?: boolean;
  return_tokens_as_token_ids?: boolean;

  // Other
  python_path?: string;
  extra_args?: Record<string, unknown>;
  env_vars?: Record<string, string>;
}

export interface RecipeWithStatus extends Recipe {
  status: "running" | "stopped" | "starting" | "error";
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
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
  server?: string;
}

export interface StoredToolCall extends ToolCall {
  result?: { content?: string; isError?: boolean } | string | null;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  name?: string;
  isError?: boolean;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  tool_calls?: StoredToolCall[];
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  request_prompt_tokens?: number | null;
  request_tools_tokens?: number | null;
  request_total_input_tokens?: number | null;
  request_completion_tokens?: number | null;
  estimated_cost_usd?: number | null;
}

export interface ChatSessionDetail extends ChatSession {
  messages?: StoredMessage[];
}

// MCP types
export interface MCPServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  icon?: string;
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
  status: "running" | "stopped" | "crashed";
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
  // KV cache calculation fields
  num_hidden_layers?: number | null;
  num_kv_heads?: number | null;
  hidden_size?: number | null;
  head_dim?: number | null;
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
  power_draw?: number; // Watts
  power_limit?: number; // Watts
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
  // Session averages (since first token this session)
  session_avg_prefill?: number;
  session_avg_generation?: number;
  // Session peaks (best this session)
  session_peak_prefill?: number;
  session_peak_generation?: number;
  // All-time peak metrics (stored best values)
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
  type: "html" | "react" | "javascript" | "python" | "mermaid" | "svg";
  title: string;
  code: string;
  output?: string;
  error?: string;
  isRunning?: boolean;
  // For database storage
  session_id?: string;
  message_id?: string;
  created_at?: string;
}

// ===== SHARED TYPES ACROSS PAGES =====

// Usage Analytics from usage/page.tsx
export interface UsageStats {
  totals: {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    success_rate: number;
    unique_sessions: number;
    unique_users: number;
  };
  latency: {
    avg_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    min_ms: number;
    max_ms: number;
  };
  ttft: {
    avg_ms: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
  };
  tokens_per_request: {
    avg: number;
    avg_prompt: number;
    avg_completion: number;
    max: number;
    p50: number;
    p95: number;
  };
  cache: {
    hits: number;
    misses: number;
    hit_tokens: number;
    miss_tokens: number;
    hit_rate: number;
  };
  week_over_week: {
    this_week: {
      requests: number;
      tokens: number;
      successful: number;
    };
    last_week: {
      requests: number;
      tokens: number;
      successful: number;
    };
    change_pct: {
      requests: number | null;
      tokens: number | null;
    };
  };
  recent_activity: {
    last_hour_requests: number;
    last_24h_requests: number;
    prev_24h_requests: number;
    last_24h_tokens: number;
    change_24h_pct: number | null;
  };
  peak_days: Array<{
    date: string;
    requests: number;
    tokens: number;
  }>;
  peak_hours: Array<{
    hour: number;
    requests: number;
  }>;
  by_model: Array<{
    model: string;
    requests: number;
    successful: number;
    success_rate: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    avg_tokens: number;
    avg_latency_ms: number;
    p50_latency_ms: number;
    avg_ttft_ms: number;
    tokens_per_sec: number | null;
    prefill_tps: number | null;
    generation_tps: number | null;
  }>;
  daily: Array<{
    date: string;
    requests: number;
    successful: number;
    success_rate: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    avg_latency_ms: number;
  }>;
  daily_by_model?: Array<{
    date: string;
    model: string;
    requests: number;
    successful: number;
    success_rate: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
  }>;
  hourly_pattern: Array<{
    hour: number;
    requests: number;
    successful: number;
    tokens: number;
  }>;
}

export interface PeakMetrics {
  model_id: string;
  prefill_tps: number | null;
  generation_tps: number | null;
  ttft_ms: number | null;
  total_tokens: number;
  total_requests: number;
}

export type SortField = "model" | "requests" | "tokens" | "success" | "latency" | "ttft" | "speed";
export type SortDirection = "asc" | "desc";

// Hugging Face models from discover/page.tsx
export interface HuggingFaceModel {
  _id: string;
  modelId: string;
  downloads: number;
  likes: number;
  tags: string[];
  pipeline_tag?: string;
  library_name?: string;
  lastModified?: string;
  author?: string;
  private: boolean;
}

// System config types from configs/page.tsx
export interface ServiceInfo {
  name: string;
  port: number;
  internal_port: number;
  protocol: string;
  status: string;
  description: string | null;
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
  tabby_api_dir: string | null;
}

export interface EnvironmentInfo {
  controller_url: string;
  inference_url: string;
  litellm_url: string;
  frontend_url: string;
}

export interface ConfigData {
  config: SystemConfig;
  services: ServiceInfo[];
  environment: EnvironmentInfo;
}

// Chat UI types
export type ActivePanel = "activity" | "artifacts" | "context";

export interface DeepResearchConfig {
  enabled: boolean;
  maxSources: number;
  searchDepth: "shallow" | "medium" | "deep";
  autoSummarize: boolean;
  includeCitations: boolean;
}

export interface SessionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost?: number | null;
}
