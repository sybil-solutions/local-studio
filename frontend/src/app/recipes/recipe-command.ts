// CRITICAL
import type { RecipeEditor } from "@/lib/types";
import { normalizeExtraArgKey, prepareRecipeForSave } from "./recipe-utils";

const appendExtraArgsToCommand = (args: string[], extraArgs: Record<string, unknown>): string[] => {
  const internalKeys = new Set([
    "venv_path",
    "env_vars",
    "visible_devices",
    "cuda_visible_devices",
    "hip_visible_devices",
    "rocr_visible_devices",
    "description",
    "tags",
    "status",
  ]);
  const jsonStringKeys = new Set(["speculative_config", "default_chat_template_kwargs"]);
  const existingFlags = new Set(
    args.flatMap((line) => line.split(" ").filter((part) => part.startsWith("--"))),
  );

  for (const [key, value] of Object.entries(extraArgs)) {
    const normalizedKey = normalizeExtraArgKey(key);
    if (internalKeys.has(normalizedKey)) continue;

    const flag = `--${key.replace(/_/g, "-")}`;
    if (existingFlags.has(flag)) continue;

    if (value === true || value === false) {
      args.push(flag);
      existingFlags.add(flag);
      continue;
    }
    if (value === undefined || value === null || value === "") continue;

    if (typeof value === "string" && jsonStringKeys.has(normalizedKey)) {
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          args.push(`${flag} '${JSON.stringify(parsed)}'`);
          existingFlags.add(flag);
          continue;
        } catch {
          args.push(`${flag} '${value}'`);
          existingFlags.add(flag);
          continue;
        }
      }
    }

    if (Array.isArray(value) || (value && typeof value === "object")) {
      args.push(`${flag} '${JSON.stringify(value)}'`);
      existingFlags.add(flag);
      continue;
    }

    args.push(`${flag} ${value}`);
    existingFlags.add(flag);
  }

  return args;
};

const appendLlamacppArgsToCommand = (args: string[], extraArgs: Record<string, unknown>): string[] => {
  const internalKeys = new Set([
    "venv_path",
    "env_vars",
    "visible_devices",
    "cuda_visible_devices",
    "hip_visible_devices",
    "rocr_visible_devices",
    "description",
    "tags",
    "status",
  ]);

  for (const [key, value] of Object.entries(extraArgs)) {
    const normalizedKey = normalizeExtraArgKey(key);
    if (internalKeys.has(normalizedKey)) continue;

    const flag = `--${key.replace(/_/g, "-")}`;
    if (args.some((entry) => entry.startsWith(flag))) continue;

    if (value === true) {
      args.push(flag);
      continue;
    }
    if (value === false) continue;
    if (value === undefined || value === null || value === "") continue;

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null || entry === "") continue;
        args.push(`${flag} ${entry}`);
      }
      continue;
    }

    if (typeof value === "object") {
      args.push(`${flag} '${JSON.stringify(value)}'`);
      continue;
    }

    args.push(`${flag} ${value}`);
  }

  return args;
};

export const generateCommand = (recipe: RecipeEditor): string => {
  const payload = prepareRecipeForSave(recipe);
  const backend = payload.backend || "vllm";
  const args: string[] = [];

  if (backend === "vllm") {
    args.push("vllm serve");
  } else if (backend === "llamacpp") {
    args.push("llama-server");
  } else {
    args.push("python -m sglang.launch_server");
  }

  if (payload.model_path) {
    if (backend === "llamacpp") {
      args.push(`--model ${payload.model_path}`);
    } else {
      args.push(payload.model_path);
    }
  }

  if (payload.host && payload.host !== "0.0.0.0") args.push(`--host ${payload.host}`);
  if (payload.port && payload.port !== 8000) args.push(`--port ${payload.port}`);
  if (payload.served_model_name) {
    args.push(
      backend === "llamacpp"
        ? `--alias ${payload.served_model_name}`
        : `--served-model-name ${payload.served_model_name}`,
    );
  }

  if (backend !== "llamacpp") {
    if (payload.tensor_parallel_size && payload.tensor_parallel_size > 1) {
      args.push(`--tensor-parallel-size ${payload.tensor_parallel_size}`);
    }
    if (payload.pipeline_parallel_size && payload.pipeline_parallel_size > 1) {
      args.push(`--pipeline-parallel-size ${payload.pipeline_parallel_size}`);
    }
  }

  const ctxOverride = payload.extra_args?.["ctx-size"] ?? payload.extra_args?.["ctx_size"];
  if (backend === "llamacpp") {
    if (!ctxOverride && payload.max_model_len) args.push(`--ctx-size ${payload.max_model_len}`);
  } else {
    if (payload.max_model_len) args.push(`--max-model-len ${payload.max_model_len}`);
    if (payload.max_num_seqs) args.push(`--max-num-seqs ${payload.max_num_seqs}`);
    if (payload.gpu_memory_utilization !== undefined && payload.gpu_memory_utilization !== null) {
      args.push(`--gpu-memory-utilization ${payload.gpu_memory_utilization}`);
    }
    if (payload.kv_cache_dtype && payload.kv_cache_dtype !== "auto") {
      args.push(`--kv-cache-dtype ${payload.kv_cache_dtype}`);
    }
  }

  if (backend !== "llamacpp") {
    if (payload.quantization) args.push(`--quantization ${payload.quantization}`);
    if (payload.dtype && payload.dtype !== "auto") args.push(`--dtype ${payload.dtype}`);

    if (payload.trust_remote_code) args.push("--trust-remote-code");

    if (payload.tool_call_parser) {
      args.push(`--tool-call-parser ${payload.tool_call_parser}`);
      args.push("--enable-auto-tool-choice");
    } else if (payload.enable_auto_tool_choice) {
      args.push("--enable-auto-tool-choice");
    }

    if (payload.reasoning_parser) args.push(`--reasoning-parser ${payload.reasoning_parser}`);

    appendExtraArgsToCommand(args, payload.extra_args ?? {});
  } else {
    appendLlamacppArgsToCommand(args, payload.extra_args ?? {});
  }

  return args.join(" \\\n+  ");
};
