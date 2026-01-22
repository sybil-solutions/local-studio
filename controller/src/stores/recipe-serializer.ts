import { z } from "zod";
import type { Recipe } from "../types/models";
import { asRecipeId } from "../types/brand";

/**
 * Normalize raw recipe input before validation.
 * @param raw - Unknown recipe payload.
 * @returns Normalized record.
 */
export const normalizeRecipeInput = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid recipe payload");
  }
  const data = { ...(raw as Record<string, unknown>) };
  const extraArguments = { ...((data["extra_args"] as Record<string, unknown> | undefined) ?? {}) };

  if (data["backend"] === undefined && data["engine"] !== undefined) {
    data["backend"] = data["engine"];
    delete data["engine"];
  }

  if (data["tensor_parallel_size"] === undefined && data["tp"] !== undefined) {
    data["tensor_parallel_size"] = data["tp"];
  }
  if (data["pipeline_parallel_size"] === undefined && data["pp"] !== undefined) {
    data["pipeline_parallel_size"] = data["pp"];
  }

  const envCandidates = ["env_vars", "env-vars", "envVars"];
  const hasEnvironmentVariables =
    data["env_vars"] !== undefined || data["env-vars"] !== undefined || data["envVars"] !== undefined;
  if (!hasEnvironmentVariables) {
    for (const key of envCandidates) {
      if (key in extraArguments) {
        data["env_vars"] = extraArguments[key];
        delete extraArguments[key];
        break;
      }
    }
  } else if (data["env-vars"]) {
    data["env_vars"] = data["env-vars"];
    delete data["env-vars"];
  } else if (data["envVars"]) {
    data["env_vars"] = data["envVars"];
    delete data["envVars"];
  }

  const knownKeys = new Set([
    "id",
    "name",
    "model_path",
    "backend",
    "env_vars",
    "tensor_parallel_size",
    "pipeline_parallel_size",
    "max_model_len",
    "gpu_memory_utilization",
    "kv_cache_dtype",
    "max_num_seqs",
    "trust_remote_code",
    "tool_call_parser",
    "reasoning_parser",
    "enable_auto_tool_choice",
    "quantization",
    "dtype",
    "host",
    "port",
    "served_model_name",
    "python_path",
    "extra_args",
    "max_thinking_tokens",
    "thinking_mode",
    "tp",
    "pp",
  ]);

  for (const key of Object.keys(data)) {
    if (!knownKeys.has(key)) {
      extraArguments[key] = data[key];
      delete data[key];
    }
  }

  data["extra_args"] = extraArguments;
  return data;
};

/**
 * Zod schema for validated recipe input.
 */
export const recipeSchema = z.object({
  id: z.string(),
  name: z.string(),
  model_path: z.string(),
  backend: z.enum(["vllm", "sglang", "transformers"]).default("vllm"),
  env_vars: z.record(z.string()).nullable().optional(),
  tensor_parallel_size: z.coerce.number().int().default(1),
  pipeline_parallel_size: z.coerce.number().int().default(1),
  max_model_len: z.coerce.number().int().default(32768),
  gpu_memory_utilization: z.coerce.number().default(0.9),
  kv_cache_dtype: z.string().default("auto"),
  max_num_seqs: z.coerce.number().int().default(256),
  trust_remote_code: z.coerce.boolean().default(true),
  tool_call_parser: z.string().nullable().optional(),
  reasoning_parser: z.string().nullable().optional(),
  enable_auto_tool_choice: z.coerce.boolean().default(false),
  quantization: z.string().nullable().optional(),
  dtype: z.string().nullable().optional(),
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().default(8000),
  served_model_name: z.string().nullable().optional(),
  python_path: z.string().nullable().optional(),
  extra_args: z.record(z.unknown()).default({}),
  max_thinking_tokens: z.coerce.number().int().nullable().optional(),
  thinking_mode: z.string().default("conservative"),
});

/**
 * Parse and normalize a recipe payload.
 * @param raw - Raw recipe payload.
 * @returns Parsed recipe.
 */
export const parseRecipe = (raw: unknown): Recipe => {
  const normalized = normalizeRecipeInput(raw);
  const parsed = recipeSchema.parse(normalized);
  const environmentVariables = parsed.env_vars
    ? Object.fromEntries(Object.entries(parsed.env_vars).map(([key, value]) => [key, String(value)]))
    : null;
  return {
    ...parsed,
    id: asRecipeId(parsed.id),
    env_vars: environmentVariables,
    tool_call_parser: parsed.tool_call_parser ?? null,
    reasoning_parser: parsed.reasoning_parser ?? null,
    quantization: parsed.quantization ?? null,
    dtype: parsed.dtype ?? null,
    served_model_name: parsed.served_model_name ?? null,
    python_path: parsed.python_path ?? null,
    max_thinking_tokens: parsed.max_thinking_tokens ?? null,
    extra_args: parsed.extra_args ?? {},
  };
};
