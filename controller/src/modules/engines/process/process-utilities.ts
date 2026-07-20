import { dirname } from "node:path";
import type { Recipe } from "../../models/types";
import type { Backend } from "@local-studio/contracts/recipes";
import { detectEngineFromArguments } from "../engine-spec";
import {
  extractFlag as extractFlagUtility,
  getExtraArgument,
} from "../argument-utilities";
import { isManagedPythonBackend, managedVenvPython } from "../runtimes/managed-venv";
import { listProcessInventory } from "./process-inventory";
import type { Config } from "../../../config/env";
import type { ProcessRunner } from "../../../core/command";

export { extractFlagUtility as extractFlag };

export const detectBackend = (args: string[]): Backend | null => {
  if (args.length === 0) return null;
  return detectEngineFromArguments(args);
};

export const listProcesses = (runner?: ProcessRunner): Array<{ pid: number; args: string[] }> =>
  listProcessInventory(runner)
    .filter((entry) => entry.args.length > 0)
    .map(({ pid, args }) => ({ pid, args }));

export const buildEnvironment = (
  recipe: Recipe,
  config?: Pick<Config, "data_dir">,
): Record<string, string> => {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  env["FLASHINFER_DISABLE_VERSION_CHECK"] = "1";

  const venvBin = resolveVenvBinForRecipe(recipe, config?.data_dir);
  if (venvBin) {
    env["PATH"] = `${venvBin}:${env["PATH"] ?? ""}`;
  }

  const environmentVariables: Record<string, string> = {};
  if (recipe.env_vars && typeof recipe.env_vars === "object") {
    for (const [key, value] of Object.entries(recipe.env_vars)) {
      if (value !== undefined && value !== null) {
        environmentVariables[String(key)] = String(value);
      }
    }
  }

  const extraEnvironment =
    getExtraArgument(recipe.extra_args, "env_vars") ?? recipe.extra_args["envVars"];
  if (extraEnvironment && typeof extraEnvironment === "object") {
    for (const [key, value] of Object.entries(extraEnvironment as Record<string, unknown>)) {
      if (value !== undefined && value !== null) {
        environmentVariables[String(key)] = String(value);
      }
    }
  }

  for (const [key, value] of Object.entries(environmentVariables)) {
    env[key] = value;
  }

  const isDefined = (value: unknown): boolean => {
    return value !== undefined && value !== null && value !== false;
  };

  const visibleDevices =
    getExtraArgument(recipe.extra_args, "visible_devices") ??
    getExtraArgument(recipe.extra_args, "VISIBLE_DEVICES") ??
    getExtraArgument(recipe.extra_args, "CUDA_VISIBLE_DEVICES") ??
    getExtraArgument(recipe.extra_args, "cuda_visible_devices") ??
    getExtraArgument(recipe.extra_args, "cuda-visible-devices");
  const hipVisibleDevices =
    getExtraArgument(recipe.extra_args, "hip_visible_devices") ??
    getExtraArgument(recipe.extra_args, "HIP_VISIBLE_DEVICES");
  const rocrVisibleDevices =
    getExtraArgument(recipe.extra_args, "rocr_visible_devices") ??
    getExtraArgument(recipe.extra_args, "ROCR_VISIBLE_DEVICES");

  const forcedTool = (process.env["LOCAL_STUDIO_GPU_SMI_TOOL"] ?? "").trim().toLowerCase();
  const platform =
    forcedTool === "nvidia-smi"
      ? "cuda"
      : forcedTool === "amd-smi" || forcedTool === "rocm-smi"
        ? "rocm"
        : "unknown";

  if (isDefined(visibleDevices)) {
    const value = String(visibleDevices);
    if (platform === "cuda") {
      env["CUDA_VISIBLE_DEVICES"] = value;
    } else if (platform === "rocm") {
      env["HIP_VISIBLE_DEVICES"] = value;
      env["ROCR_VISIBLE_DEVICES"] = value;
    } else {
      env["CUDA_VISIBLE_DEVICES"] = value;
      env["HIP_VISIBLE_DEVICES"] = value;
      env["ROCR_VISIBLE_DEVICES"] = value;
    }
  }

  if (isDefined(hipVisibleDevices)) {
    env["HIP_VISIBLE_DEVICES"] = String(hipVisibleDevices);
  }
  if (isDefined(rocrVisibleDevices)) {
    env["ROCR_VISIBLE_DEVICES"] = String(rocrVisibleDevices);
  }

  return env;
};

function resolveVenvBinForRecipe(recipe: Recipe, dataDirectory?: string): string | null {
  if (
    recipe.runtime.kind === "managed_venv" &&
    dataDirectory &&
    isManagedPythonBackend(recipe.backend)
  ) {
    return dirname(managedVenvPython({ data_dir: dataDirectory }, recipe.backend));
  }
  if (
    (recipe.runtime.kind === "system" || recipe.runtime.kind === "binary") &&
    recipe.runtime.ref.includes("/")
  ) {
    return dirname(recipe.runtime.ref);
  }
  return null;
}

export const pidExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const buildProcessTree = (): Map<number, number[]> => {
  const tree = new Map<number, number[]>();
  for (const { pid, ppid } of listProcessInventory()) {
    const children = tree.get(ppid) ?? [];
    children.push(pid);
    tree.set(ppid, children);
  }
  return tree;
};

export const collectChildren = (
  tree: Map<number, number[]>,
  pid: number,
  accumulator: Set<number>,
): void => {
  const children = tree.get(pid) ?? [];
  for (const child of children) {
    if (!accumulator.has(child)) {
      accumulator.add(child);
      collectChildren(tree, child, accumulator);
    }
  }
};
