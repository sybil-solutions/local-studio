import { Schema } from "effect";
import type { Recipe } from "../types";
import { asRecipeId } from "../types";

const integerSchema = Schema.Number.check(Schema.isInt());

const nullableStringSchema = Schema.Union([Schema.Null, Schema.String]);

const coerceNumber = (value: unknown, fallback: number): number =>
  value === undefined ? fallback : Number(value);

const coerceNullableNumber = (value: unknown): number | null =>
  value === undefined || value === null ? null : Number(value);

const coerceBoolean = (value: unknown, fallback: boolean): boolean =>
  value === undefined ? fallback : Boolean(value);

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
    data["env_vars"] !== undefined ||
    data["env-vars"] !== undefined ||
    data["envVars"] !== undefined;
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
 * Effect v4 schema for validated recipe input.
 */
export const recipeSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  model_path: Schema.String,
  backend: Schema.Literals(["vllm", "sglang", "llamacpp", "mlx"]),
  env_vars: Schema.Union([Schema.Null, Schema.Record(Schema.String, Schema.String)]),
  tensor_parallel_size: integerSchema,
  pipeline_parallel_size: integerSchema,
  max_model_len: integerSchema,
  gpu_memory_utilization: Schema.Number,
  kv_cache_dtype: Schema.String,
  max_num_seqs: integerSchema,
  // Defaults to true (unchanged from before) so launching models that need
  // custom modeling code keeps working out of the box. Security-conscious
  // operators can flip the default off with
  // LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE=false.
  trust_remote_code: Schema.Boolean,
  tool_call_parser: nullableStringSchema,
  reasoning_parser: nullableStringSchema,
  enable_auto_tool_choice: Schema.Boolean,
  quantization: nullableStringSchema,
  dtype: nullableStringSchema,
  host: Schema.String,
  port: integerSchema,
  served_model_name: nullableStringSchema,
  python_path: nullableStringSchema,
  extra_args: Schema.Record(Schema.String, Schema.Unknown),
  max_thinking_tokens: Schema.Union([Schema.Null, integerSchema]),
  thinking_mode: Schema.String,
});

/**
 * Parse and normalize a recipe payload.
 * @param raw - Raw recipe payload.
 * @returns Parsed recipe.
 */
export const parseRecipe = (raw: unknown): Recipe => {
  const normalized = normalizeRecipeInput(raw);
  const parsed = Schema.decodeUnknownSync(recipeSchema, {
    onExcessProperty: "preserve",
  })({
    ...normalized,
    backend: normalized["backend"] ?? "vllm",
    env_vars: normalized["env_vars"] ?? null,
    tensor_parallel_size: coerceNumber(normalized["tensor_parallel_size"], 1),
    pipeline_parallel_size: coerceNumber(normalized["pipeline_parallel_size"], 1),
    max_model_len: coerceNumber(normalized["max_model_len"], 32768),
    gpu_memory_utilization: coerceNumber(normalized["gpu_memory_utilization"], 0.9),
    kv_cache_dtype: normalized["kv_cache_dtype"] ?? "auto",
    max_num_seqs: coerceNumber(normalized["max_num_seqs"], 256),
    trust_remote_code: coerceBoolean(
      normalized["trust_remote_code"],
      process.env["LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE"] !== "false",
    ),
    tool_call_parser: normalized["tool_call_parser"] ?? null,
    reasoning_parser: normalized["reasoning_parser"] ?? null,
    enable_auto_tool_choice: coerceBoolean(normalized["enable_auto_tool_choice"], false),
    quantization: normalized["quantization"] ?? null,
    dtype: normalized["dtype"] ?? null,
    host: normalized["host"] ?? "0.0.0.0",
    port: coerceNumber(normalized["port"], 8000),
    served_model_name: normalized["served_model_name"] ?? null,
    python_path: normalized["python_path"] ?? null,
    extra_args: normalized["extra_args"] ?? {},
    max_thinking_tokens: coerceNullableNumber(normalized["max_thinking_tokens"]),
    thinking_mode: normalized["thinking_mode"] ?? "conservative",
  });
  const environmentVariables = parsed.env_vars
    ? Object.fromEntries(
        Object.entries(parsed.env_vars).map(([key, value]) => [key, String(value)])
      )
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
