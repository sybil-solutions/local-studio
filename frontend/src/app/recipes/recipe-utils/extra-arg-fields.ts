// CRITICAL
import type { RecipeEditor } from "@/lib/types";

export type ExtraArgType = "string" | "number" | "boolean";

export type ExtraArgField = {
  field: keyof RecipeEditor;
  key: string;
  type: ExtraArgType;
  aliases?: string[];
};

export const EXTRA_ARG_FIELDS: ExtraArgField[] = [
  { field: "tokenizer", key: "tokenizer", type: "string" },
  { field: "tokenizer_mode", key: "tokenizer-mode", type: "string" },
  { field: "seed", key: "seed", type: "number" },
  { field: "revision", key: "revision", type: "string" },
  { field: "code_revision", key: "code-revision", type: "string" },
  { field: "load_format", key: "load-format", type: "string" },
  { field: "quantization_param_path", key: "quantization-param-path", type: "string" },
  { field: "chat_template", key: "chat-template", type: "string" },
  { field: "chat_template_content_format", key: "chat-template-content-format", type: "string" },
  { field: "response_role", key: "response-role", type: "string" },
  { field: "block_size", key: "block-size", type: "number" },
  { field: "swap_space", key: "swap-space", type: "number" },
  { field: "cpu_offload_gb", key: "cpu-offload-gb", type: "number" },
  { field: "num_gpu_blocks_override", key: "num-gpu-blocks-override", type: "number" },
  { field: "enable_prefix_caching", key: "enable-prefix-caching", type: "boolean" },
  { field: "enable_chunked_prefill", key: "enable-chunked-prefill", type: "boolean" },
  { field: "max_num_batched_tokens", key: "max-num-batched-tokens", type: "number" },
  { field: "scheduling_policy", key: "scheduling-policy", type: "string" },
  { field: "max_paddings", key: "max-paddings", type: "number" },
  { field: "data_parallel_size", key: "data-parallel-size", type: "number" },
  { field: "distributed_executor_backend", key: "distributed-executor-backend", type: "string" },
  { field: "enable_expert_parallel", key: "enable-expert-parallel", type: "boolean" },
  { field: "enforce_eager", key: "enforce-eager", type: "boolean" },
  { field: "disable_cuda_graph", key: "disable-cuda-graph", type: "boolean" },
  { field: "cuda_graph_max_bs", key: "cuda-graph-max-bs", type: "number" },
  { field: "disable_custom_all_reduce", key: "disable-custom-all-reduce", type: "boolean" },
  { field: "use_v2_block_manager", key: "use-v2-block-manager", type: "boolean" },
  { field: "compilation_config", key: "compilation-config", type: "string" },
  { field: "speculative_model", key: "speculative-model", type: "string" },
  { field: "speculative_model_quantization", key: "speculative-model-quantization", type: "string" },
  { field: "num_speculative_tokens", key: "num-speculative-tokens", type: "number" },
  {
    field: "speculative_draft_tensor_parallel_size",
    key: "speculative-draft-tensor-parallel-size",
    type: "number",
  },
  { field: "speculative_max_model_len", key: "speculative-max-model-len", type: "number" },
  { field: "speculative_disable_mqa_scorer", key: "speculative-disable-mqa-scorer", type: "boolean" },
  {
    field: "spec_decoding_acceptance_method",
    key: "spec-decoding-acceptance-method",
    type: "string",
  },
  {
    field: "typical_acceptance_sampler_posterior_threshold",
    key: "typical-acceptance-sampler-posterior-threshold",
    type: "number",
  },
  {
    field: "typical_acceptance_sampler_posterior_alpha",
    key: "typical-acceptance-sampler-posterior-alpha",
    type: "number",
  },
  { field: "ngram_prompt_lookup_max", key: "ngram-prompt-lookup-max", type: "number" },
  { field: "ngram_prompt_lookup_min", key: "ngram-prompt-lookup-min", type: "number" },
  { field: "guided_decoding_backend", key: "guided-decoding-backend", type: "string" },
  { field: "tool_parser_plugin", key: "tool-parser-plugin", type: "string" },
  { field: "enable_lora", key: "enable-lora", type: "boolean" },
  { field: "max_loras", key: "max-loras", type: "number" },
  { field: "max_lora_rank", key: "max-lora-rank", type: "number" },
  { field: "lora_extra_vocab_size", key: "lora-extra-vocab-size", type: "number" },
  { field: "lora_dtype", key: "lora-dtype", type: "string" },
  { field: "long_lora_scaling_factors", key: "long-lora-scaling-factors", type: "string" },
  { field: "fully_sharded_loras", key: "fully-sharded-loras", type: "boolean" },
  { field: "image_input_type", key: "image-input-type", type: "string" },
  { field: "image_token_id", key: "image-token-id", type: "number" },
  { field: "image_input_shape", key: "image-input-shape", type: "string" },
  { field: "image_feature_size", key: "image-feature-size", type: "number" },
  { field: "limit_mm_per_prompt", key: "limit-mm-per-prompt", type: "string" },
  { field: "mm_processor_kwargs", key: "mm-processor-kwargs", type: "string" },
  { field: "allowed_local_media_path", key: "allowed-local-media-path", type: "string" },
  { field: "disable_log_requests", key: "disable-log-requests", type: "boolean" },
  { field: "disable_log_stats", key: "disable-log-stats", type: "boolean" },
  { field: "max_log_len", key: "max-log-len", type: "number" },
  { field: "uvicorn_log_level", key: "uvicorn-log-level", type: "string" },
  { field: "disable_frontend_multiprocessing", key: "disable-frontend-multiprocessing", type: "boolean" },
  { field: "enable_request_id_headers", key: "enable-request-id-headers", type: "boolean" },
  { field: "disable_fastapi_docs", key: "disable-fastapi-docs", type: "boolean" },
  { field: "return_tokens_as_token_ids", key: "return-tokens-as-token-ids", type: "boolean" },
  {
    field: "visible_devices",
    key: "visible-devices",
    type: "string",
    aliases: [
      "VISIBLE_DEVICES",
      "visible_devices",
      "CUDA_VISIBLE_DEVICES",
      "cuda_visible_devices",
      "cuda-visible-devices",
    ],
  },
  {
    field: "cuda_visible_devices",
    key: "cuda-visible-devices",
    type: "string",
    aliases: ["CUDA_VISIBLE_DEVICES", "cuda_visible_devices"],
  },
  {
    field: "hip_visible_devices",
    key: "hip-visible-devices",
    type: "string",
    aliases: ["HIP_VISIBLE_DEVICES", "hip_visible_devices"],
  },
  {
    field: "rocr_visible_devices",
    key: "rocr-visible-devices",
    type: "string",
    aliases: ["ROCR_VISIBLE_DEVICES", "rocr_visible_devices"],
  },
];

