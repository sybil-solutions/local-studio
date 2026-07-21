import type { HuggingFaceModel } from "@/lib/types";
import type { ModelIndexModel } from "@/lib/api/studio";
import { estimateModelSizeMb, type QuantFormat } from "@/features/recipes/vram-estimator";

const QUANT_TAG_MATCHERS: Array<{ quant: QuantFormat; tags: string[] }> = [
  { quant: "q6_k", tags: ["q6", "oq6", "6-bit"] },
  { quant: "q4_k_m", tags: ["q4_k_m", "q4-k-m"] },
  { quant: "q4_k_m", tags: ["oq4", "4-bit"] },
  { quant: "q5_k_m", tags: ["q5_k_m"] },
  { quant: "q8_0", tags: ["q8_0", "q8-0"] },
  { quant: "q4_0", tags: ["q4_0", "q4-0"] },
  { quant: "q3_k_m", tags: ["q3_k_m"] },
  { quant: "q2_k", tags: ["q2_k", "q2-k"] },
  { quant: "iq3_m", tags: ["iq3_m"] },
  { quant: "iq2", tags: ["iq2"] },
  { quant: "fp8", tags: ["fp8"] },
  { quant: "int8", tags: ["int8"] },
  { quant: "int4", tags: ["int4", "awq", "gptq", "w4a16"] },
  { quant: "q4_k_m", tags: ["gguf"] },
  { quant: "bf16", tags: ["bf16"] },
];

function joinedQuantTags(tags: string[]): string {
  return tags.map((tag) => tag.toLowerCase()).join("|");
}

export function quantFromTags(tags: string[]): QuantFormat {
  const joined = joinedQuantTags(tags);
  return (
    QUANT_TAG_MATCHERS.find((matcher) => matcher.tags.some((tag) => joined.includes(tag)))?.quant ??
    "bf16"
  );
}

/**
 * Parse advertised parameter size (billions) from common HF repo naming patterns.
 */
export function parseParamsBillions(modelId: string): number | null {
  const s = modelId.replace(/[–—]/g, "-").toLowerCase();
  const matches = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(b|m)\b/gi)];
  let best: number | null = null;
  for (const m of matches) {
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) continue;
    const u = m[2].toLowerCase();
    const billions = u === "m" ? n / 1000 : n;
    if (billions >= 0.05 && billions <= 500) {
      if (best == null || billions > best) best = billions;
    }
  }
  if (best != null) return best;
  if (/\bgpt2\b/.test(s)) return 0.137;
  return null;
}

/** Rough runtime VRAM footprint (GB) from name + quantization tags — for sorting, UI hints, and fit tests.
 *
 * This is NOT just static weight bytes: a 1.25x overhead is applied so the
 * displayed footprint and the fit comparison reflect actual run VRAM
 * (weights + KV cache + activations + framework/CUDA context). Without this
 * factor, models whose weights exactly fill the pool were reported as "fits"
 * but OOM at runtime because there is no headroom for KV cache.
 *
 * Note on MoE: `parseParamsBillions` reads total params from the repo name, so
 * MoE models (e.g. DeepSeek-R1 671B) are overestimated on this path. Known
 * limitation; curated models from the controller's model index bypass this
 * estimate and use the catalog's published variant sizes instead.
 */
export function estimateRoughWeightsGb(model: HuggingFaceModel): number | null {
  // HF's list endpoint returns siblings (file names) but NOT file sizes, so we
  // can't compute real VRAM from the API — the name+tag heuristic remains the
  // best available signal for a 50-model page. If weightBytes is enriched by a
  // future data source, use it (exact > estimate).
  let weightsGb: number | null = null;
  if (typeof model.weightBytes === "number" && model.weightBytes > 0) {
    weightsGb = model.weightBytes / 1e9;
  } else {
    const billions = parseParamsBillions(model.modelId);
    if (billions == null) return null;
    const params = billions * 1e9;
    const quant = quantFromTags(model.tags);
    const mb = estimateModelSizeMb(params, quant);
    weightsGb = mb / 1024;
  }
  // Runtime overhead: KV cache, activations, framework/CUDA context.
  return weightsGb * 1.25;
}

/**
 * VRAM estimate for a curated catalog (model-index) entry.
 *
 * Choice: prefer the bf16 variant's published `size_gb` — bf16 repo ids are
 * the canonical HF ids Explore groups resolve to, so the group's needGb
 * should reflect the full-precision weights a user gets by default. When no
 * bf16 size is published, fall back to the smallest published variant size so
 * quant-only entries still count as "fits" against the pool instead of
 * dropping to the rough name-based estimate.
 */
export function catalogNeedGb(model: ModelIndexModel): number | null {
  const bf16 = model.variants.find(
    (variant) => variant.format === "bf16" && variant.size_gb != null && variant.size_gb > 0,
  );
  if (bf16?.size_gb != null) return bf16.size_gb;
  const sizes = model.variants
    .map((variant) => variant.size_gb)
    .filter((size): size is number => size != null && size > 0);
  return sizes.length > 0 ? Math.min(...sizes) : null;
}

export function resolveGroupNeedGb(
  key: string,
  catalogByKey: Map<string, ModelIndexModel>,
  lead: HuggingFaceModel,
): number | null {
  const catalogModel = catalogByKey.get(key);
  if (catalogModel) {
    const fromCatalog = catalogNeedGb(catalogModel);
    if (fromCatalog != null) return fromCatalog;
  }
  return estimateRoughWeightsGb(lead);
}
