import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { Config } from "../../../config/env";
import { runCommandAsync } from "../../../core/command";
import type { ProcessInfo, Recipe } from "../../models/types";
import type { RuntimeBackendInfo, RuntimeUpgradeResult } from "../../shared/system-types";
import { appendExtraArguments, getPythonPath } from "../process/backend-builder";
import { stripForeignFlagKeys } from "../../../../../shared/contracts/engine-args";
import { extractFlag } from "../argument-utilities";
import type { EngineSpec, InstallOptions } from "../engine-spec";
import {
  EXLLAMAV3_UPGRADE_ENV,
  getUpgradeCommandFromEnvironment,
  runEnvironmentUpgradeCommand,
} from "../runtimes/upgrade-config";

const tabbyMainPath = (config: Config): string | null =>
  config.tabby_api_dir ? join(config.tabby_api_dir, "main.py") : null;

const buildExllamav3Command = (recipe: Recipe, config: Config): string[] => {
  const mainPath = tabbyMainPath(config);
  if (!mainPath) {
    throw new Error("TabbyAPI directory is not configured. Set LOCAL_STUDIO_TABBY_API_DIR.");
  }
  const python =
    getPythonPath(recipe) || tabbyVenvPython(config) || resolvePythonPath() || "python3";
  const command = [python, mainPath];
  command.push("--host", recipe.host, "--port", String(recipe.port));
  command.push("--model-name", basename(recipe.model_path));
  return appendExtraArguments(command, stripForeignFlagKeys("exllamav3", recipe.extra_args));
};

const managedPackageSpec = (_version?: string | null): string => {
  return "configured TabbyAPI upgrade command";
};

const detectInvocation = (args: string[]): boolean => {
  const joined = args.join(" ").toLowerCase();
  return joined.includes("main.py") && (joined.includes("tabby") || joined.includes("--model-name"));
};

const extractModelPath = (args: string[]): string | null => {
  return extractFlag(args, "--model-name") ?? null;
};

const extractServedModelName = (args: string[]): string | null => {
  return extractFlag(args, "--model-name") ?? null;
};

const resolvePythonPath = (): string | null => {
  const explicit = process.env["LOCAL_STUDIO_EXLLAMAV3_PYTHON"]?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const managed = join(process.cwd(), "runtime", "venvs", "exllamav3-latest", "bin", "python");
  return existsSync(managed) ? managed : null;
};

const tabbyVenvPython = (config: Config): string | null => {
  if (!config.tabby_api_dir) return null;
  const candidate = join(config.tabby_api_dir, "venv", "bin", "python");
  return existsSync(candidate) ? candidate : null;
};

const getRuntimeInfoAsync = async (
  config: Config,
  _runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Promise<RuntimeBackendInfo> => {
  const mainPath = tabbyMainPath(config);
  const installed = Boolean(mainPath && existsSync(mainPath));
  const python = tabbyVenvPython(config) ?? resolvePythonPath();
  let version: string | null = null;
  if (installed && python) {
    const result = await runCommandAsync(python, ["--version"], { timeoutMs: 2_000 });
    if (result.status === 0) version = result.stdout.trim() || null;
  }
  return {
    installed,
    version,
    python_path: python,
    upgrade_command_available: Boolean(getUpgradeCommandFromEnvironment(EXLLAMAV3_UPGRADE_ENV)),
  };
};

const installExllamav3 = async (options: InstallOptions): Promise<RuntimeUpgradeResult> => {
  const command = getUpgradeCommandFromEnvironment(EXLLAMAV3_UPGRADE_ENV);
  if (!command) {
    return {
      success: false,
      version: null,
      output: null,
      error: `No TabbyAPI upgrade command configured. Set ${EXLLAMAV3_UPGRADE_ENV}.`,
      used_command: null,
    };
  }
  return runEnvironmentUpgradeCommand(command, options.onSpawn);
};

export const exllamav3Spec: EngineSpec = {
  id: "exllamav3",
  healthPath: "/health",
  cliBinary: null,
  buildCommand: buildExllamav3Command,
  managedPackageSpec,
  install: installExllamav3,
  detectInvocation,
  extractModelPath,
  extractServedModelName,
  resolvePythonPath,
  getRuntimeInfo: getRuntimeInfoAsync,
};
