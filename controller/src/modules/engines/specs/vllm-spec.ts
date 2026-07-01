import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Config } from "../../../config/env";
import { resolveBinary } from "../../../core/command";
import type { ProcessInfo, Recipe } from "../../models/types";
import type { RuntimeBackendInfo } from "../../shared/system-types";
import {
  getVllmConfigHelp,
  getVllmRuntimeInfo,
  installVllmRuntime,
} from "../runtimes/vllm-runtime";
import { normalizePackageSpec, probeVllmBinaryRuntime } from "../runtimes/runtime-target-probes";
import { resolveVllmPythonPath } from "../runtimes/vllm-python-path";
import {
  CONTAINER_VLLM_BIN,
  appendVllmExtraArguments,
  getDockerImage,
  getExtraArgument,
  getVllmPythonPath,
  wrapVllmInDocker,
} from "../process/backend-builder";
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
import type {
  BinaryProbeResult,
  ConfigHelpResult,
  EngineSpec,
} from "../engine-spec";

const buildVllmCommand = (recipe: Recipe, config: Config): string[] => {
  const dockerImage = getDockerImage(recipe);
  const pythonPath = getVllmPythonPath(recipe, config.data_dir);
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
