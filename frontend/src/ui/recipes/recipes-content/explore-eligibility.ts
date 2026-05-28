import type { GPU, HuggingFaceModel, ModelRecommendation } from "@/lib/types";
import { toGB, toGBFromMB } from "@/lib/formatters";

/** Sum total VRAM across connected GPUs (one card = one capacity; eight cards = eight capacities). */
export function sumGpuMemoryPoolGb(gpus: GPU[]): number {
  let sum = 0;
  for (const g of gpus) {
    const fromMb = g.memory_total_mb;
    if (fromMb != null && Number.isFinite(fromMb) && fromMb > 0) {
      sum += toGBFromMB(fromMb);
      continue;
    }
    sum += toGB(g.memory_total);
  }
  const rounded = Math.round(sum * 10) / 10;
  return Number.isFinite(rounded) ? rounded : 0;
}

const DEFAULT_RECENT_MS = 120 * 24 * 60 * 60 * 1000;

/** Prefer repo `createdAt`; fall back to `lastModified` for “recent on Hugging Face”. */
export function modelCreatedMs(model: HuggingFaceModel): number {
  const raw = model.createdAt;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Repo creation on Hugging Face (requires `createdAt` from the API). */
export function isRecentlyCreatedOnHf(
  model: HuggingFaceModel,
  maxAgeMs = DEFAULT_RECENT_MS,
): boolean {
  const t = modelCreatedMs(model);
  if (t <= 0) return false;
  return Date.now() - t <= maxAgeMs;
}

export function hasHfEngagementStats(model: HuggingFaceModel): boolean {
  return model.downloads > 0 || model.likes > 0;
}

/** Recommendations that can plausibly run on this pool (excludes explicit min VRAM above pool). */
export function filterRecommendationsWithinPool(
  recs: ModelRecommendation[],
  poolGb: number,
): ModelRecommendation[] {
  if (poolGb <= 0) return recs;
  return recs.filter((rec) => rec.min_vram_gb == null || rec.min_vram_gb <= poolGb);
}

export type ExploreVramTierItem = { needGb: number | null };

/** Mix table order: round-robin large / mid / small footprint vs pool so the list is not all tiny models. */
export function interleaveExploreGroupsByVramTier<T extends ExploreVramTierItem>(
  groups: T[],
  poolGb: number,
): T[] {
  if (poolGb <= 0 || groups.length === 0) return groups;
  const lo: T[] = [];
  const md: T[] = [];
  const hi: T[] = [];
  const unk: T[] = [];
  for (const g of groups) {
    const n = g.needGb;
    if (n == null || !Number.isFinite(n)) {
      unk.push(g);
      continue;
    }
    if (n < 0.25 * poolGb) lo.push(g);
    else if (n <= 0.8 * poolGb) md.push(g);
    else hi.push(g);
  }
  const out: T[] = [];
  let i = 0;
  while (lo.length || md.length || hi.length) {
    const tier = i % 3;
    const pick =
      tier === 0 && hi.length
        ? hi.shift()
        : tier === 1 && md.length
          ? md.shift()
          : tier === 2 && lo.length
            ? lo.shift()
            : (hi.shift() ?? md.shift() ?? lo.shift());
    if (pick) out.push(pick);
    i += 1;
  }
  out.push(...unk);
  return out;
}
