import { getExtraArgument } from "../engines/argument-utilities";
import type { GpuInfo, Recipe } from "../models/types";

/**
 * Resolves which physical GPUs a recipe asks for, from whichever of the several
 * visibility selectors it happens to carry.
 *
 * This file also used to hold a GPU *lease* registry with an "llm" and a
 * "speech" owner. The speech worker was its only real client — the llm owner
 * validated against the instance record it already had — so the registry went
 * with the speech service.
 */
export interface GpuVisibilityResolution {
  readonly source: "all" | "recipe";
  readonly selector: string | null;
  readonly uuids: readonly string[];
  readonly unresolvedTokens: readonly string[];
}

const fullNvidiaUuid =
  /^GPU-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const directVisibilityKeys = [
  "visible_devices",
  "VISIBLE_DEVICES",
  "CUDA_VISIBLE_DEVICES",
  "cuda_visible_devices",
  "cuda-visible-devices",
] as const;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function directVisibilitySelector(recipe: Recipe): string | null {
  for (const key of directVisibilityKeys) {
    const value = getExtraArgument(recipe.extra_args, key);
    if (value === undefined || value === null) continue;
    return value === false ? null : String(value);
  }
  return null;
}

function environmentVisibilitySelector(recipe: Recipe): string | null {
  let selector = recipe.env_vars?.["CUDA_VISIBLE_DEVICES"] ?? null;
  const extraEnvironment =
    getExtraArgument(recipe.extra_args, "env_vars") ?? recipe.extra_args["envVars"];
  if (!isUnknownRecord(extraEnvironment)) return selector;
  const value = extraEnvironment["CUDA_VISIBLE_DEVICES"];
  if (value !== undefined && value !== null) selector = String(value);
  return selector;
}

function canonicalNvidiaUuid(uuid: string): string {
  return `GPU-${uuid.slice(4).toLowerCase()}`;
}

function leaseableUuid(gpu: GpuInfo): string | null {
  const uuid = gpu.uuid?.trim();
  return uuid && fullNvidiaUuid.test(uuid) ? canonicalNvidiaUuid(uuid) : null;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

export function resolveRecipeGpuUuids(
  recipe: Recipe,
  gpus: readonly GpuInfo[],
): GpuVisibilityResolution {
  const byIndex = new Map<number, string>();
  const byUuid = new Map<string, string>();
  const allUuids: string[] = [];
  for (const gpu of gpus) {
    const uuid = leaseableUuid(gpu);
    if (!uuid) continue;
    if (!byIndex.has(gpu.index)) byIndex.set(gpu.index, uuid);
    byUuid.set(uuid.toLowerCase(), uuid);
    appendUnique(allUuids, uuid);
  }

  const selector = directVisibilitySelector(recipe) ?? environmentVisibilitySelector(recipe);
  if (selector === null) {
    const required = Math.max(1, recipe.tensor_parallel_size * recipe.pipeline_parallel_size);
    return { source: "all", selector, uuids: allUuids.slice(0, required), unresolvedTokens: [] };
  }

  const uuids: string[] = [];
  const unresolvedTokens: string[] = [];
  const tokens = selector
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const uuid = /^\d+$/.test(token) ? byIndex.get(Number(token)) : byUuid.get(token.toLowerCase());
    if (uuid) appendUnique(uuids, uuid);
    else appendUnique(unresolvedTokens, token);
  }
  return { source: "recipe", selector, uuids, unresolvedTokens };
}
