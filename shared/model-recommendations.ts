// The model-recommendations contract: one static JSON file
// (shared/model-recommendations.json) carrying every model config we have actually
// tested, on every hardware class we have data for, with the exact startup commands
// used. The download/setup UIs read this to show only pareto-frontier picks that fit
// the user's rig instead of a generic catalog.
//
// Keyed by Hugging Face repo id. "Tested" is the bar for inclusion: an entry's
// commands and speeds come from a real run recorded in the local.ai benchmark data,
// not from estimates. Estimated entries are allowed but must say so via
// `benchmarks: []` + `expectSpeed.source: "estimated"`.

export type QuantKind =
  | "nvfp4"
  | "fp8"
  | "awq"
  | "gptq"
  | "gguf"
  | "exl3"
  | "mlx"
  | "mixed-bit"
  | "bf16";

export type RecommendationEngine = "vllm" | "sglang" | "llamacpp" | "mlx" | "exllamav3";

/** A hardware class an entry is known to run on. Matching is by memory pool first
 *  (VRAM, or unified RAM on Apple/Spark) with named-GPU hints for the UI. */
export interface HardwareTarget {
  /** e.g. "rtx-pro-6000-x4", "rtx-4090", "m1-max-32gb", "dgx-spark" */
  readonly id: string;
  readonly label: string;
  /** Minimum memory pool that ran this config, in GB. */
  readonly minMemoryGb: number;
  readonly gpuCount: number;
  readonly unifiedMemory: boolean;
  /** True when this exact hardware ran the config; false = derived headroom match. */
  readonly tested: boolean;
}

export interface BenchmarkRecord {
  readonly hardwareId: string;
  readonly engine: RecommendationEngine;
  readonly decodeTps: number | null;
  readonly prefillTps: number | null;
  readonly ttftMs: number | null;
  readonly contextTokens: number | null;
  /** ISO date of the measurement run. */
  readonly measuredAt: string | null;
  readonly notes: string | null;
}

export interface ExpectedSpeed {
  readonly decodeTps: number | null;
  readonly prefillTps: number | null;
  readonly source: "measured" | "estimated";
}

export interface ModelRecommendation {
  readonly name: string;
  readonly quant: QuantKind;
  /** Human-facing size of the weights on disk, e.g. "32gb". */
  readonly filesize: string;
  readonly filesizeGb: number;
  readonly hardware: readonly HardwareTarget[];
  /** Exact startup command per engine, as tested. Absent engine = not tested. */
  readonly commands: Readonly<Partial<Record<RecommendationEngine, string>>>;
  /** Pareto rank within its memory class: 1 = best quality/speed tradeoff. */
  readonly rank: number;
  readonly benchmarks: readonly BenchmarkRecord[];
  readonly expectSpeed: ExpectedSpeed;
  /** Optional context: params ("235B-A22B"), license, multimodal, notes. */
  readonly params: string | null;
  readonly notes: readonly string[];
}

/** Keyed by Hugging Face repo id, e.g. "zai-org/GLM-5.2-FP8". */
export type ModelRecommendations = Readonly<Record<string, ModelRecommendation>>;

export interface ModelRecommendationsFile {
  readonly version: number;
  readonly updated: string;
  readonly models: ModelRecommendations;
}

/* ── matching ────────────────────────────────────────────────────────────── */

export interface RigDescriptor {
  /** Total usable memory pool in GB: sum of VRAM, or RAM on unified hosts. */
  readonly memoryPoolGb: number;
  readonly gpuCount: number;
  readonly unifiedMemory: boolean;
  readonly appleSilicon: boolean;
}

/** The user's sizing rule: a config is offered when the rig has the file size plus
 *  50% headroom (weights + KV cache + activations margin). */
export const requiredPoolGb = (recommendation: ModelRecommendation): number =>
  Math.ceil(recommendation.filesizeGb * 1.5);

export const fitsRig = (recommendation: ModelRecommendation, rig: RigDescriptor): boolean => {
  if (rig.memoryPoolGb < requiredPoolGb(recommendation)) return false;
  // Apple rigs can only run quants with an mlx or llama.cpp command.
  if (rig.appleSilicon) {
    return Boolean(recommendation.commands.mlx ?? recommendation.commands.llamacpp);
  }
  return true;
};

export interface RankedRecommendation extends ModelRecommendation {
  readonly hfId: string;
  /** True when a benchmark exists for hardware matching this rig's class. */
  readonly measuredOnThisClass: boolean;
}

/** Pareto picks for a rig: everything that fits, best rank first, measured configs
 *  before estimated ones at equal rank. */
export const recommendationsForRig = (
  file: ModelRecommendationsFile,
  rig: RigDescriptor,
): readonly RankedRecommendation[] =>
  Object.entries(file.models)
    .filter(([, model]) => fitsRig(model, rig))
    .map(([hfId, model]) => ({
      ...model,
      hfId,
      measuredOnThisClass: model.hardware.some(
        (target) => target.tested && rig.memoryPoolGb >= target.minMemoryGb,
      ),
    }))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        Number(right.measuredOnThisClass) - Number(left.measuredOnThisClass) ||
        right.filesizeGb - left.filesizeGb,
    );
