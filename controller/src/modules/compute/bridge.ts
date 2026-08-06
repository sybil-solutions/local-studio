import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import type { Config } from "../../config/env";
import { resolveBinary } from "../../core/command";
import {
  isInternalRecipeKey,
  isJsonStringArgumentKey,
} from "@local-studio/contracts/engine-args";
import { getExtraArgument } from "../engines/argument-utilities";
import { resolveLlamaBinary } from "../engines/specs/llamacpp-spec";
import type { GpuInfo, ProcessInfo, Recipe } from "../models/types";
import { resolveRecipeGpuUuids } from "../system/gpu-leases";
import { getGpuInfo } from "../system/platform/gpu";
import type { DeviceId, EngineId, InstanceRecord, LaunchFailure } from "./contracts";
import {
  getDefaultReasoningParser,
  getDefaultToolCallParser,
  shouldEnableExpertParallel,
} from "./recipe-defaults";
import type { ComputeLaunchInput, ComputeService } from "./lifecycle";
import type { InstanceStore } from "./instances/store";

/**
 * The legacy-surface bridge: everything the old engine coordinator and process manager
 * answered — "what is serving on the inference port", "what is launching", launch,
 * evict, wait-ready — answered from compute instance records instead. One model at a
 * time is preserved by giving the active model a fixed instance name and serving it on
 * the legacy inference port, so the proxy, metrics and speech surfaces are unchanged.
 */

export const LLM_INSTANCE = "llm";

export interface ComputeBridge {
  readonly findInferenceProcess: () => Effect.Effect<ProcessInfo | null>;
  readonly getCurrentRecipe: () => Effect.Effect<Recipe | null, unknown>;
  readonly launchingRecipeId: () => string | null;
  readonly launchRecipe: (recipe: Recipe) => Effect.Effect<InstanceRecord, LaunchFailure>;
  readonly evict: () => Effect.Effect<boolean>;
  readonly cancelLaunch: (recipeId: string, attemptNonce: string) => Effect.Effect<boolean>;
  readonly waitForHealthy: (timeoutMs: number) => Effect.Effect<boolean>;
}

export interface ComputeBridgeDependencies {
  readonly config: Config;
  readonly compute: ComputeService;
  readonly store: InstanceStore;
  readonly getRecipe: (recipeId: string) => Effect.Effect<Recipe | null, unknown>;
}

/* ── recipe extra_args -> argv (semantics preserved from the legacy builder) ── */

const normalizeJsonArgument = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeJsonArgument);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key.replace(/-/g, "_"),
        normalizeJsonArgument(entry),
      ]),
    );
  }
  return value;
};

