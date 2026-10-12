import type { ModelIndexModel, ModelIndexVariant, ModelIndexVariantFormat } from "@/lib/api/studio";

/**
 * Weights may occupy at most this share of the machine's aggregate memory.
 *
 * The rest of the pool pays for the KV cache, activations, CUDA graphs, and the
 * runtime itself — a checkpoint that exactly equals the pool cannot actually be
 * served. 70% is the headroom the curated catalog is tuned against.
 */
export const FIT_BUDGET_RATIO = 0.7;

export type FitState = "fits" | "tight" | "over" | "unknown";

export type Fit = {
  state: FitState;
  /** Weights size used for the verdict, measured or estimated. */
  sizeGb: number | null;
  /** True when sizeGb came from a parameter-count estimate, not the repo. */
  estimated: boolean;
  /** Share of the whole pool the weights take, 0–1+ (null when unknown). */
  poolShare: number | null;
  budgetGb: number;
  label: string;
};

/** Bytes per parameter once a checkpoint is stored in each format. */
const BYTES_PER_PARAM: Record<ModelIndexVariantFormat, number> = {
  bf16: 2,
  fp8: 1,
  nvfp4: 0.55,
  // Q4_K_M lands near 4.8 bits/weight once the attention tensors keep more bits.
  q4: 0.6,
};

export const FORMAT_ORDER: ModelIndexVariantFormat[] = ["bf16", "fp8", "nvfp4", "q4"];

export const FORMAT_LABELS: Record<ModelIndexVariantFormat, string> = {
  bf16: "BF16",
  fp8: "FP8",
  nvfp4: "NVFP4",
  q4: "Q4",
};

/** What each format actually buys you, for the drawer's quantization rows. */
export const FORMAT_BLURBS: Record<ModelIndexVariantFormat, string> = {
  bf16: "Full precision — reference quality, largest download",
  fp8: "Half the weights, near-BF16 quality, needs sm_89+",
  nvfp4: "4-bit for Blackwell; falls back to slower kernels elsewhere",
  q4: "Smallest footprint — AWQ and other 4-bit builds",
};

export function variantSizeGb(variant: ModelIndexVariant, model: ModelIndexModel): number | null {
  if (variant.size_gb != null && Number.isFinite(variant.size_gb)) return variant.size_gb;
  const totalParamsB = model.total_params_b;
  if (totalParamsB == null || !Number.isFinite(totalParamsB) || totalParamsB <= 0) return null;
  return Math.round(totalParamsB * BYTES_PER_PARAM[variant.format] * 10) / 10;
}

export function formatGb(sizeGb: number | null): string {
  if (sizeGb == null || !Number.isFinite(sizeGb)) return "—";
  if (sizeGb >= 1000) return `${(sizeGb / 1000).toFixed(2)} TB`;
  return sizeGb >= 100 ? `${Math.round(sizeGb)} GB` : `${sizeGb.toFixed(1)} GB`;
}

export function formatContextTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "—";
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
}

export function fitFor(sizeGb: number | null, poolGb: number, estimated = false): Fit {
  const budgetGb = poolGb > 0 ? poolGb * FIT_BUDGET_RATIO : 0;
  if (sizeGb == null || !Number.isFinite(sizeGb) || poolGb <= 0) {
    return {
      state: "unknown",
      sizeGb,
      estimated,
      poolShare: null,
      budgetGb,
      label: "size unknown",
    };
  }
  const poolShare = sizeGb / poolGb;
  if (sizeGb <= budgetGb) {
    return { state: "fits", sizeGb, estimated, poolShare, budgetGb, label: "fits" };
  }
  if (sizeGb <= poolGb) {
    return { state: "tight", sizeGb, estimated, poolShare, budgetGb, label: "no headroom" };
  }
  return { state: "over", sizeGb, estimated, poolShare, budgetGb, label: "too large" };
}

export function variantFit(
  variant: ModelIndexVariant,
  model: ModelIndexModel,
  poolGb: number,
): Fit {
  const sizeGb = variantSizeGb(variant, model);
  return fitFor(sizeGb, poolGb, variant.size_gb == null && sizeGb != null);
}

/** Variants in a stable order: smallest format last, official publisher first. */
export function orderedVariants(model: ModelIndexModel): ModelIndexVariant[] {
  return FORMAT_ORDER.flatMap((format) =>
    model.variants
      .filter((variant) => variant.format === format)
      .sort((a, b) => Number(b.official) - Number(a.official)),
  );
}

/**
 * The verdict shown on the card: the smallest variant that clears the budget
 * wins, so a model is "runnable" as soon as any one of its quantizations is.
 */
export function bestFit(model: ModelIndexModel, poolGb: number): { fit: Fit; variant: ModelIndexVariant | null } {
  let best: { fit: Fit; variant: ModelIndexVariant | null } = {
    fit: fitFor(null, poolGb),
    variant: null,
  };
  for (const variant of orderedVariants(model)) {
    const fit = variantFit(variant, model, poolGb);
    if (fit.state === "unknown") continue;
    if (best.variant == null || (fit.sizeGb ?? Infinity) < (best.fit.sizeGb ?? Infinity)) {
      best = { fit, variant };
    }
  }
  return best;
}

export const FIT_TEXT_CLASS: Record<FitState, string> = {
  fits: "text-(--ok)",
  tight: "text-(--warn)",
  over: "text-(--err)",
  unknown: "text-(--ui-muted)",
};

export const FIT_DOT_CLASS: Record<FitState, string> = {
  fits: "bg-(--ok)",
  tight: "bg-(--warn)",
  over: "bg-(--err)",
  unknown: "bg-(--ui-muted)",
};
