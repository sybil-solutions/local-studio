import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsync } from "../../../core/command";
import { LLAMACPP_HELP_TIMEOUT_MS } from "../configs";
import type { ProcessInfo, Recipe } from "../../models/types";
import type {
  RuntimeBackendInfo,
  RuntimeUpgradeResult,
} from "@local-studio/contracts/system";
import { getLlamacppRuntimeInfo } from "../runtimes/runtime-info";
import {
  appendSerializedArguments,
  getExtraArgument,
  type ExtraArgumentSerializer,
} from "../process/backend-builder";
import { stripForeignFlagKeys } from "@local-studio/contracts/engine-args";
import { extractFlag } from "../argument-utilities";
import type { ConfigHelpResult, EngineSpec, InstallOptions } from "../engine-spec";
import {
  getUpgradeCommandFromEnvironment,
  LLAMACPP_UPGRADE_ENV,
  runEnvironmentUpgradeCommand,
} from "../runtimes/upgrade-config";
import { installManagedLlamacpp, managedLlamaServerPath } from "../runtimes/managed-llamacpp";

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
  const managed = managedLlamaServerPath(config);
  return resolveBinary("llama-server") ?? (existsSync(managed) ? managed : "llama-server");
};

const serializeLlamacppArgument: ExtraArgumentSerializer = (flag, _key, value) => {
  if (value === true) return [flag];
  if (value === false || value === undefined || value === null || value === "") return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      entry === undefined || entry === null || entry === "" ? [] : [flag, String(entry)],
    );
  }
  if (typeof value === "object") return [flag, JSON.stringify(value)];
  return [flag, String(value)];
};

export const appendLlamacppArguments = (
  command: string[],
  extraArguments: Record<string, unknown>,
): string[] => appendSerializedArguments(command, extraArguments, serializeLlamacppArgument);

export const buildLlamacppRecipeArguments = (recipe: Recipe): string[] => {
  const command: string[] = [];
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

const buildLlamacppCommand = (recipe: Recipe, config: Config): string[] => [
  resolveLlamaBinary(recipe, config),
  ...buildLlamacppRecipeArguments(recipe),
];

const managedPackageSpec = (_version?: string | null): string => {
  // llama.cpp is built from source or installed as a binary; no pip package.
  return "configured llama.cpp upgrade command";
};

const detectInvocation = (args: string[]): boolean => {
  const joined = args.join(" ");
  if (
    joined.includes("llama-server") ||
    joined.includes("llama.cpp") ||
    (args[0]?.includes("llama") && joined.includes("-m "))
  ) {
    return true;
  }
  return false;
};

const extractModelPath = (args: string[]): string | null => {
  return extractFlag(args, "-m") ?? extractFlag(args, "--model") ?? null;
};

const extractServedModelName = (args: string[]): string | null => {
  return extractFlag(args, "--alias") ?? extractFlag(args, "-a") ?? null;
};

const getRuntimeInfoAsync = async (
  config: Config,
  _runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Promise<RuntimeBackendInfo> => {
  return getLlamacppRuntimeInfo(config);
};

const getConfigHelp = async (config: Config): Promise<ConfigHelpResult> => {
  const configured = config.llama_bin || "llama-server";
  const resolved =
    resolveBinary(configured) ?? (existsSync(configured) ? resolve(configured) : null);
  const binary = resolved ?? configured;
  const result = await runCommandAsync(binary, ["--help"], {
    timeoutMs: LLAMACPP_HELP_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    return {
      config: result.stdout || null,
      error: result.stderr || "Failed to fetch llama.cpp config",
    };
  }
  return { config: result.stdout || null, error: null };
};

const installLlamacpp = async (options: InstallOptions): Promise<RuntimeUpgradeResult> => {
  const command = getUpgradeCommandFromEnvironment(LLAMACPP_UPGRADE_ENV);
  if (command) {
    return runEnvironmentUpgradeCommand(command, options.onSpawn);
  }
  return installManagedLlamacpp(options);
};

export const llamacppSpec: EngineSpec = {
  id: "llamacpp",
  healthPath: "/health",
  cliBinary: "llama-server",
  buildCommand: buildLlamacppCommand,
  managedPackageSpec,
  install: installLlamacpp,
  detectInvocation,
  extractModelPath,
  extractServedModelName,
  getRuntimeInfo: getRuntimeInfoAsync,
  getConfigHelp,
};
