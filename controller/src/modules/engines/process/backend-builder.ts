import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Recipe } from "../../models/types";
import type { Config } from "../../../config/env";
import {
  getUnknownVllmExtraArgKeys,
  looksLikeNotesKey,
  stripForeignFlagKeys,
} from "../../../../../shared/contracts/engine-args";
import type { Logger } from "../../../core/logger";
import { resolveBinary } from "../../../core/command";
import { resolveVllmRecipePythonPath } from "../runtimes/vllm-python-path";
import { getEngineSpec } from "../engine-spec";
import {
  getDefaultReasoningParser,
  getDefaultToolCallParser,
  shouldEnableExpertParallel,
} from "./model-runtime-defaults";
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
export const getVllmPythonPath = (recipe: Recipe): string | undefined => {
  return resolveVllmRecipePythonPath(recipe.python_path) ?? undefined;
};
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
    "mlx_python",
    "launch_command",
    "custom_command",
    "docker_container",
    "docker_image",
    "docker-container",
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

/**
 * Filter `extraArguments` against the vLLM `serve` flag allowlist and pass the
 * remainder to `appendExtraArguments`. Unknown keys would otherwise be
 * forwarded verbatim, which crashes vLLM with `unrecognized arguments`
 * (real-world example: `benchmark_notes_20260622` blocks the
 * `glm-5-2-504b-term` recipe from booting).
 *
 * Behaviour:
 *   - Unknown keys are dropped unless `LOCAL_STUDIO_ALLOW_UNKNOWN_VLLM_EXTRA_ARGS`
 *     is set to `true` (escape hatch for forked vLLM builds outside the
 *     allowlist).
 *   - Each drop is logged via `logger` (or `console.warn` as a fallback) so the
 *     upstream recipe can be cleaned up.
 *   - Keys that look like free-form notes/annotations are advised to live
 *     under `description` / `metadata` instead.
 */
export const appendVllmExtraArguments = (
  command: string[],
  extraArguments: Record<string, unknown>,
  logger?: Logger,
): string[] => {
  const allowUnknown = process.env["LOCAL_STUDIO_ALLOW_UNKNOWN_VLLM_EXTRA_ARGS"] === "true";
  if (allowUnknown) {
    return appendExtraArguments(command, extraArguments);
  }
  const unknown = getUnknownVllmExtraArgKeys(extraArguments);
  if (unknown.length === 0) {
    return appendExtraArguments(command, extraArguments);
  }
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extraArguments)) {
    if (!unknown.includes(key)) {
      filtered[key] = value;
    }
  }
  const strict = process.env["LOCAL_STUDIO_STRICT_VLLM_EXTRA_ARGS"] === "true";
  for (const key of unknown) {
    const noteLike = looksLikeNotesKey(key);
    const detail: Record<string, unknown> = {
      key,
      hint: noteLike
        ? "vLLM has no such flag; store notes under recipe.description or recipe.metadata"
        : "Add the flag to KNOWN_VLLM_EXTRA_ARG_KEYS in shared/contracts/engine-args.ts, or set LOCAL_STUDIO_ALLOW_UNKNOWN_VLLM_EXTRA_ARGS=true as a temporary escape hatch",
    };
    if (logger) {
      if (strict) {
        logger.error("[vllm-extra-args] dropping unknown vLLM extra_args key in strict mode", detail);
      } else {
        logger.warn("[vllm-extra-args] dropping unknown vLLM extra_args key", detail);
      }
    } else if (strict) {
      console.error("[vllm-extra-args] dropping unknown vLLM extra_args key in strict mode", detail);
    } else {
      console.warn("[vllm-extra-args] dropping unknown vLLM extra_args key", detail);
    }
  }
  return appendExtraArguments(command, filtered);
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
  // A recipe launch_command/custom_command is arbitrary-binary execution as the
  // controller user. Honour it only when the operator has opted in; otherwise
  // ignore the override and build the command from the structured recipe fields.
  if (process.env["LOCAL_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND"] !== "true") {
    return null;
  }
  const command = splitLaunchCommand(override);
  return command.length > 0 ? command : null;
};

/** In-container path to the vLLM CLI for forked Docker images. */
export const CONTAINER_VLLM_BIN = "/opt/venv/bin/vllm";
const DOCKER_JIT_MOUNT = "/cache/jit";

/**
 * Env keys that must NOT be forwarded into the container; the image's own baked
 * value (sometimes intentionally empty) is required.
 *
 * NOTE: `NCCL_GRAPH_FILE` is deliberately NOT skipped. The voipmonitor "noxml"
 * NCCL build treats an empty `NCCL_GRAPH_FILE` as a fatal error, so recipes set
 * it to `/dev/null` and that override must reach the container.
 */
const DOCKER_ENV_SKIP_KEYS = new Set(["NCCL_GRAPH_DUMP_FILE", "VLLM_B12X_MLA_EXTEND_MAX_CHUNKS"]);

