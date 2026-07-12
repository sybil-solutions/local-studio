import { dirname, join } from "node:path";
import type { Config } from "../../../config/env";
import { resolveBinary } from "../../../core/command";
import type { ProcessInfo, Recipe } from "../../models/types";
import type { RuntimeBackendInfo } from "@local-studio/contracts/system";
import {
  getVllmConfigHelp,
  getVllmRuntimeInfo,
  installVllmRuntime,
} from "../runtimes/vllm-runtime";
import { normalizePackageSpec, probeVllmBinaryRuntime } from "../runtimes/runtime-target-probes";
import { resolveVllmPythonPath } from "../runtimes/vllm-python-path";
import {
  getUnknownVllmExtraArgKeys as getUnknownVllmExtraArgumentKeys,
  looksLikeNotesKey,
} from "@local-studio/contracts/engine-args";
import type { Logger } from "../../../core/logger";
import {
  appendExtraArguments,
  buildDockerRunArguments,
  getExtraArgument,
  sanitizeDockerName,
} from "../process/backend-builder";
import { managedVenvPython } from "../runtimes/managed-venv";
import {
  getDefaultReasoningParser,
  getDefaultToolCallParser,
  shouldEnableExpertParallel,
} from "../process/model-runtime-defaults";
import {
  extractFlag,
  hasCliServeInvocation,
  hasModuleInvocation,
  positionalAfterServe,
} from "../argument-utilities";
import type { BinaryProbeResult, ConfigHelpResult, EngineSpec } from "../engine-spec";

/** In-container path to the vLLM CLI for forked Docker images. */
export const CONTAINER_VLLM_BIN = "/opt/venv/bin/vllm";
const DOCKER_JIT_MOUNT = "/cache/jit";

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
  const unknown = getUnknownVllmExtraArgumentKeys(extraArguments);
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
        logger.error(
          "[vllm-extra-args] dropping unknown vLLM extra_args key in strict mode",
          detail,
        );
      } else {
        logger.warn("[vllm-extra-args] dropping unknown vLLM extra_args key", detail);
      }
    } else if (strict) {
      console.error(
        "[vllm-extra-args] dropping unknown vLLM extra_args key in strict mode",
        detail,
      );
    } else {
      console.warn("[vllm-extra-args] dropping unknown vLLM extra_args key", detail);
    }
  }
  return appendExtraArguments(command, filtered);
};

export const wrapVllmInDocker = (recipe: Recipe, image: string, inner: string[]): string[] => {
  const jitVolume = `local-studio-jit-${sanitizeDockerName(recipe.id)}`;
  return buildDockerRunArguments({
    recipe,
    image,
    inner,
    extraEnv: {
      XDG_CACHE_HOME: DOCKER_JIT_MOUNT,
      CUDA_CACHE_PATH: DOCKER_JIT_MOUNT,
      VLLM_CACHE_DIR: `${DOCKER_JIT_MOUNT}/vllm`,
      TRITON_CACHE_DIR: `${DOCKER_JIT_MOUNT}/triton`,
    },
    extraVolumes: [`${jitVolume}:${DOCKER_JIT_MOUNT}`],
  });
};


export const buildVllmRecipeArguments = (recipe: Recipe): string[] => {
  const command: string[] = ["--host", recipe.host, "--port", String(recipe.port)];
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
  return appendVllmExtraArguments(command, recipe.extra_args);
};

const pythonCommand = (pythonPath: string): { command: string[]; usesServe: boolean } => {
  const python = resolveBinary(pythonPath);
  if (!python) throw new Error(`vLLM Python runtime was not found at ${pythonPath}`);
  const vllmBinary = resolveBinary(join(dirname(python), "vllm"));
  return vllmBinary
    ? { command: [vllmBinary, "serve"], usesServe: true }
    : {
        command: [python, "-m", "vllm.entrypoints.openai.api_server"],
        usesServe: false,
      };
};

const binaryCommand = (reference: string): { command: string[]; usesServe: boolean } => {
  const binary = resolveBinary(reference);
  if (!binary) throw new Error(`vLLM runtime was not found at ${reference}`);
  return { command: [binary, "serve"], usesServe: true };
};

const hostCommand = (recipe: Recipe, config: Config): { command: string[]; usesServe: boolean } => {
  if (recipe.runtime.kind === "managed_venv") {
    return pythonCommand(managedVenvPython(config, "vllm"));
  }
  const reference = recipe.runtime.ref;
  if (recipe.runtime.kind === "system" && /(^|[/\\])python(?:3(?:\.\d+)?)?$/u.test(reference)) {
    return pythonCommand(reference);
  }
  return binaryCommand(reference);
};

export const buildVllmCommand = (recipe: Recipe, config: Config): string[] => {
  const dockerImage = recipe.runtime.kind === "docker" ? recipe.runtime.ref : null;
  const { command, usesServe } = dockerImage
    ? { command: [CONTAINER_VLLM_BIN, "serve"], usesServe: true }
    : hostCommand(recipe, config);
  if (usesServe) {
    command.push(recipe.model_path);
  } else {
    command.push("--model", recipe.model_path);
  }
  const built = [...command, ...buildVllmRecipeArguments(recipe)];
  return dockerImage ? wrapVllmInDocker(recipe, dockerImage, built) : built;
};

const managedPackageSpec = (version?: string | null): string =>
  normalizePackageSpec("vllm", version);

const detectInvocation = (args: string[]): boolean => {
  if (hasModuleInvocation(args, "vllm.entrypoints.openai.api_server")) return true;
  if (hasCliServeInvocation(args, "vllm")) return true;
  return false;
};

const extractModelPath = (args: string[]): string | null => {
  const flagModel = extractFlag(args, "--model");
  if (flagModel) return flagModel;
  const flagModelPath = extractFlag(args, "--model-path");
  if (flagModelPath) return flagModelPath;
  return positionalAfterServe(args);
};

const extractServedModelName = (args: string[]): string | null => {
  return extractFlag(args, "--served-model-name") ?? null;
};

const probeBinary = async (binary: string): Promise<BinaryProbeResult> => {
  const result = await probeVllmBinaryRuntime(binary);
  return {
    installed: result.installed,
    version: result.version,
    binaryPath: result.binaryPath,
    ...(result.pythonPath ? { pythonPath: result.pythonPath } : {}),
    ...(result.message ? { message: result.message } : {}),
  };
};

const getRuntimeInfoAsync = async (
  _config: Config,
  _runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Promise<RuntimeBackendInfo> => {
  const info = await getVllmRuntimeInfo();
  return {
    installed: info.installed,
    version: info.version,
    python_path: info.python_path,
    binary_path: info.vllm_bin,
    upgrade_command_available: Boolean(info.python_path),
  };
};

const getConfigHelp = async (_config: Config): Promise<ConfigHelpResult> => {
  return getVllmConfigHelp();
};

export const vllmSpec: EngineSpec = {
  id: "vllm",
  healthPath: "/health",
  cliBinary: "vllm",
  buildCommand: (recipe: Recipe, config: Config) => buildVllmCommand(recipe, config),
  managedPackageSpec,
  install: installVllmRuntime,
  detectInvocation,
  extractModelPath,
  extractServedModelName,
  probeBinary,
  resolvePythonPath: (config: Config) => resolveVllmPythonPath(config.data_dir),
  getRuntimeInfo: getRuntimeInfoAsync,
  getConfigHelp,
};
