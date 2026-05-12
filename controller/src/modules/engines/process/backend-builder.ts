// CRITICAL
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Recipe } from "../../models/types";
import type { Config } from "../../../config/env";
import { resolveBinary } from "../../../core/command";
import { resolveVllmRecipePythonPath } from "../runtimes/vllm-python-path";
import {
  getDefaultReasoningParser,
  getDefaultToolCallParser,
  shouldEnableExpertParallel,
} from "./model-runtime-defaults";

/**
 * Normalize JSON-like arguments for CLI flags.
 * @param value - Payload value.
 * @returns Normalized payload.
 */
export const normalizeJsonArgument = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonArgument(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [
        key.replace(/-/g, "_"),
        normalizeJsonArgument(entry),
      ])
    );
  }
  return value;
};

/**
 * Get extra arg supporting snake or kebab case.
 * @param extraArguments - Extra args object.
 * @param key - Key to lookup.
 * @returns Matching value or undefined.
 */
export const getExtraArgument = (extraArguments: Record<string, unknown>, key: string): unknown => {
  if (Object.prototype.hasOwnProperty.call(extraArguments, key)) {
    return extraArguments[key];
  }
  const kebab = key.replace(/_/g, "-");
  if (Object.prototype.hasOwnProperty.call(extraArguments, kebab)) {
    return extraArguments[kebab];
  }
  const snake = key.replace(/-/g, "_");
  if (Object.prototype.hasOwnProperty.call(extraArguments, snake)) {
    return extraArguments[snake];
  }
  return undefined;
};

/**
 * Resolve Python path for vLLM or SGLang.
 * @param recipe - Recipe data.
 * @returns Python executable path if resolved.
 */
export const getPythonPath = (recipe: Recipe): string | undefined => {
  if (recipe.python_path && existsSync(recipe.python_path)) {
    return recipe.python_path;
  }
  const venvPath = getExtraArgument(recipe.extra_args, "venv_path");
  if (typeof venvPath === "string") {
    const pythonBin = join(venvPath, "bin", "python");
    if (existsSync(pythonBin)) {
      return pythonBin;
    }
  }
  return undefined;
};

const getVllmPythonPath = (recipe: Recipe): string | undefined => {
  return resolveVllmRecipePythonPath(recipe.python_path) ?? undefined;
};

/**
 * Append extra CLI arguments to a command.
 * @param command - Command array.
 * @param extraArguments - Extra args object.
 * @returns Updated command array.
 */
export const appendExtraArguments = (
  command: string[],
  extraArguments: Record<string, unknown>
): string[] => {
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
    "llama_bin",
    "launch_command",
    "custom_command",
    "docker_container",
    "docker_image",
    "docker-container",
    "exllama_command",
    "exllamav3_command",
    "exllama-cmd",
  ]);
  const jsonStringKeys = new Set(["speculative_config", "default_chat_template_kwargs"]);

  for (const [key, value] of Object.entries(extraArguments)) {
    const normalizedKey = key.replace(/-/g, "_").toLowerCase();
    if (internalKeys.has(normalizedKey)) {
      continue;
    }
    const flag = `--${key.replace(/_/g, "-")}`;
    if (command.includes(flag)) {
      continue;
    }
    if (value === true) {
      command.push(flag);
      continue;
    }
    if (value === false) {
      if (!["enable_expert_parallelism", "enable-expert-parallelism"].includes(normalizedKey)) {
        command.push(flag);
      }
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === "string" && jsonStringKeys.has(normalizedKey)) {
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          command.push(flag, JSON.stringify(normalizeJsonArgument(parsed)));
          continue;
        } catch {
          command.push(flag, value);
          continue;
        }
      }
    }

    if (Array.isArray(value) || (value && typeof value === "object")) {
      command.push(flag, JSON.stringify(normalizeJsonArgument(value)));
      continue;
    }
    command.push(flag, String(value));
  }
  return command;
};

const normalizeLaunchCommand = (command: string): string => {
  return command
    .replace(/\\\s*\n\s*\+?\s*/g, " ")
    .replace(/^\s*\+\s*/gm, "")
    .trim();
};

const splitLaunchCommand = (command: string): string[] => {
  const normalized = normalizeLaunchCommand(command);
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const character of normalized) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }
    if (character === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (escaping) {
    current += "\\";
  }
  if (current) {
    result.push(current);
  }
  return result;
};

