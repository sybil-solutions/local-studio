import type { Backend } from "./recipes";

/**
 * Engine-scoped CLI argument policy.
 *
 * vLLM exposes a large surface of structured "convenience" flags in the recipe
 * editor. Those flags are vLLM-specific: forwarding them to llama.cpp, MLX, or
 * SGLang produces an unknown-argument crash or silently wrong behaviour. This
 * module is the single source of truth (shared by the frontend serializer and
 * the controller command builders) for which keys must never leak across
 * engines.
 */

export type EngineArgType = "string" | "number" | "boolean";

/**
 * - `vllm`: vLLM-only secondary flag; stripped before launching other engines.
 * - `shared`: structured editor field whose flag other engines also accept.
 * - `device`: launch-control key handled out-of-band, never emitted as a flag.
 */
type EngineArgScope = "vllm" | "shared" | "device";

type EngineArgSpec = {
  readonly field: string;
  readonly type: EngineArgType;
  readonly scope: EngineArgScope;
  readonly aliases?: readonly string[];
};

/** Canonical kebab-case CLI key for a spec's snake_case field name. */
export const engineArgKey = (field: string): string => field.replace(/_/g, "-");

/** Normalize a CLI/extra-arg key to canonical kebab-case for comparison. */
const normalizeEngineArgKey = (key: string): string =>
  key.replace(/_/g, "-").toLowerCase().trim();

/**
 * The structured extra-arg field table: one row per editor field, in editor
 * display order. CLI keys, engine scoping, and editor field derivations all
 * flow from here.
 */
export const ENGINE_ARG_SPECS = [
  { field: "tokenizer", type: "string", scope: "vllm" },
  { field: "tokenizer_mode", type: "string", scope: "vllm" },
  { field: "seed", type: "number", scope: "vllm" },
  { field: "revision", type: "string", scope: "vllm" },
  { field: "code_revision", type: "string", scope: "vllm" },
  { field: "load_format", type: "string", scope: "vllm" },
  { field: "quantization_param_path", type: "string", scope: "vllm" },
  { field: "chat_template", type: "string", scope: "shared" },
  { field: "chat_template_content_format", type: "string", scope: "vllm" },
  { field: "response_role", type: "string", scope: "vllm" },
  { field: "block_size", type: "number", scope: "vllm" },
  { field: "swap_space", type: "number", scope: "vllm" },
  { field: "cpu_offload_gb", type: "number", scope: "vllm" },
  { field: "num_gpu_blocks_override", type: "number", scope: "vllm" },
  { field: "enable_prefix_caching", type: "boolean", scope: "vllm" },
  { field: "enable_chunked_prefill", type: "boolean", scope: "vllm" },
  { field: "max_num_batched_tokens", type: "number", scope: "vllm" },
  { field: "scheduling_policy", type: "string", scope: "vllm" },
  { field: "max_paddings", type: "number", scope: "vllm" },
  { field: "data_parallel_size", type: "number", scope: "vllm" },
  { field: "enable_expert_parallel", type: "boolean", scope: "vllm" },
  { field: "enforce_eager", type: "boolean", scope: "vllm" },
  { field: "disable_cuda_graph", type: "boolean", scope: "vllm" },
  { field: "cuda_graph_max_bs", type: "number", scope: "vllm" },
  { field: "disable_custom_all_reduce", type: "boolean", scope: "vllm" },
  { field: "use_v2_block_manager", type: "boolean", scope: "vllm" },
  { field: "compilation_config", type: "string", scope: "vllm" },
  { field: "speculative_model", type: "string", scope: "vllm" },
  { field: "speculative_model_quantization", type: "string", scope: "vllm" },
  { field: "num_speculative_tokens", type: "number", scope: "vllm" },
  { field: "speculative_draft_tensor_parallel_size", type: "number", scope: "vllm" },
  { field: "speculative_max_model_len", type: "number", scope: "vllm" },
  { field: "speculative_disable_mqa_scorer", type: "boolean", scope: "vllm" },
  { field: "spec_decoding_acceptance_method", type: "string", scope: "vllm" },
  { field: "typical_acceptance_sampler_posterior_threshold", type: "number", scope: "vllm" },
  { field: "typical_acceptance_sampler_posterior_alpha", type: "number", scope: "vllm" },
  { field: "ngram_prompt_lookup_max", type: "number", scope: "vllm" },
  { field: "ngram_prompt_lookup_min", type: "number", scope: "vllm" },
  { field: "guided_decoding_backend", type: "string", scope: "vllm" },
  { field: "tool_parser_plugin", type: "string", scope: "vllm" },
  { field: "enable_lora", type: "boolean", scope: "vllm" },
  { field: "max_loras", type: "number", scope: "vllm" },
  { field: "max_lora_rank", type: "number", scope: "vllm" },
  { field: "lora_extra_vocab_size", type: "number", scope: "vllm" },
  { field: "lora_dtype", type: "string", scope: "vllm" },
  { field: "long_lora_scaling_factors", type: "string", scope: "vllm" },
  { field: "fully_sharded_loras", type: "boolean", scope: "vllm" },
  { field: "image_input_type", type: "string", scope: "vllm" },
  { field: "image_token_id", type: "number", scope: "vllm" },
  { field: "image_input_shape", type: "string", scope: "vllm" },
  { field: "image_feature_size", type: "number", scope: "vllm" },
  { field: "limit_mm_per_prompt", type: "string", scope: "vllm" },
  { field: "mm_processor_kwargs", type: "string", scope: "vllm" },
  { field: "allowed_local_media_path", type: "string", scope: "vllm" },
  { field: "disable_log_requests", type: "boolean", scope: "vllm" },
  { field: "disable_log_stats", type: "boolean", scope: "vllm" },
  { field: "max_log_len", type: "number", scope: "vllm" },
  { field: "uvicorn_log_level", type: "string", scope: "vllm" },
  { field: "disable_frontend_multiprocessing", type: "boolean", scope: "vllm" },
  { field: "enable_request_id_headers", type: "boolean", scope: "vllm" },
  { field: "disable_fastapi_docs", type: "boolean", scope: "vllm" },
  { field: "return_tokens_as_token_ids", type: "boolean", scope: "vllm" },
  {
    field: "visible_devices",
    type: "string",
    scope: "device",
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
    type: "string",
    scope: "device",
    aliases: ["CUDA_VISIBLE_DEVICES", "cuda_visible_devices"],
  },
  {
    field: "hip_visible_devices",
    type: "string",
    scope: "device",
    aliases: ["HIP_VISIBLE_DEVICES", "hip_visible_devices"],
  },
  {
    field: "rocr_visible_devices",
    type: "string",
    scope: "device",
    aliases: ["ROCR_VISIBLE_DEVICES", "rocr_visible_devices"],
  },
] as const satisfies readonly EngineArgSpec[];

