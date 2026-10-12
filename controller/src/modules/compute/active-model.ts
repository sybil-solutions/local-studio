import { Effect } from "effect";
import type { Config } from "../../config/env";
import {
  isInternalRecipeKey,
  isJsonStringArgumentKey,
} from "@local-studio/contracts/engine-args";
import { getExtraArgument } from "../engines/argument-utilities";
import type { GpuInfo, ProcessInfo, Recipe } from "../models/types";
import { resolveRecipeGpuUuids } from "../system/gpu-visibility";
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
 * The one-active-model surface: "what is serving on the inference port", "what is
 * launching", launch, evict, wait-ready — answered from compute instance records.
 * The active model gets a fixed instance name and serves on the inference port, so
 * the proxy, metrics and speech surfaces are unchanged.
 */

export const LLM_INSTANCE = "llm";

export interface ActiveModel {
  readonly findInferenceProcess: () => Effect.Effect<ProcessInfo | null>;
  readonly getCurrentRecipe: () => Effect.Effect<Recipe | null, unknown>;
  readonly launchingRecipeId: () => string | null;
  readonly launchRecipe: (recipe: Recipe) => Effect.Effect<InstanceRecord, LaunchFailure>;
  readonly evict: () => Effect.Effect<boolean>;
  readonly cancelLaunch: () => Effect.Effect<boolean>;
  readonly waitForHealthy: (timeoutMs: number) => Effect.Effect<boolean>;
}

export interface ActiveModelDependencies {
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

/* ── recipe -> launch input ────────────────────────────────────────────────── */

export const recipeToLaunchInput = (
  recipe: Recipe,
  config: Config,
  devices: readonly DeviceId[],
): ComputeLaunchInput => {
  const override = launchCommandOverride(recipe);
  const toolCallParser = recipe.tool_call_parser ?? getDefaultToolCallParser(recipe) ?? null;
  const reasoningParser = recipe.reasoning_parser ?? getDefaultReasoningParser(recipe) ?? null;
  // A recipe may pin its serving image (a ref with a registry path or tag);
  // a bare engine name or empty ref means the spec's pinned image at plan time.
  const runtimeReference = recipe.runtime.kind === "docker" ? recipe.runtime.ref : "";
  const dockerImage =
    runtimeReference.includes("/") || runtimeReference.includes(":") ? runtimeReference : null;
  return {
    name: LLM_INSTANCE,
    engine: recipe.backend as EngineId,
    recipeId: recipe.id,
    runtime: "docker",
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
    ...(override ? { commandOverride: override } : {}),
  };
};

/* ── the surface ───────────────────────────────────────────────────────────── */

const RUNNING_STATES = new Set(["starting", "ready", "unhealthy"]);

export const createActiveModel = (deps: ActiveModelDependencies): ActiveModel => {
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
      return {
        pid: 0,
        backend: record.engine,
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

  const launchRecipe = (recipe: Recipe): Effect.Effect<InstanceRecord, LaunchFailure> =>
    Effect.gen(function* () {
      const gpus = yield* getGpuInfo().pipe(Effect.catch(() => Effect.succeed([] as GpuInfo[])));
      const resolution = resolveRecipeGpuUuids(recipe, gpus);
      if (resolution.unresolvedTokens.length > 0) {
        return yield* Effect.fail<LaunchFailure>({
          kind: "spawn-failed",
          detail: `GPU selectors could not be resolved: ${resolution.unresolvedTokens.join(", ")}`,
        });
      }
      return yield* deps.compute.launch(
        recipeToLaunchInput(recipe, deps.config, resolution.uuids),
      );
    });

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
    cancelLaunch: () => deps.compute.cancel(LLM_INSTANCE),
    waitForHealthy,
  };
};
