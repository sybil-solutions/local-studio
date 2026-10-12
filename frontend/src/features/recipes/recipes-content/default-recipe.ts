import type { RecipeEditor } from "@/features/recipes/recipe-editor";

export const DEFAULT_RECIPE: RecipeEditor = {
  id: "",
  name: "",
  model_path: "",
  backend: "vllm",
  runtime: { kind: "managed_venv", ref: "vllm", label: "Managed vLLM" },
  tp: 1,
  pp: 1,
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  port: 8000,
  host: "0.0.0.0",
  gpu_memory_utilization: 0.9,
  max_model_len: 32768,
  max_num_seqs: 256,
  kv_cache_dtype: "auto",
  trust_remote_code: true,
  vision: null,
  extra_args: {},
};