const getLaunchCommandOverride = (recipe: Recipe): string[] | null => {
  const override =
    getExtraArgument(recipe.extra_args, "launch_command") ??
    getExtraArgument(recipe.extra_args, "custom_command");
  if (typeof override !== "string" || !override.trim()) {
    return null;
  }
  const command = splitLaunchCommand(override);
  return command.length > 0 ? command : null;
};

/**
 * Build a vLLM launch command.
 * @param recipe - Recipe data.
 * @returns CLI command array.
 */
export const buildVllmCommand = (recipe: Recipe): string[] => {
  const pythonPath = getVllmPythonPath(recipe);
  let command: string[];
  let usesServe = false;
  if (pythonPath) {
    const vllmBin = join(dirname(pythonPath), "vllm");
    if (existsSync(vllmBin)) {
      command = [vllmBin, "serve"];
      usesServe = true;
    } else {
      // Prefer system vllm binary over python -m entrypoint when available,
      // because `vllm serve` accepts model as positional arg while
      // `python -m vllm.entrypoints.openai.api_server` requires --model.
      const systemVllm = resolveBinary("vllm");
      if (systemVllm) {
        command = [systemVllm, "serve"];
        usesServe = true;
      } else {
        command = [pythonPath, "-m", "vllm.entrypoints.openai.api_server"];
      }
    }
  } else {
    const resolvedVllm = resolveBinary("vllm");
    command = [resolvedVllm ?? "vllm", "serve"];
    usesServe = true;
  }

  // `vllm serve` accepts model as positional arg; api_server requires --model flag
  if (usesServe) {
    command.push(recipe.model_path);
  } else {
    command.push("--model", recipe.model_path);
  }
  command.push("--host", recipe.host, "--port", String(recipe.port));

  if (recipe.served_model_name) {
    command.push("--served-model-name", recipe.served_model_name);
  }
  if (recipe.tensor_parallel_size > 1) {
    command.push("--tensor-parallel-size", String(recipe.tensor_parallel_size));
  }
  if (recipe.pipeline_parallel_size > 1) {
    command.push("--pipeline-parallel-size", String(recipe.pipeline_parallel_size));
  }

  const expertParallelExplicit = getExtraArgument(recipe.extra_args, "enable-expert-parallel");
  if (shouldEnableExpertParallel(recipe, expertParallelExplicit)) {
    command.push("--enable-expert-parallel");
  }

  command.push("--max-model-len", String(recipe.max_model_len));
  command.push("--gpu-memory-utilization", String(recipe.gpu_memory_utilization));
  command.push("--max-num-seqs", String(recipe.max_num_seqs));

  if (recipe.kv_cache_dtype !== "auto") {
    command.push("--kv-cache-dtype", recipe.kv_cache_dtype);
  }
  if (recipe.trust_remote_code) {
    command.push("--trust-remote-code");
  }
  // null means explicitly disabled; undefined/missing means use auto-detected default
  const toolCallParser =
    recipe.tool_call_parser !== null ? recipe.tool_call_parser : getDefaultToolCallParser(recipe);
  if (toolCallParser) {
    command.push("--tool-call-parser", toolCallParser, "--enable-auto-tool-choice");
  }
  const reasoningParser =
    recipe.reasoning_parser !== null ? recipe.reasoning_parser : getDefaultReasoningParser(recipe);
  if (reasoningParser) {
    command.push("--reasoning-parser", reasoningParser);
  }
  if (recipe.quantization) {
    command.push("--quantization", recipe.quantization);
  }
  if (recipe.dtype) {
    command.push("--dtype", recipe.dtype);
  }

  return appendExtraArguments(command, recipe.extra_args);
};

/**
 * Split a shell command string into argv-style tokens.
 * Supports quoted tokens to preserve spaces.
 * @param command - Raw command.
 * @returns Tokenized command.
 */
const splitCommand = (command: string): string[] => {
  const matches = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ""));
};

const executableBaseName = (value: string): string => {
  return value.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() ?? value.toLowerCase();
};

const isAllowedExllamaBinary = (value: string): boolean => {
  return executableBaseName(value).includes("exllama");
};

const isAllowedLlamaServerBinary = (value: string): boolean => {
  const name = executableBaseName(value);
  return name === "llama-server" || name === "llama-server.exe";
};

