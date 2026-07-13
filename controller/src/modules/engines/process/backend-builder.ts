import { existsSync } from "node:fs";
import { venvPythonPath } from "../runtimes/managed-venv";
import type { Recipe } from "../../models/types";
import type { Config } from "../../../config/env";
import {
  isInternalRecipeKey,
  isJsonStringArgumentKey,
} from "@local-studio/contracts/engine-args";
import { getEngineSpec } from "../engine-spec";
import { resolveRecipeGpuUuids } from "../../system/gpu-leases";
import { getExtraArgument } from "../argument-utilities";

export { getExtraArgument };

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
      ]),
    );
  }
  return value;
};

export type ExtraArgumentSerializer = (flag: string, key: string, value: unknown) => string[];

export const appendSerializedArguments = (
  command: string[],
  extraArguments: Record<string, unknown>,
  serialize: ExtraArgumentSerializer,
): string[] => {
  for (const [key, value] of Object.entries(extraArguments)) {
    if (isInternalRecipeKey(key)) continue;
    const flag = `--${key.replace(/_/g, "-")}`;
    if (command.includes(flag)) continue;
    command.push(...serialize(flag, key, value));
  }
  return command;
};

const serializeExtraArgument: ExtraArgumentSerializer = (flag, key, value) => {
  if (value === true) return [flag];
  if (value === false) {
    return key.replace(/-/g, "_").toLowerCase() === "enable_expert_parallelism" ? [] : [flag];
  }
  if (value === undefined || value === null) return [];
  if (typeof value === "string" && isJsonStringArgumentKey(key)) {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return [flag, JSON.stringify(normalizeJsonArgument(JSON.parse(trimmed) as unknown))];
      } catch {
        return [flag, value];
      }
    }
  }
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return [flag, JSON.stringify(normalizeJsonArgument(value))];
  }
  return [flag, String(value)];
};

export const getPythonPath = (recipe: Recipe): string | undefined => {
  if (recipe.python_path && existsSync(recipe.python_path)) {
    return recipe.python_path;
  }
  const venvPath = getExtraArgument(recipe.extra_args, "venv_path");
  if (typeof venvPath === "string") {
    const pythonBin = venvPythonPath(venvPath);
    if (existsSync(pythonBin)) {
      return pythonBin;
    }
  }
  return undefined;
};
export const appendExtraArguments = (
  command: string[],
  extraArguments: Record<string, unknown>,
): string[] => appendSerializedArguments(command, extraArguments, serializeExtraArgument);

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


/**
 * Env keys that must NOT be forwarded into the container; the image's own baked
 * value (sometimes intentionally empty) is required.
 *
 * NOTE: `NCCL_GRAPH_FILE` is deliberately NOT skipped. The voipmonitor "noxml"
 * NCCL build treats an empty `NCCL_GRAPH_FILE` as a fatal error, so recipes set
 * it to `/dev/null` and that override must reach the container.
 */
const DOCKER_ENV_SKIP_KEYS = new Set([
  "CUDA_VISIBLE_DEVICES",
  "NCCL_GRAPH_DUMP_FILE",
  "VLLM_B12X_MLA_EXTEND_MAX_CHUNKS",
]);

export const sanitizeDockerName = (value: string): string => {
  const cleaned = value.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/^[^a-zA-Z0-9]+/, "");
  return cleaned.length > 0 ? cleaned : "recipe";
};

const buildDockerEnvironmentFlags = (recipe: Recipe): string[] => {
  const flags: string[] = [];
  const seen = new Set<string>();
  const addEnvironment = (source: unknown): void => {
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
  addEnvironment(recipe.env_vars);
  addEnvironment(getExtraArgument(recipe.extra_args, "env_vars"));
  return flags;
};

export const buildDockerGpuFlags = (recipe: Recipe): string[] => {
  const resolution = resolveRecipeGpuUuids(recipe, []);
  const selector = resolution.selector?.trim() || "";
  if (resolution.source === "recipe" && !selector) return [];
  const request = selector.includes(",") ? `"device=${selector}"` : `device=${selector}`;
  return selector
    ? ["--gpus", request, "-e", `CUDA_VISIBLE_DEVICES=${selector}`]
    : ["--gpus", "all"];
};

export interface DockerRunOptions {
  recipe: Recipe;
  image: string;
  /** The command to run inside the container, after the image reference. */
  inner: string[];
  /** Overrides the derived `local-studio-{recipe.id}` container name — needed
   * whenever more than one container can exist for the same recipe (e.g. an
   * environment, which is keyed by its own id, not the recipe's). */
  containerName?: string;
  /** Extra `-e KEY=VALUE` pairs to set unconditionally (e.g. engine cache dirs). */
  extraEnv?: Record<string, string>;
  /** Extra `-v` volume mounts beyond the model path, each as `source:target[:mode]`. */
  extraVolumes?: string[];
}

/**
 * Shared `docker run` invocation shape for every engine's Docker-backed launch
 * path: foreground container (so the process-manager stop path's SIGTERM/
 * `--rm` teardown applies unchanged), host networking so the engine binds the
 * recipe's port directly, and the model path bind-mounted read-only.
 */
export const buildDockerRunArguments = ({
  recipe,
  image,
  inner,
  containerName,
  extraEnv: extraEnvironment = {},
  extraVolumes = [],
}: DockerRunOptions): string[] => {
  const name = containerName ?? `local-studio-${sanitizeDockerName(recipe.id)}`;
  const model = recipe.model_path;
  const flags = [
    "docker",
    "run",
    "--rm",
    "--name",
    name,
    ...buildDockerGpuFlags(recipe),
    "--network",
    "host",
    "--ipc",
    "host",
    "--shm-size",
    "32g",
    "--ulimit",
    "memlock=-1",
    "--ulimit",
    "stack=67108864",
  ];
  flags.push(...buildDockerEnvironmentFlags(recipe));
  for (const [key, value] of Object.entries(extraEnvironment)) {
    flags.push("-e", `${key}=${value}`);
  }
  flags.push("-v", `${model}:${model}:ro`);
  for (const volume of extraVolumes) {
    flags.push("-v", volume);
  }
  flags.push(image);
  flags.push(...inner);
  return flags;
};

export const buildBackendCommand = (
  recipe: Recipe,
  config: Config,
  managedGpuSelection = false,
): string[] => {
  const launchCommand = getLaunchCommandOverride(recipe);
  if (launchCommand) {
    if (managedGpuSelection) {
      throw new Error("Custom launch commands cannot use managed GPU selection");
    }
    return launchCommand;
  }
  return getEngineSpec(recipe.backend).buildCommand(recipe, config);
};
