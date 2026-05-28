import type { HuggingFaceModel, ModelRecommendation } from "@/lib/types";
import { estimateModelSizeMb, type QuantFormat } from "@/lib/vram-estimator";

export function modelRecencyMs(model: HuggingFaceModel): number {
  const raw = model.lastModified ?? model.createdAt;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

const QUANT_TAG_MATCHERS: Array<{ quant: QuantFormat; tags: string[] }> = [
  { quant: "q4_k_m", tags: ["q4_k_m", "q4-k-m"] },
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

/** Rough weight footprint (GB) from name + quantization tags — for sorting and UI hints only. */
export function estimateRoughWeightsGb(model: HuggingFaceModel): number | null {
  const billions = parseParamsBillions(model.modelId);
  if (billions == null) return null;
  const params = billions * 1e9;
  const quant = quantFromTags(model.tags);
  const mb = estimateModelSizeMb(params, quant);
  return mb / 1024;
}

export function recommendedNeedGb(rec: ModelRecommendation): number | null {
  if (rec.min_vram_gb != null && rec.min_vram_gb > 0) return rec.min_vram_gb;
  if (rec.size_gb != null && rec.size_gb > 0) return rec.size_gb;
  return null;
}

export function resolveGroupNeedGb(
  key: string,
  recByKey: Map<string, ModelRecommendation>,
  lead: HuggingFaceModel,
): number | null {
  const rec = recByKey.get(key);
  if (rec) {
    const fromRec = recommendedNeedGb(rec);
    if (fromRec != null) return fromRec;
  }
  return estimateRoughWeightsGb(lead);
}
