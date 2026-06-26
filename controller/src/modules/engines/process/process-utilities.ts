import { spawnSync } from "node:child_process";
import type { Recipe } from "../../models/types";
import type { Backend } from "../../shared/recipe-types";
import { detectEngineFromArguments } from "../engine-spec";
import { extractFlag as extractFlagUtility } from "../argument-utilities";

export { extractFlagUtility as extractFlag };

const splitCommand = (command: string): string[] => {
  const matches = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ""));
};

export const detectBackend = (args: string[]): Backend | null => {
  if (args.length === 0) return null;
  return detectEngineFromArguments(args);
};

export const listProcesses = (): Array<{ pid: number; args: string[] }> => {
  try {
    const result = spawnSync("ps", ["-eo", "pid=,args="]);
    if (result.status !== 0) {
      return [];
    }
    const output = result.stdout.toString("utf-8").trim();
    if (!output) {
      return [];
    }
    return output
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        const match = trimmed.match(/^(\d+)\s+(.*)$/);
        if (!match) {
          return { pid: 0, args: [] };
        }
        const pid = Number(match[1]);
        const args = splitCommand(match[2] ?? "");
        return { pid, args };
      })
      .filter((entry) => entry.pid > 0 && entry.args.length > 0);
  } catch {
    return [];
  }
};

export const buildEnvironment = (recipe: Recipe): Record<string, string> => {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  env["FLASHINFER_DISABLE_VERSION_CHECK"] = "1";

  const environmentVariables: Record<string, string> = {};
  if (recipe.env_vars && typeof recipe.env_vars === "object") {
    for (const [key, value] of Object.entries(recipe.env_vars)) {
      if (value !== undefined && value !== null) {
        environmentVariables[String(key)] = String(value);
      }
    }
  }

  const extraEnvironment =
    recipe.extra_args["env_vars"] || recipe.extra_args["env-vars"] || recipe.extra_args["envVars"];
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

  const readExtraArgument = (key: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(recipe.extra_args, key)) {
      return recipe.extra_args[key];
    }
    const kebab = key.replace(/_/g, "-");
    if (Object.prototype.hasOwnProperty.call(recipe.extra_args, kebab)) {
      return recipe.extra_args[kebab];
    }
    const snake = key.replace(/-/g, "_");
    if (Object.prototype.hasOwnProperty.call(recipe.extra_args, snake)) {
      return recipe.extra_args[snake];
    }
    return undefined;
  };

  const isDefined = (value: unknown): boolean => {
    return value !== undefined && value !== null && value !== false;
  };

  const visibleDevices =
    readExtraArgument("visible_devices") ??
    readExtraArgument("VISIBLE_DEVICES") ??
    readExtraArgument("CUDA_VISIBLE_DEVICES") ??
    readExtraArgument("cuda_visible_devices") ??
    readExtraArgument("cuda-visible-devices");
  const hipVisibleDevices =
    readExtraArgument("hip_visible_devices") ?? readExtraArgument("HIP_VISIBLE_DEVICES");
  const rocrVisibleDevices =
    readExtraArgument("rocr_visible_devices") ?? readExtraArgument("ROCR_VISIBLE_DEVICES");

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

export const pidExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const buildProcessTree = (): Map<number, number[]> => {
  const result = spawnSync("ps", ["-eo", "pid=,ppid="]);
  if (result.status !== 0) {
    return new Map();
  }
  const output = result.stdout.toString("utf-8").trim();
  const tree = new Map<number, number[]>();
  if (!output) {
    return tree;
  }
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d+)\s+(\d+)$/);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const parent = Number(match[2]);
    const children = tree.get(parent) ?? [];
    children.push(pid);
    tree.set(parent, children);
  }
  return tree;
};

export const collectChildren = (
  tree: Map<number, number[]>,
  pid: number,
  accumulator: Set<number>
): void => {
  const children = tree.get(pid) ?? [];
  for (const child of children) {
    if (!accumulator.has(child)) {
      accumulator.add(child);
      collectChildren(tree, child, accumulator);
    }
  }
};