/** Read the pinned Docker image for a recipe, if any (`extra_args.docker_image`). */
export const getDockerImage = (recipe: Recipe): string | null => {
  const value =
    getExtraArgument(recipe.extra_args, "docker_image") ??
    getExtraArgument(recipe.extra_args, "docker-image");
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const sanitizeDockerName = (value: string): string => {
  const cleaned = value.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/^[^a-zA-Z0-9]+/, "");
  return cleaned.length > 0 ? cleaned : "recipe";
};

const buildDockerEnvFlags = (recipe: Recipe): string[] => {
  const flags: string[] = [];
  const seen = new Set<string>();
  const addEnv = (source: unknown): void => {
    if (!source || typeof source !== "object") {
      return;
    }
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if (seen.has(key) || DOCKER_ENV_SKIP_KEYS.has(key)) continue;
      seen.add(key);
      flags.push("-e", `${key}=${String(value)}`);
    }
  };
  addEnv(recipe.env_vars);
  addEnv(getExtraArgument(recipe.extra_args, "env_vars"));
  return flags;
};

/**
 * Wrap a vLLM `serve` invocation so it runs inside a pinned Docker image
 * (`extra_args.docker_image`). Used for forked vLLM builds (e.g. voipmonitor
 * B12X) that cannot be installed into the host venv.
 *
 * The container runs in the foreground as the controller's child process, so
 * the existing process-manager stop path tears it down (SIGTERM proxies to the
 * container; `--rm` removes it). `--network host` lets vLLM bind the recipe's
 * port directly, and a per-recipe named volume persists the JIT compile cache.
 */
export const wrapVllmInDocker = (recipe: Recipe, image: string, inner: string[]): string[] => {
  const name = `local-studio-${sanitizeDockerName(recipe.id)}`;
  const jitVolume = `local-studio-jit-${sanitizeDockerName(recipe.id)}`;
  const model = recipe.model_path;
  const flags = [
    "docker",
    "run",
    "--rm",
    "--name",
    name,
    "--gpus",
    "all",
    "--network",
    "host",
    "--ipc",
    "host",
    "--shm-size",
    "32g",
    "--privileged",
    "--ulimit",
    "memlock=-1",
    "--ulimit",
    "stack=67108864",
  ];
  flags.push(...buildDockerEnvFlags(recipe));
  flags.push(
    "-e",
    `XDG_CACHE_HOME=${DOCKER_JIT_MOUNT}`,
    "-e",
    `CUDA_CACHE_PATH=${DOCKER_JIT_MOUNT}`,
    "-e",
    `VLLM_CACHE_DIR=${DOCKER_JIT_MOUNT}/vllm`,
    "-e",
    `TRITON_CACHE_DIR=${DOCKER_JIT_MOUNT}/triton`,
  );
  flags.push("-v", `${model}:${model}:ro`);
  flags.push("-v", `${jitVolume}:${DOCKER_JIT_MOUNT}`);
  flags.push(image);
  flags.push(...inner);
  return flags;
};

export const buildVllmCommand = (recipe: Recipe): string[] => {
  const dockerImage = getDockerImage(recipe);
  const pythonPath = getVllmPythonPath(recipe);
  let command: string[];
  let usesServe = false;
  if (dockerImage) {
    command = [CONTAINER_VLLM_BIN, "serve"];
    usesServe = true;
  } else if (pythonPath) {
    const vllmBin = join(dirname(pythonPath), "vllm");
    if (existsSync(vllmBin)) {
      command = [vllmBin, "serve"];
      usesServe = true;
    } else {
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
  const built = appendVllmExtraArguments(command, recipe.extra_args);
  return dockerImage ? wrapVllmInDocker(recipe, dockerImage, built) : built;
};
const executableBaseName = (value: string): string => {
  return value.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() ?? value.toLowerCase();
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
export const buildMlxCommand = (recipe: Recipe, config: Config): string[] => {
  const python = getPythonPath(recipe) || config.mlx_python || "python3";
  const command = [python, "-m", "mlx_lm.server"];
  command.push("--model", recipe.model_path, "--host", recipe.host, "--port", String(recipe.port));
  return appendExtraArguments(command, stripForeignFlagKeys("mlx", recipe.extra_args));
};
export const buildBackendCommand = (recipe: Recipe, config: Config): string[] => {
  const launchCommand = getLaunchCommandOverride(recipe);
  if (launchCommand) {
    return launchCommand;
  }
  return getEngineSpec(recipe.backend).buildCommand(recipe, config);
};
export const resolveLlamaBinary = (recipe: Recipe, config: Config): string => {
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
export const appendLlamacppArguments = (
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
  return appendLlamacppArguments(command, stripForeignFlagKeys("llamacpp", recipe.extra_args));
};
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
  return appendExtraArguments(command, stripForeignFlagKeys("sglang", recipe.extra_args));
};
