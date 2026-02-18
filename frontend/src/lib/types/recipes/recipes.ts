// CRITICAL
/**
 * Recipe types (model launch configuration).
 */

export type Backend = "vllm" | "sglang" | "llamacpp" | "transformers" | "tabbyapi";

/**
 * Canonical recipe shape as returned by the controller API (stored/normalized).
 *
 * Note: this file must be self-contained for the frontend Docker build context (which may not
 * include repo-root shared types).
 */
export interface RecipeStored {
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
 * Recipe payload shape accepted by the controller for create/update.
 * Only `id`, `name`, and `model_path` are required; everything else can be omitted.
 */
export type Recipe =
  & Pick<RecipeStored, "id" | "name" | "model_path">
  & Partial<Omit<RecipeStored, "id" | "name" | "model_path">>;

/**
 * Recipe shape used by the UI/editor. This intentionally supports top-level convenience fields
 * (that will be merged into `extra_args` before saving).
 */
export interface RecipeEditor {
  // Core identification
  id: string;
  name: string;
  model_path: string;
  backend?: Backend;

  // Server settings
  host?: string;
  port?: number;
  served_model_name?: string | null;
  api_key?: string;

  // Model loading
  tokenizer?: string;
  tokenizer_mode?: "auto" | "slow" | "mistral";
  trust_remote_code?: boolean;
  dtype?: string | null;
  seed?: number;
  revision?: string;
  code_revision?: string;
  load_format?: string;

  // Quantization
  quantization?: string | null;
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
  reasoning_parser?: string | null;
  enable_thinking?: boolean;
  thinking_budget?: number;
  tool_call_parser?: string | null;
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
  python_path?: string | null;
  visible_devices?: string;
  cuda_visible_devices?: string;
  hip_visible_devices?: string;
  rocr_visible_devices?: string;
  extra_args?: Record<string, unknown>;
  env_vars?: Record<string, string> | null;
}

export interface RecipeWithStatus extends RecipeStored {
  status: "running" | "stopped" | "starting" | "error";
  tp?: number;
  pp?: number;
}
