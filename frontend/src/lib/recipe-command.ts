// CRITICAL
import type { Recipe } from "./types";

function safeNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export function slugifyRecipeId(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function recipeToCommand(recipe: Recipe): string {
  const lines: string[] = [];

  const tp = recipe.tp || recipe.tensor_parallel_size || 1;
  const pp = recipe.pp || recipe.pipeline_parallel_size || 1;
  const totalGpus = tp * pp;
  if (totalGpus > 1) {
    const gpuIds = Array.from({ length: totalGpus }, (_, i) => i).join(",");
    lines.push(`CUDA_VISIBLE_DEVICES=${gpuIds} \\`);
  }

  const backend = recipe.backend || "vllm";
  if (backend === "sglang") {
    lines.push(`python -m sglang.launch_server \\`);
    lines.push(`  --model-path ${recipe.model_path} \\`);
  } else {
    lines.push(`vllm serve ${recipe.model_path} \\`);
  }

  const args: [string, string | number | boolean | undefined][] = [
    ["--tensor-parallel-size", tp],
    ["--pipeline-parallel-size", pp > 1 ? pp : undefined],
    ["--dtype", recipe.dtype],
    ["--max-model-len", recipe.max_model_len],
    [
      "--block-size",
      safeNumber(recipe.block_size ?? (recipe.extra_args?.block_size as number | undefined)),
    ],
    ["--max-num-seqs", recipe.max_num_seqs],
    ["--max-num-batched-tokens", recipe.max_num_batched_tokens],
    ["--gpu-memory-utilization", recipe.gpu_memory_utilization],
    [
      "--swap-space",
      safeNumber(recipe.swap_space ?? (recipe.extra_args?.swap_space as number | undefined)),
    ],
    ["--kv-cache-dtype", recipe.kv_cache_dtype],
    ["--quantization", recipe.quantization],
    [
      "--reasoning-parser",
      (recipe.reasoning_parser ?? (recipe.extra_args?.reasoning_parser as string | undefined)) as
        | string
        | undefined,
    ],
    ["--tool-call-parser", recipe.tool_call_parser],
    ["--served-model-name", recipe.served_model_name],
  ];

  if (recipe.enable_auto_tool_choice) args.push(["--enable-auto-tool-choice", true]);
  if (recipe.disable_custom_all_reduce ?? recipe.extra_args?.disable_custom_all_reduce)
    args.push(["--disable-custom-all-reduce", true]);
  if (recipe.trust_remote_code ?? recipe.extra_args?.trust_remote_code)
    args.push(["--trust-remote-code", true]);
  if (recipe.disable_log_requests ?? recipe.extra_args?.disable_log_requests)
    args.push(["--disable-log-requests", true]);
  if (recipe.enable_expert_parallel ?? recipe.extra_args?.enable_expert_parallel)
    args.push(["--enable-expert-parallel", true]);

  for (const [flag, value] of args) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "boolean") {
      if (value) lines.push(`  ${flag} \\`);
    } else {
      lines.push(`  ${flag} ${value} \\`);
    }
  }

  lines.push(`  --host ${recipe.host || "0.0.0.0"} \\`);
  lines.push(`  --port ${recipe.port || 8000}`);

  return lines.join("\n");
}

export function parseCommand(command: string, existingRecipe?: Partial<Recipe>): Recipe {
  const recipe: Recipe = {
    id: existingRecipe?.id || "",
    name: existingRecipe?.name || "",
    model_path: existingRecipe?.model_path || "",
    backend: "vllm",
    extra_args: {},
  };

  const normalizedCmd = command
    .replace(/\\\s*\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalizedCmd.includes("sglang")) recipe.backend = "sglang";

  const modelMatch = normalizedCmd.match(/(?:vllm serve|--model-path|--model)\s+(\/[^\s]+)/);
  if (modelMatch) recipe.model_path = modelMatch[1];

  const cudaMatch = normalizedCmd.match(/CUDA_VISIBLE_DEVICES=([\d,]+)/);
  if (cudaMatch) recipe.extra_args!.cuda_visible_devices = cudaMatch[1];

  const flagPattern = /--([\w-]+)(?:\s+([^\s-][^\s]*))?/g;
  let match: RegExpExecArray | null;
  while ((match = flagPattern.exec(normalizedCmd)) !== null) {
    const [, flag, value] = match;
    switch (flag) {
      case "tensor-parallel-size":
        recipe.tp = parseInt(value) || 1;
        recipe.tensor_parallel_size = recipe.tp;
        break;
      case "pipeline-parallel-size":
        recipe.pp = parseInt(value) || 1;
        recipe.pipeline_parallel_size = recipe.pp;
        break;
      case "max-model-len":
        recipe.max_model_len = parseInt(value) || undefined;
        break;
      case "gpu-memory-utilization":
        recipe.gpu_memory_utilization = parseFloat(value) || 0.9;
        break;
      case "max-num-seqs":
        recipe.max_num_seqs = parseInt(value) || undefined;
        break;
      case "max-num-batched-tokens":
        recipe.max_num_batched_tokens = parseInt(value) || undefined;
        break;
      case "kv-cache-dtype":
        recipe.kv_cache_dtype = value;
        break;
      case "quantization":
        recipe.quantization = value;
        break;
      case "dtype":
        recipe.dtype = value;
        break;
      case "tool-call-parser":
        recipe.tool_call_parser = value;
        break;
      case "served-model-name":
        recipe.served_model_name = value;
        break;
      case "model":
      case "model-path":
        if (!recipe.model_path && value) recipe.model_path = value;
        break;
      case "port":
        recipe.port = parseInt(value) || 8000;
        break;
      case "block-size":
        recipe.block_size = parseInt(value);
        break;
      case "swap-space":
        recipe.swap_space = parseInt(value);
        break;
      case "reasoning-parser":
        recipe.reasoning_parser = value;
        break;
      case "enable-auto-tool-choice":
        recipe.enable_auto_tool_choice = true;
        break;
      case "disable-custom-all-reduce":
        recipe.disable_custom_all_reduce = true;
        break;
      case "trust-remote-code":
        recipe.trust_remote_code = true;
        break;
      case "disable-log-requests":
        recipe.disable_log_requests = true;
        break;
      case "enable-expert-parallel":
        recipe.enable_expert_parallel = true;
        break;
    }
  }

  if (!recipe.id && recipe.model_path) {
    recipe.id = slugifyRecipeId(recipe.model_path.split("/").pop() || "new-recipe");
  }
  if (!recipe.name && recipe.model_path) {
    recipe.name = recipe.model_path.split("/").pop() || "New Recipe";
  }

  return recipe;
}
