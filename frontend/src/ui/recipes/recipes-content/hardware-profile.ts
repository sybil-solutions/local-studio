import type { GPU, HuggingFaceModel } from "@/lib/types";
import { modelDisplayName, quantizationLabels } from "@/lib/huggingface";

export type HardwareTier = "unknown" | "compact" | "single-gpu" | "workstation" | "multi-gpu";
export type FitStatus = "best" | "fits" | "stretch" | "too-large" | "unknown";
export type FitTone = "default" | "good" | "warning" | "danger" | "info";

export interface HardwareProfile {
  tier: HardwareTier;
  label: string;
  detail: string;
  poolGb: number;
  detectedPoolGb: number;
  gpuCount: number;
  appleSilicon: boolean;
  names: string[];
}

export interface ModelFit {
  status: FitStatus;
  reason: string;
  tone: FitTone;
  score: number;
}

export function buildHardwareProfile({
  gpus,
  poolGb,
  detectedPoolGb,
  poolOverrideGb,
}: {
  gpus: GPU[];
  poolGb: number;
  detectedPoolGb: number;
  poolOverrideGb: number | null;
}): HardwareProfile {
  const names = [...new Set(gpus.map((gpu) => gpu.name).filter(Boolean))];
  const appleSilicon = names.some((name) => /apple|m[1-4]\s|metal|unified/i.test(name));
  const tier = hardwareTier(gpus.length, poolGb);
  const label = appleSilicon ? "Apple Silicon" : hardwareLabel(tier);
  const source =
    poolOverrideGb != null ? "manual pool" : detectedPoolGb > 0 ? "detected pool" : "estimate";
  const detail =
    poolGb > 0
      ? `${Math.round(poolGb)} GB ${source}${names.length ? ` · ${names.join(", ")}` : ""}`
      : names.length
        ? names.join(", ")
        : "No live GPU pool reported yet";

  return {
    tier,
    label,
    detail,
    poolGb,
    detectedPoolGb,
    gpuCount: gpus.length,
    appleSilicon,
    names,
  };
}

export function scoreModelFit({
  model,
  variants,
  needGb,
  maxLikes,
  maxDownloads,
  lastModifiedMs,
  hardware,
}: {
  model: HuggingFaceModel;
  variants: HuggingFaceModel[];
  needGb: number | null;
  maxLikes: number;
  maxDownloads: number;
  lastModifiedMs: number;
  hardware: HardwareProfile;
}): ModelFit {
  const quantLabels = new Set(variants.flatMap((variant) => quantizationLabels(variant)));
  const hasMlx = hasMlxSignal(model, variants, quantLabels);
  const hasOmlx = hasOmlxSignal(model, variants, quantLabels);
  const engagementScore = Math.log10(maxLikes + 10) * 18 + Math.log10(maxDownloads + 100) * 10;
  const ageDays =
    lastModifiedMs > 0 ? Math.max(0, (Date.now() - lastModifiedMs) / (24 * 60 * 60 * 1000)) : 240;
  const recencyScore = Math.max(0, 28 - ageDays / 7);
  const appleBonus = hardware.appleSilicon && (hasMlx || hasOmlx) ? 36 : 0;
  const quantBonus = quantLabels.size > 0 ? 8 : 0;
  const fit = fitFromNeed(needGb, hardware.poolGb, hardware.appleSilicon && hasMlx);
  const score = Math.round(
    engagementScore + recencyScore + fit.scoreBoost + appleBonus + quantBonus,
  );

  return {
    status: fit.status,
    reason: fitReason({
      modelId: model.modelId,
      needGb,
      poolGb: hardware.poolGb,
      appleSilicon: hardware.appleSilicon,
      hasMlx,
      hasOmlx,
    }),
    tone: fit.tone,
    score,
  };
}

function hardwareTier(gpuCount: number, poolGb: number): HardwareTier {
  if (poolGb <= 0 && gpuCount === 0) return "unknown";
  if (poolGb < 16) return "compact";
  if (gpuCount <= 1 || poolGb < 64) return "single-gpu";
  if (poolGb < 160) return "workstation";
  return "multi-gpu";
}

function hardwareLabel(tier: HardwareTier): string {
  if (tier === "compact") return "Compact GPU";
  if (tier === "single-gpu") return "Single GPU";
  if (tier === "workstation") return "Workstation";
  if (tier === "multi-gpu") return "Multi-GPU";
  return "Unknown hardware";
}

function fitFromNeed(
  needGb: number | null,
  poolGb: number,
  appleMlx: boolean,
): { status: FitStatus; tone: FitTone; scoreBoost: number } {
  if (poolGb <= 0 || needGb == null || !Number.isFinite(needGb)) {
    return { status: "unknown", tone: "default", scoreBoost: appleMlx ? 8 : 0 };
  }
  const effectiveNeed = appleMlx ? needGb * 0.88 : needGb;
  const ratio = effectiveNeed / poolGb;
  if (ratio <= 0.72) return { status: "best", tone: "good", scoreBoost: 34 };
  if (ratio <= 0.92) return { status: "fits", tone: "info", scoreBoost: 24 };
  if (ratio <= 1.15) return { status: "stretch", tone: "warning", scoreBoost: 6 };
  return { status: "too-large", tone: "danger", scoreBoost: -40 };
}

function fitReason({
  modelId,
  needGb,
  poolGb,
  appleSilicon,
  hasMlx,
  hasOmlx,
}: {
  modelId: string;
  needGb: number | null;
  poolGb: number;
  appleSilicon: boolean;
  hasMlx: boolean;
  hasOmlx: boolean;
}) {
  const name = modelDisplayName(modelId);
  const footprint =
    needGb != null && Number.isFinite(needGb)
      ? `~${needGb < 10 ? needGb.toFixed(1) : Math.round(needGb)} GB`
      : "unknown footprint";
  const pool = poolGb > 0 ? `${Math.round(poolGb)} GB pool` : "no detected pool";
  const mlx = appleSilicon && hasMlx ? " · MLX preferred on Apple Silicon" : "";
  const omlx = hasOmlx ? " · oMLX quant available" : "";
  return `${name}: ${footprint} against ${pool}${mlx}${omlx}`;
}

function hasMlxSignal(
  model: HuggingFaceModel,
  variants: HuggingFaceModel[],
  quantLabels: Set<string>,
): boolean {
  if (quantLabels.has("MLX")) return true;
  return [model, ...variants].some((variant) => {
    const text = `${variant.modelId} ${variant.tags.join(" ")}`.toLowerCase();
    return text.includes("mlx") || text.includes("omlx");
  });
}

function hasOmlxSignal(
  model: HuggingFaceModel,
  variants: HuggingFaceModel[],
  quantLabels: Set<string>,
): boolean {
  if ([...quantLabels].some((label) => label.startsWith("OQ"))) return true;
  return [model, ...variants].some((variant) => /(^|\/)jundot\//i.test(`${variant.modelId}/`));
}
