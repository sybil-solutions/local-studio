export const BACKEND_LABELS: Record<string, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  llamacpp: "llama.cpp",
  exllamav3: "ExLlama v3",
  mlx: "MLX",
};

export const formatBackendLabel = (backend?: string | null): string => {
  if (!backend) return BACKEND_LABELS.vllm;
  return BACKEND_LABELS[backend] ?? backend;
};
