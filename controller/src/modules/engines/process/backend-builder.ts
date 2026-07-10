import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Recipe } from "../../models/types";
import type { Config } from "../../../config/env";
import {
  getUnknownVllmExtraArgKeys as getUnknownVllmExtraArgumentKeys,
  isInternalRecipeKey,
  isJsonStringArgumentKey,
  looksLikeNotesKey,
} from "@local-studio/contracts/engine-args";
import type { Logger } from "../../../core/logger";
import { resolveBinary } from "../../../core/command";
import { managedLlamaServerPath } from "../runtimes/managed-llamacpp";
import { getEngineSpec } from "../engine-spec";
import { getGpuInfo } from "../../system/platform/gpu";
import { resolveRecipeGpuUuids } from "../../system/gpu-leases";
import type { GpuInfo } from "../../models/types";

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
export const appendExtraArguments = (
  command: string[],
  extraArguments: Record<string, unknown>,
): string[] => {
  for (const [key, value] of Object.entries(extraArguments)) {
    const normalizedKey = key.replace(/-/g, "_").toLowerCase();
    if (isInternalRecipeKey(key)) {
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
    if (typeof value === "string" && isJsonStringArgumentKey(key)) {
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

export const buildDockerGpuFlags = (recipe: Recipe, gpus: readonly GpuInfo[]): string[] => {
  const resolution = resolveRecipeGpuUuids(recipe, gpus);
  const resolved = resolution.unresolvedTokens.length === 0 ? resolution.uuids.join(",") : "";
  const selector = resolved || resolution.selector?.trim() || "";
  return selector
    ? ["--gpus", `device=${selector}`, "-e", `CUDA_VISIBLE_DEVICES=${selector}`]
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
    ...buildDockerGpuFlags(recipe, getGpuInfo()),
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
  const managed = managedLlamaServerPath(config);
  return resolveBinary("llama-server") ?? (existsSync(managed) ? managed : "llama-server");
};
export const appendLlamacppArguments = (
  command: string[],
  extraArguments: Record<string, unknown>,
): string[] => {
  for (const [key, value] of Object.entries(extraArguments)) {
    if (isInternalRecipeKey(key)) {
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