const VLLM_ONLY_FLAG_KEYS: readonly string[] = ENGINE_ARG_SPECS.filter(
  (spec) => spec.scope === "vllm",
).map((spec) => engineArgKey(spec.field));

/**
 * vLLM flags that SGLang also accepts under the same name. These are kept when
 * scoping arguments for SGLang so legitimate overrides are not dropped.
 * Updated to reflect SGLang's actual server argument surface (2025+).
 */
const SGLANG_COMPATIBLE_VLLM_KEYS: ReadonlySet<string> = new Set([
  "disable-cuda-graph",
  "disable-custom-all-reduce",
  "enable-prefix-caching",
  "enable-chunked-prefill",
  "chunked-prefill-size",
  "max-num-batched-tokens",
  "scheduling-policy",
  "enable-priority-scheduling",
  "schedule-conservativeness",
  "page-size",
  "data-parallel-size",
  "enable-torch-compile",
  "enable-p2p-check",
  "enable-deterministic-inference",
  "random-seed",
  "load-format",
  "revision",
  "tokenizer-mode",
  "tokenizer-backend",
  "device",
  "stream-interval",
  "watchdog-timeout",
  "enable-cache-report",
  "chat-template",
  "hf-chat-template-name",
  "api-key",
  "download-dir",
  "base-gpu-id",
  "gpu-id-step",
  "sleep-on-idle",
  "skip-server-warmup",
  "log-level",
  "log-requests",
]);

const VLLM_ONLY_FLAG_KEY_SET: ReadonlySet<string> = new Set(VLLM_ONLY_FLAG_KEYS);

/** Keys that do not belong to `backend` and must be stripped before launch. */
const getForeignFlagKeys = (backend: Backend): ReadonlySet<string> => {
  if (backend === "vllm") return new Set();
  if (backend === "sglang") {
    return new Set(
      [...VLLM_ONLY_FLAG_KEY_SET].filter((key) => !SGLANG_COMPATIBLE_VLLM_KEYS.has(key)),
    );
  }
  // llama.cpp and MLX share no flag namespace with vLLM.
  return VLLM_ONLY_FLAG_KEY_SET;
};

/**
 * Return a copy of `extraArgs` with any wrong-engine flag keys removed. vLLM
 * recipes are returned untouched (vLLM is the superset).
 */
export const stripForeignFlagKeys = (
  backend: Backend,
  extraArgs: Record<string, unknown> | null | undefined,
): Record<string, unknown> => {
  const source = extraArgs ?? {};
  const foreign = getForeignFlagKeys(backend);
  if (foreign.size === 0) return { ...source };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (foreign.has(normalizeEngineArgKey(key))) continue;
    result[key] = value;
  }
  return result;
};

/**
 * Broad allowlist of vLLM `serve` CLI flags that may safely be forwarded as
 * `extra_args` (canonical kebab-case). Built from the spec table,
 * `SGLANG_COMPATIBLE_VLLM_KEYS`, plus recipe fields the editor exposes as
 * structured inputs.
 *
 * If a flag is not in this set and does not match an experimental prefix,
 * `getUnknownVllmExtraArgKeys` will surface it so the command builder can
 * drop it with a warning instead of blindly forwarding it (which used to
 * crash vLLM with `unrecognized arguments`, e.g. for `benchmark_notes_<date>`
 * annotations that got stored in `extra_args`).
 */