const rejectPathTraversal = (value: string, label: string): void => {
  if (value.split(/[\\/]+/).includes("..")) {
    throw new Error(`Invalid ${label}: path traversal is not allowed`);
  }
};

/**
 * Detect if a command already includes a flag.
 * @param command - Command tokens.
 * @param flag - Flag to check.
 * @returns True if flag exists.
 */
const hasCommandFlag = (command: string[], flag: string): boolean => command.includes(flag);

/**
 * Append model host/port/model arguments if not already present.
 * @param command - Base command.
 * @param recipe - Recipe data.
 * @returns Updated command tokens.
 */
const appendRuntimeCoreArguments = (command: string[], recipe: Recipe): string[] => {
  if (!hasCommandFlag(command, "--host")) {
    command.push("--host", recipe.host);
  }
  if (!hasCommandFlag(command, "--port")) {
    command.push("--port", String(recipe.port));
  }
  if (recipe.served_model_name && !hasCommandFlag(command, "--served-model-name")) {
    command.push("--served-model-name", recipe.served_model_name);
  }
  return command;
};

/**
 * Build an ExLLaMA v3 launch command.
 *
 * Requires an explicit command template either in recipe.extra_args.exllama_command or
 * VLLM_STUDIO_EXLLAMAV3_COMMAND.
 * Extra args are appended for backend-specific tuning.
 * @param recipe - Recipe data.
 * @param config - Runtime config.
 * @returns CLI command array.
 */
export const buildExllamav3Command = (recipe: Recipe, config: Config): string[] | null => {
  const commandTemplate = String(
    getExtraArgument(recipe.extra_args, "exllama_command") ??
      getExtraArgument(recipe.extra_args, "exllamav3_command") ??
      getExtraArgument(recipe.extra_args, "exllama-cmd") ??
      config.exllamav3_command ??
      ""
  ).trim();
  if (!commandTemplate) {
    return null;
  }
  const command = splitCommand(commandTemplate);
  if (command.length === 0) {
    return null;
  }
  const executable = command[0] ?? "";
  rejectPathTraversal(executable, "exllama_command");
  if (!isAllowedExllamaBinary(executable)) {
    throw new Error("Invalid exllama_command: command must be an ExLLaMA executable");
  }
  const resolvedExecutable = resolveBinary(executable);
  if (!resolvedExecutable) {
    throw new Error(`Invalid exllama_command: executable "${executable}" was not found`);
  }
  command[0] = resolvedExecutable;
  const commandWithDefaults = appendRuntimeCoreArguments([...command], recipe);
  if (
    !hasCommandFlag(commandWithDefaults, "--model") &&
    !hasCommandFlag(commandWithDefaults, "--model-path") &&
    !hasCommandFlag(commandWithDefaults, "-m")
  ) {
    commandWithDefaults.push("--model", recipe.model_path);
  }

  return appendExtraArguments(commandWithDefaults, recipe.extra_args);
};

/**
 * Build launch command by backend.
 * @param recipe - Recipe data.
 * @param config - Runtime config.
 * @returns Backend-specific command.
 */
export const buildBackendCommand = (recipe: Recipe, config: Config): string[] => {
  const launchCommand = getLaunchCommandOverride(recipe);
  if (launchCommand) {
    return launchCommand;
  }

  if (recipe.backend === "sglang") {
    return buildSglangCommand(recipe, config);
  }
  if (recipe.backend === "llamacpp") {
    return buildLlamacppCommand(recipe, config);
  }
  if (recipe.backend === "exllamav3") {
    const command = buildExllamav3Command(recipe, config);
    if (!command) {
      throw new Error(
        "Missing ExLLaMA v3 command. Set extra_args.exllama_command or VLLM_STUDIO_EXLLAMAV3_COMMAND."
      );
    }
    return command;
  }
  if (recipe.backend === "tabbyapi") {
    throw new Error(
      "TabbyAPI backend launching is not supported by this controller lifecycle path."
    );
  }
  if (recipe.backend === "transformers") {
    return buildVllmCommand(recipe);
  }
  return buildVllmCommand(recipe);
};

const resolveLlamaBinary = (recipe: Recipe, config: Config): string => {
  const override = getExtraArgument(recipe.extra_args, "llama_bin") ?? config.llama_bin;
  if (typeof override === "string" && override.trim()) {
    rejectPathTraversal(override, "llama_bin");
    if (!isAllowedLlamaServerBinary(override)) {
      throw new Error("Invalid llama_bin: only llama-server executables are allowed");
    }
    const resolved = resolveBinary(override);
    if (resolved) {
      return resolved;
    }
    throw new Error(`Invalid llama_bin: executable "${override}" was not found`);
  }
  return resolveBinary("llama-server") ?? "llama-server";
};