const serializeExtraArgument = (flag: string, key: string, value: unknown): string[] => {
  if (value === true) return [flag];
  if (value === false) return [];
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

export const serializeRecipeExtraArguments = (recipe: Recipe): string[] => {
  const argv: string[] = [];
  for (const [key, value] of Object.entries(recipe.extra_args ?? {})) {
    if (isInternalRecipeKey(key)) continue;
    argv.push(...serializeExtraArgument(`--${key.replace(/_/g, "-")}`, key, value));
  }
  // MoE models on multiple GPUs default to expert parallelism unless the recipe
  // explicitly opted out — unchanged vLLM behavior.
  if (
    recipe.backend === "vllm" &&
    !argv.includes("--enable-expert-parallel") &&
    shouldEnableExpertParallel(recipe, getExtraArgument(recipe.extra_args, "enable-expert-parallel"))
  ) {
    argv.push("--enable-expert-parallel");
  }
  return argv;
};

/* ── custom launch command (opt-in arbitrary argv, unchanged policy) ───────── */

const splitLaunchCommand = (command: string): string[] => {
  const result: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaping = false;
  for (const character of command) {
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
      if (character === quote) quote = null;
      else current += character;
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
  if (escaping) current += "\\";
  if (current) result.push(current);
  return result;
};

const launchCommandOverride = (recipe: Recipe): string[] | null => {
  const override =
    getExtraArgument(recipe.extra_args, "launch_command") ??
    getExtraArgument(recipe.extra_args, "custom_command");
  if (typeof override !== "string" || !override.trim()) return null;
  // Arbitrary-binary execution as the controller user; honoured only when the
  // operator opted in, exactly as before.
  if (process.env["LOCAL_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND"] !== "true") return null;
  const argv = splitLaunchCommand(override);
  return argv.length > 0 ? argv : null;
};

/* ── binary resolution per backend ─────────────────────────────────────────── */

const siblingBinary = (pythonPath: string | undefined | null, name: string): string | null => {
  if (!pythonPath) return null;
  const candidate = join(dirname(pythonPath), name);
  return existsSync(candidate) ? candidate : null;
};

const resolveEngineBinary = (recipe: Recipe, config: Config): string | null => {
  const recipePython = recipe.python_path && existsSync(recipe.python_path) ? recipe.python_path : null;
  switch (recipe.backend) {
    case "vllm":
      return siblingBinary(recipePython, "vllm") ?? resolveBinary("vllm");
    case "sglang":
      return (
        siblingBinary(recipePython ?? config.sglang_python, "sglang") ?? resolveBinary("sglang")
      );
    case "llamacpp": {
      try {
        return resolveLlamaBinary(recipe, config);
      } catch {
        return null;
      }
    }
    case "mlx":
      return (
        siblingBinary(recipePython ?? config.mlx_python, "mlx_lm.server") ??
        resolveBinary("mlx_lm.server")
      );
    default:
      return null;
  }
};

const resolveRecipeBinary = (recipe: Recipe, config: Config): string | null => {
  if (recipe.runtime.kind === "binary" || recipe.runtime.kind === "system") {
    return recipe.runtime.ref;
  }
  if (recipe.runtime.kind === "docker") return null;
  return resolveEngineBinary(recipe, config);
};

/* ── recipe -> launch input ────────────────────────────────────────────────── */

export const recipeToLaunchInput = (
  recipe: Recipe,
  config: Config,
  devices: readonly DeviceId[],
): ComputeLaunchInput => {
  const override = launchCommandOverride(recipe);
  const toolCallParser = recipe.tool_call_parser ?? getDefaultToolCallParser(recipe) ?? null;
  const reasoningParser = recipe.reasoning_parser ?? getDefaultReasoningParser(recipe) ?? null;
  const dockerImage = recipe.runtime.kind === "docker" ? recipe.runtime.ref : null;
  return {
    name: LLM_INSTANCE,
    engine: recipe.backend as EngineId,
    recipeId: recipe.id,
    runtime: dockerImage ? "docker" : "process",
    deviceCount: devices.length,
    ...(devices.length > 0 ? { devices } : {}),
    portOverride: recipe.port || config.inference_port,
    modelPath: recipe.model_path,
    servedModelName: recipe.served_model_name ?? recipe.model_path,
    options: {
      tensorParallel: recipe.tensor_parallel_size,
      pipelineParallel: recipe.pipeline_parallel_size,
      maxContextLength: recipe.max_model_len,
      memoryFraction: recipe.gpu_memory_utilization,
      maxConcurrentRequests: recipe.max_num_seqs,
      kvCacheDtype: recipe.kv_cache_dtype === "auto" ? null : recipe.kv_cache_dtype,
      dtype: recipe.dtype ?? null,
      quantization: recipe.quantization ?? null,
      trustRemoteCode: recipe.trust_remote_code,
      toolCallParser,
      reasoningParser,
    },
    extraArgs: serializeRecipeExtraArguments(recipe),
    env: recipe.env_vars ?? {},
    dockerImage,
    binary: resolveRecipeBinary(recipe, config),
    ...(override ? { commandOverride: override } : {}),
  };
};

/* ── the bridge ────────────────────────────────────────────────────────────── */

const RUNNING_STATES = new Set(["starting", "ready", "unhealthy"]);

export const createComputeBridge = (deps: ComputeBridgeDependencies): ComputeBridge => {
  const llmRecord = (): InstanceRecord | null => deps.store.read(LLM_INSTANCE);

  const findInferenceProcess = (): Effect.Effect<ProcessInfo | null> =>
    Effect.gen(function* () {
      const record = llmRecord();
      if (!record || record.ref === null) return null;
      const state = yield* deps.compute.stateOf(record);
      if (!RUNNING_STATES.has(state)) return null;
      const recipe = yield* deps
        .getRecipe(record.recipeId)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      const backend = record.engine === "exllamav3" ? "unknown" : record.engine;
      return {
        pid: record.ref.kind === "process" ? record.ref.pid : 0,
        backend,
        model_path: recipe?.model_path ?? null,
        port: record.port,
        served_model_name: recipe?.served_model_name ?? null,
      } satisfies ProcessInfo;
    });

  const getCurrentRecipe = (): Effect.Effect<Recipe | null, unknown> =>
    Effect.gen(function* () {
      const record = llmRecord();
      if (!record) return null;
      return yield* deps.getRecipe(record.recipeId);
    });

  const launchingRecipeId = (): string | null => {
    const record = llmRecord();
    if (!record) return null;
    // A record without a handle is reserving; with a handle it may still be starting,
    // but "launching" for status surfaces means "not yet confirmed running".
    return record.ref === null ? record.recipeId : null;
  };

  const launchRecipe = (recipe: Recipe): Effect.Effect<InstanceRecord, LaunchFailure> => {
    const identity = recipeToLaunchInput(recipe, deps.config, []);
    return deps.compute.launchPrepared(identity, () =>
      Effect.gen(function* () {
        const gpus = yield* getGpuInfo().pipe(Effect.catch(() => Effect.succeed([] as GpuInfo[])));
        const resolution = resolveRecipeGpuUuids(recipe, gpus);
        if (resolution.unresolvedTokens.length > 0) {
          return yield* Effect.fail<LaunchFailure>({
            kind: "spawn-failed",
            detail: `GPU selectors could not be resolved: ${resolution.unresolvedTokens.join(", ")}`,
          });
        }
        return recipeToLaunchInput(recipe, deps.config, resolution.uuids);
      }),
    );
  };

  const cancelLaunch = (recipeId: string, attemptNonce: string): Effect.Effect<boolean> => {
    const record = llmRecord();
    if (!record || record.recipeId !== recipeId) return Effect.succeed(false);
    return deps.compute.cancel(record.name, attemptNonce);
  };

  const waitForHealthy = (timeoutMs: number): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const record = llmRecord();
        if (record && (yield* deps.compute.stateOf(record)) === "ready") return true;
        yield* Effect.sleep(2_000);
      }
      return false;
    });

  return {
    findInferenceProcess,
    getCurrentRecipe,
    launchingRecipeId,
    launchRecipe,
    evict: () => deps.compute.stop(LLM_INSTANCE),
    cancelLaunch,
    waitForHealthy,
  };
};
