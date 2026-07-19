import type { Backend, ServeRuntime } from "@/lib/types";

export interface RecipeEditor {
  id: string;
  name: string;
  model_path: string;
  backend?: Backend;
  runtime?: ServeRuntime;

  host?: string;
  port?: number;
  served_model_name?: string | null;
  api_key?: string;

  tokenizer?: string;
  tokenizer_mode?: "auto" | "slow" | "mistral";
  trust_remote_code?: boolean;
  dtype?: string | null;
  seed?: number;
  revision?: string;
  code_revision?: string;
  load_format?: string;

  quantization?: string | null;
  quantization_param_path?: string;

  tensor_parallel_size?: number;
  tp?: number;
  pipeline_parallel_size?: number;
  pp?: number;
  data_parallel_size?: number;
  enable_expert_parallel?: boolean;

  gpu_memory_utilization?: number;
  max_model_len?: number;
  kv_cache_dtype?: string;
  block_size?: number;
  swap_space?: number;
  cpu_offload_gb?: number;
  enable_prefix_caching?: boolean;
  num_gpu_blocks_override?: number;

  max_num_seqs?: number;
  max_num_batched_tokens?: number;
  scheduling_policy?: "fcfs" | "priority";
  enable_chunked_prefill?: boolean;
  max_paddings?: number;

  cuda_graph_max_bs?: number;
  disable_custom_all_reduce?: boolean;
  use_v2_block_manager?: boolean;
  compilation_config?: string;

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

  reasoning_parser?: string | null;
  enable_thinking?: boolean;
  thinking_budget?: number;
  tool_call_parser?: string | null;
  enable_auto_tool_choice?: boolean;
  tool_parser_plugin?: string;

  guided_decoding_backend?: string;

  chat_template?: string;
  chat_template_content_format?: "auto" | "string" | "openai";
  response_role?: string;

  enable_lora?: boolean;
  max_loras?: number;
  max_lora_rank?: number;
  lora_extra_vocab_size?: number;
  lora_dtype?: string;
  long_lora_scaling_factors?: string;
  fully_sharded_loras?: boolean;

  vision?: boolean | null;
  image_input_type?: string;
  image_token_id?: number;
  image_input_shape?: string;
  image_feature_size?: number;
  limit_mm_per_prompt?: string;
  mm_processor_kwargs?: string;
  allowed_local_media_path?: string;

  disable_log_requests?: boolean;
  disable_log_stats?: boolean;
  max_log_len?: number;
  uvicorn_log_level?: string;

  disable_frontend_multiprocessing?: boolean;
  enable_request_id_headers?: boolean;
  disable_fastapi_docs?: boolean;
  return_tokens_as_token_ids?: boolean;

  python_path?: string | null;
  visible_devices?: string;
  cuda_visible_devices?: string;
  hip_visible_devices?: string;
  rocr_visible_devices?: string;
  extra_args?: Record<string, unknown>;
  env_vars?: Record<string, string> | null;
}