const appendLlamacppArguments = (
  command: string[],
  extraArguments: Record<string, unknown>
): string[] => {
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
    "llama_bin",
    "docker_container",
    "docker_image",
    "docker-container",
  ]);

  for (const [key, value] of Object.entries(extraArguments)) {
    const normalizedKey = key.replace(/-/g, "_").toLowerCase();
    if (internalKeys.has(normalizedKey)) {
      continue;
    }
    const flag = `--${key.replace(/_/g, "-")}`;
    if (command.includes(flag)) {
      continue;
    }
    if (value === true) {
      command.push(flag);
      continue;
    }
    if (value === false) {
      continue;
    }
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null || entry === "") {
          continue;
        }
        command.push(flag, String(entry));
      }
      continue;
    }
    if (typeof value === "object") {
      command.push(flag, JSON.stringify(value));
      continue;
    }
    command.push(flag, String(value));
  }
  return command;
};

/**
 * Build a llama.cpp launch command.
 * @param recipe - Recipe data.
 * @param config - Runtime config.
 * @returns CLI command array.
 */
export const buildLlamacppCommand = (recipe: Recipe, config: Config): string[] => {
  const command: string[] = [resolveLlamaBinary(recipe, config)];
  command.push("--model", recipe.model_path, "--host", recipe.host, "--port", String(recipe.port));

  if (recipe.served_model_name) {
    command.push("--alias", recipe.served_model_name);
  }
  const ctxOverride = getExtraArgument(recipe.extra_args, "ctx-size");
  if (!ctxOverride && recipe.max_model_len > 0) {
    command.push("--ctx-size", String(recipe.max_model_len));
  }

  return appendLlamacppArguments(command, recipe.extra_args);
};

/**
 * Build an SGLang launch command.
 * @param recipe - Recipe data.
 * @param config - Runtime config.
 * @returns CLI command array.
 */
export const buildSglangCommand = (recipe: Recipe, config: Config): string[] => {
  const python = getPythonPath(recipe) || config.sglang_python || "python";
  const command = [python, "-m", "sglang.launch_server"];
  command.push("--model-path", recipe.model_path);
  command.push("--host", recipe.host, "--port", String(recipe.port));

  if (recipe.served_model_name) {
    command.push("--served-model-name", recipe.served_model_name);
  }
  if (recipe.tensor_parallel_size > 1) {
    command.push("--tensor-parallel-size", String(recipe.tensor_parallel_size));
  }
  if (recipe.pipeline_parallel_size > 1) {
    command.push("--pipeline-parallel-size", String(recipe.pipeline_parallel_size));
  }

  command.push("--context-length", String(recipe.max_model_len));
  command.push("--mem-fraction-static", String(recipe.gpu_memory_utilization));
  if (recipe.max_num_seqs > 0) {
    command.push("--max-running-requests", String(recipe.max_num_seqs));
  }
  if (recipe.trust_remote_code) {
    command.push("--trust-remote-code");
  }
  if (recipe.quantization) {
    command.push("--quantization", recipe.quantization);
  }
  if (recipe.kv_cache_dtype && recipe.kv_cache_dtype !== "auto") {
    command.push("--kv-cache-dtype", recipe.kv_cache_dtype);
  }
  if (getExtraArgument(recipe.extra_args, "enable-metrics") === undefined) {
    command.push("--enable-metrics");
  }

  // Note: sglang auto-enables tool choice when --tool-call-parser is set; no equivalent
  // to vLLM's --enable-auto-tool-choice flag. The recipe.enable_auto_tool_choice field is
  // honored by the vLLM builder only.
  const toolCallParser =
    recipe.tool_call_parser !== null ? recipe.tool_call_parser : getDefaultToolCallParser(recipe);
  if (toolCallParser) {
    command.push("--tool-call-parser", toolCallParser);
  }
  const reasoningParser =
    recipe.reasoning_parser !== null ? recipe.reasoning_parser : getDefaultReasoningParser(recipe);
  if (reasoningParser) {
    command.push("--reasoning-parser", reasoningParser);
  }

  return appendExtraArguments(command, recipe.extra_args);
};
