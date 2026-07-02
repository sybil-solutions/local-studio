import {
  isInternalRecipeKey,
  isJsonStringArgumentKey,
} from "@local-studio/contracts/engine-args";
import type { RecipeEditor } from "./recipe-editor";
import { normalizeExtraArgKey } from "./extra-args";
import { prepareRecipeForSave } from "./prepare-recipe";

const appendExtraArgsToCommand = (args: string[], extraArgs: Record<string, unknown>): string[] => {
  const existingFlags = new Set(
    args.flatMap((line) => line.split(" ").filter((part) => part.startsWith("--"))),
  );

  for (const [key, value] of Object.entries(extraArgs)) {
    if (isInternalRecipeKey(key)) continue;

    const flag = `--${key.replace(/_/g, "-")}`;
    if (existingFlags.has(flag)) continue;

    if (value === true || value === false) {
      args.push(flag);
      existingFlags.add(flag);
      continue;
    }
    if (value === undefined || value === null || value === "") continue;

    if (typeof value === "string" && isJsonStringArgumentKey(key)) {
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

const hasExtraArgument = (extraArgs: Record<string, unknown>, key: string): boolean => {
  const normalized = normalizeExtraArgKey(key);
  return Object.keys(extraArgs).some((entry) => normalizeExtraArgKey(entry) === normalized);
};

const appendLlamacppArgsToCommand = (
  args: string[],
  extraArgs: Record<string, unknown>,
): string[] => {
  for (const [key, value] of Object.entries(extraArgs)) {
    if (isInternalRecipeKey(key)) continue;

    const flag = `--${key.replace(/_/g, "-")}`;
    // Match the flag as a whole token (bare, or immediately followed by its
    // value after a space). A plain startsWith let a longer sibling flag
    // (e.g. an existing "--rope-scaling linear") suppress a distinct shorter
    // flag ("--rope-scale").
    if (args.some((entry) => entry === flag || entry.startsWith(`${flag} `))) continue;

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

type RecipeCommandPayload = ReturnType<typeof prepareRecipeForSave>;

export const generateCommand = (
  recipe: RecipeEditor,
  options: { includeCommandOverride?: boolean } = {},
): string => {
  const payload = prepareRecipeForSave(recipe);
  const commandOverride =
    payload.extra_args?.["launch_command"] ?? payload.extra_args?.["custom_command"];
  if (
    options.includeCommandOverride !== false &&
    typeof commandOverride === "string" &&
    commandOverride.trim()
  ) {
    return commandOverride;
  }

  const backend = payload.backend || "vllm";
  const args: string[] = [];
  appendBackendCommand(args, backend);
  appendModelArgument(args, backend, payload.model_path);
  appendNetworkArguments(args, backend, payload);
  appendParallelArguments(args, backend, payload);
  appendContextArguments(args, backend, payload);
  appendBackendSpecificArguments(args, backend, payload);

  return args.join(" \\\n  ");
};

function appendBackendCommand(args: string[], backend: string) {
  if (backend === "vllm") args.push("vllm serve");
  else if (backend === "llamacpp") args.push("llama-server");
  else if (backend === "mlx") args.push("python -m mlx_lm.server");
  else args.push("python -m sglang.launch_server");
}

function appendModelArgument(args: string[], backend: string, modelPath?: string) {
  if (!modelPath) return;
  if (backend === "llamacpp" || backend === "mlx") args.push(`--model ${modelPath}`);
  else if (backend === "sglang") args.push(`--model-path ${modelPath}`);
  else args.push(modelPath);
}

function appendNetworkArguments(args: string[], backend: string, payload: RecipeCommandPayload) {
  if (payload.host && payload.host !== "0.0.0.0") args.push(`--host ${payload.host}`);
  if (payload.port && payload.port !== 8000) args.push(`--port ${payload.port}`);
  if (payload.served_model_name && backend !== "mlx") {
    args.push(
      backend === "llamacpp"
        ? `--alias ${payload.served_model_name}`
        : `--served-model-name ${payload.served_model_name}`,
    );
  }
}

function appendParallelArguments(args: string[], backend: string, payload: RecipeCommandPayload) {
  if (backend === "llamacpp" || backend === "mlx") return;
  if (payload.tensor_parallel_size && payload.tensor_parallel_size > 1) {
    args.push(`--tensor-parallel-size ${payload.tensor_parallel_size}`);
  }
  if (payload.pipeline_parallel_size && payload.pipeline_parallel_size > 1) {
    args.push(`--pipeline-parallel-size ${payload.pipeline_parallel_size}`);
  }
}

function appendContextArguments(args: string[], backend: string, payload: RecipeCommandPayload) {
  const ctxOverride = payload.extra_args?.["ctx-size"] ?? payload.extra_args?.["ctx_size"];
  if (backend === "llamacpp") {
    if (!ctxOverride && payload.max_model_len) args.push(`--ctx-size ${payload.max_model_len}`);
    return;
  }
  if (backend === "mlx") return;
  if (payload.max_model_len) {
    args.push(
      backend === "sglang"
        ? `--context-length ${payload.max_model_len}`
        : `--max-model-len ${payload.max_model_len}`,
    );
  }
  if (payload.max_num_seqs) {
    args.push(
      backend === "sglang"
        ? `--max-running-requests ${payload.max_num_seqs}`
        : `--max-num-seqs ${payload.max_num_seqs}`,
    );
  }
  if (payload.gpu_memory_utilization !== undefined && payload.gpu_memory_utilization !== null) {
    args.push(
      backend === "sglang"
        ? `--mem-fraction-static ${payload.gpu_memory_utilization}`
        : `--gpu-memory-utilization ${payload.gpu_memory_utilization}`,
    );
  }
  if (payload.kv_cache_dtype && payload.kv_cache_dtype !== "auto") {
    args.push(`--kv-cache-dtype ${payload.kv_cache_dtype}`);
  }
}

function appendBackendSpecificArguments(
  args: string[],
  backend: string,
  payload: RecipeCommandPayload,
) {
  if (backend === "llamacpp" || backend === "mlx") {
    appendLlamacppArgsToCommand(args, payload.extra_args ?? {});
    return;
  }
  appendRuntimeOptions(args, backend, payload);
  appendExtraArgsToCommand(args, payload.extra_args ?? {});
}

function appendRuntimeOptions(args: string[], backend: string, payload: RecipeCommandPayload) {
  if (payload.quantization) args.push(`--quantization ${payload.quantization}`);
  if (payload.dtype && payload.dtype !== "auto") args.push(`--dtype ${payload.dtype}`);
  if (payload.trust_remote_code) args.push("--trust-remote-code");
  appendToolOptions(args, backend, payload);
  if (payload.reasoning_parser) args.push(`--reasoning-parser ${payload.reasoning_parser}`);
  if (backend === "sglang" && !hasExtraArgument(payload.extra_args ?? {}, "enable-metrics")) {
    args.push("--enable-metrics");
  }
}

function appendToolOptions(args: string[], backend: string, payload: RecipeCommandPayload) {
  if (payload.tool_call_parser) {
    args.push(`--tool-call-parser ${payload.tool_call_parser}`);
    if (backend !== "sglang") args.push("--enable-auto-tool-choice");
    return;
  }
  if (payload.enable_auto_tool_choice && backend !== "sglang") {
    args.push("--enable-auto-tool-choice");
  }
}