export const KNOWN_VLLM_EXTRA_ARG_KEYS: ReadonlySet<string> = new Set([
  ...ENGINE_ARG_SPECS.filter((spec) => spec.scope !== "device").map((spec) =>
    engineArgKey(spec.field),
  ),
  ...SGLANG_COMPATIBLE_VLLM_KEYS,
  // Recipe fields also surfaced via extra_args by the editor (defensively
  // allowed here so a typo there never blocks launch).
  "tensor-parallel-size",
  "pipeline-parallel-size",
  "max-model-len",
  "gpu-memory-utilization",
  "max-num-seqs",
  "kv-cache-dtype",
  "trust-remote-code",
  "tool-call-parser",
  "reasoning-parser",
  "enable-auto-tool-choice",
  "quantization",
  "dtype",
  "served-model-name",
  "host",
  "port",
  "attention-backend",
  "moe-backend",
  "async-scheduling",
  "hf-overrides",
  "speculative-config",
  "speculative-config-2",
  "decode-context-parallel-size",
  "dcp-comm-backend",
  "dcp-kv-cache-interleave-size",
  "fuse-allreduce-rms",
  "fuse-rms",
  "fuse-rms-norm",
  "fuse-rms-quant",
  "fuse-attn-quant",
  "extra-llm-config",
  "override-generation-config",
  "override-attention-dtype",
  "tensor-parallel-size-of-mlp",
]);

/**
 * Fork-specific or experimental vLLM flag prefixes (voipmonitor/vllm B12X,
 * darkdevotion, etc.) that ship CLI flags outside the open-source surface.
 * Forwarded without per-key enumeration.
 */
const VLLM_EXPERIMENTAL_PREFIXES: readonly string[] = [
  "b12x-",
  "darkdevotion-",
  "cute-",
  "fuse-",
  "rok-",
  "swap-",
];

/**
 * Recipe metadata / launch-control keys that are handled out-of-band by the
 * command builders (env injection, Docker wrapping, launch overrides) and are
 * never emitted as CLI flags. Recognised here so they are not surfaced as
 * "unknown" extra-args (which would log a misleading drop warning every launch).
 */
export const INTERNAL_RECIPE_KEYS: ReadonlySet<string> = new Set([
  ...ENGINE_ARG_SPECS.filter((spec) => spec.scope === "device").map((spec) =>
    engineArgKey(spec.field),
  ),
  "venv-path",
  "env-vars",
  "description",
  "tags",
  "status",
  "metadata",
  "llama-bin",
  "mlx-python",
  "launch-command",
  "custom-command",
  "docker-container",
  "docker-image",
]);

export const isInternalRecipeKey = (key: string): boolean =>
  INTERNAL_RECIPE_KEYS.has(normalizeEngineArgKey(key));

/** Extra-arg keys whose string values are JSON payloads to re-serialize compactly. */
const JSON_STRING_ARG_KEYS: ReadonlySet<string> = new Set([
  "speculative-config",
  "default-chat-template-kwargs",
]);

export const isJsonStringArgumentKey = (key: string): boolean =>
  JSON_STRING_ARG_KEYS.has(normalizeEngineArgKey(key));

/**
 * Returns true if `key` is a known vLLM extra-arg flag, an internal recipe
 * metadata key handled out-of-band, or a fork-specific prefix we always pass
 * through to the CLI.
 */
const isKnownVllmExtraArgKey = (key: string): boolean => {
  const normalized = normalizeEngineArgKey(key);
  if (KNOWN_VLLM_EXTRA_ARG_KEYS.has(normalized)) return true;
  if (INTERNAL_RECIPE_KEYS.has(normalized)) return true;
  return VLLM_EXPERIMENTAL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

/**
 * Returns the subset of `extraArgs` whose keys are NOT valid vLLM `serve`
 * flags. Notes-style keys (`benchmark_notes_<date>`, anything ending in
 * `_YYYYMMDD`, free-form metadata) fall into this bucket.
 */
export const getUnknownVllmExtraArgKeys = (
  extraArgs: Record<string, unknown> | null | undefined
): string[] => {
  const source = extraArgs ?? {};
  const blocked: string[] = [];
  for (const key of Object.keys(source)) {
    if (!isKnownVllmExtraArgKey(key)) {
      blocked.push(key);
    }
  }
  return blocked;
};

/**
 * Returns true if `key` looks like a free-form annotation / notes field
 * rather than a CLI flag.
 */
export const looksLikeNotesKey = (key: string): boolean => {
  const normalized = normalizeEngineArgKey(key);
  if (normalized.startsWith("benchmark-notes")) return true;
  if (normalized.endsWith("-notes")) return true;
  if (/^.*-\d{6,8}$/.test(normalized)) return true;
  return false;
};
