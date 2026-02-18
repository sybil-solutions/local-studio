// CRITICAL
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Recipe } from "./types";
import { fetchLocal } from "../../http/local-fetch";

/**
 * Split a command line string into arguments.
 * @param command - Raw command line.
 * @returns Parsed arguments.
 */
const splitCommand = (command: string): string[] => {
  const matches = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((token) => token.replace(/^"|"$/g, ""));
};

/**
 * Extract a flag value from arguments.
 * @param args - CLI args.
 * @param flag - Flag to lookup.
 * @returns Flag value if present.
 */
export const extractFlag = (args: string[], flag: string): string | undefined => {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && index + 1 < args.length) {
      return args[index + 1];
    }
  }
  return undefined;
};

/**
 * Detect inference backend from command line.
 * @param args - Process args.
 * @returns Backend string or null.
 */
export const detectBackend = (args: string[]): string | null => {
  if (args.length === 0) {
    return null;
  }
  const joined = args.join(" ");
  if (joined.includes("vllm.entrypoints.openai.api_server")) {
    return "vllm";
  }
  if (joined.includes("vllm") && joined.includes("serve")) {
    return "vllm";
  }
  if (joined.includes("sglang.launch_server")) {
    return "sglang";
  }
  if (joined.includes("tabbyAPI") || (joined.includes("main.py") && joined.includes("--config"))) {
    return "tabbyapi";
  }
  if (
    joined.includes("llama-server") ||
    joined.includes("llama.cpp") ||
    (args[0]?.includes("llama") && joined.includes("-m "))
  ) {
    return "llamacpp";
  }
  return null;
};

/**
 * List running processes via ps.
 * @returns Array of pid and args.
 */
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

/**
 * Read TabbyAPI api_tokens.yml for API key.
 * @param tabbyDirectory - TabbyAPI directory.
 * @returns API key if found.
 */
const readTabbyApiKey = (tabbyDirectory: string): string | undefined => {
  const path = resolve(tabbyDirectory, "api_tokens.yml");
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const content = readFileSync(path, "utf-8");
    const parsed = parseYaml(content) as Record<string, unknown>;
    const apiKey = parsed["api_key"];
    if (typeof apiKey === "string") {
      return apiKey;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Resolve TabbyAPI model information.
 * @param port - API port.
 * @param tabbyDirectory - TabbyAPI directory.
 * @param modelsDirectory - Models directory.
 * @returns Model info if available.
 */
export const fetchTabbyModel = async (
  port: number,
  tabbyDirectory: string,
  modelsDirectory: string
): Promise<{ servedModelName?: string; modelPath?: string }> => {
  const apiKey = readTabbyApiKey(tabbyDirectory);
  const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  try {
    const response = await fetchLocal(port, "/v1/models", { headers, timeoutMs: 2000 });
    if (response.ok) {
      const data = (await response.json()) as { data?: Array<{ id?: string }> };
      const modelId = data.data?.[0]?.id;
      if (modelId) {
        return { servedModelName: modelId, modelPath: resolve(modelsDirectory, modelId) };
      }
    }
  } catch {
    return {};
  }
  return {};
};

/**
 * Build environment variables for a recipe.
 * @param recipe - Recipe data.
 * @returns Environment map.
 */
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
  const hipVisibleDevices = readExtraArgument("hip_visible_devices") ?? readExtraArgument("HIP_VISIBLE_DEVICES");
  const rocrVisibleDevices =
    readExtraArgument("rocr_visible_devices") ?? readExtraArgument("ROCR_VISIBLE_DEVICES");

  const forcedTool = (process.env["VLLM_STUDIO_GPU_SMI_TOOL"] ?? "").trim().toLowerCase();
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

/**
 * Determine if a process is still alive.
 * @param pid - Process id.
 * @returns True if process exists.
 */
export const pidExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Build a process tree map.
 * @returns Map of parent pid to children.
 */
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

/**
 * Collect child processes recursively.
 * @param tree - Process tree map.
 * @param pid - Parent pid.
 * @param accumulator - Accumulator set.
 */
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
