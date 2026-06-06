import type { HuggingFaceModel } from "@/lib/types";

const QUANT_MARKERS = [
  "awq",
  "bnb",
  "exl2",
  "exl3",
  "fp4",
  "fp8",
  "gguf",
  "gptq",
  "int4",
  "int8",
  "mlx",
  "mxfp4",
  "oq",
  "oq4",
  "oq6",
  "q2",
  "q3",
  "q4",
  "q5",
  "q6",
  "q8",
  "quant",
  "w4a16",
  "w8a16",
  "4-bit",
  "6-bit",
] as const;

const DERIVATIVE_OWNERS = new Set([
  "bartowski",
  "ggml-org",
  "jundot",
  "lmstudio-community",
  "mlx-community",
  "quantfactory",
  "thebloke",
  "unsloth",
]);

const BASE_MODEL_PREFIX = "base_model:";
export const RECENT_HF_MODEL_MONTHS = 6;
export const RECENT_HF_MODEL_SORT = "trendingScore";

export type HuggingFaceModelCardPayload = {
  modelId: string;
  author?: string;
  sha?: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  pipeline_tag?: string;
  library_name?: string;
  createdAt?: string;
  lastModified?: string;
  cardData?: Record<string, unknown>;
  siblings?: Array<{ rfilename?: string; size?: number }>;
  readme?: string;
  url: string;
};

export function hfModelUrl(modelId: string): string {
  return `https://huggingface.co/${modelId}`;
}

export function hfAvatarUrl(modelId: string, author?: string | null): string {
  const owner = (author || modelId.split("/")[0] || "huggingface").trim();
  return `/api/huggingface/avatar?owner=${encodeURIComponent(owner)}`;
}

export function normalizeModelId(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(
      /[-_](awq|bnb|exl2|exl3|fp4|fp8|gguf|gptq|int4|int8|mlx|mxfp4|oq[2-8]?|quant|w4a16|w8a16|[2-8]-bit)(?=$|[-_])/gi,
      "",
    )
    .replace(/[-_](fp16|bf16|f16)(?=$|[-_]mtp$|[-_]mlx$)/gi, "")
    .replace(/[-_]mtp$/gi, "")
    .replace(/[-_]?q[2-8](_k_[msl]|_[msl])?$/gi, "")
    .replace(/[-_]{2,}/g, "-")
    .replace(/[-_]+$/g, "");
}

export function modelFamilyName(modelId: string): string {
  const repo = modelId.split("/").filter(Boolean).pop() ?? modelId;
  return normalizeModelId(repo);
}

export function modelRecencyMs(
  model: Pick<HuggingFaceModel, "lastModified" | "createdAt">,
): number {
  const raw = model.lastModified || model.createdAt;
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function modelPublishedMs(
  model: Pick<HuggingFaceModel, "createdAt" | "lastModified">,
): number {
  const raw = model.createdAt;
  if (!raw) return 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function recentHfModelCutoffMs(nowMs = Date.now()): number {
  const cutoff = new Date(nowMs);
  cutoff.setMonth(cutoff.getMonth() - RECENT_HF_MODEL_MONTHS);
  return cutoff.getTime();
}

export function isRecentHuggingFaceModel(
  model: Pick<HuggingFaceModel, "createdAt" | "lastModified">,
  nowMs = Date.now(),
): boolean {
  const publishedMs = modelPublishedMs(model);
  return publishedMs > 0 && publishedMs >= recentHfModelCutoffMs(nowMs);
}

export function baseModelFromTags(tags: string[] = []): string | null {
  for (const tag of tags) {
    if (!tag.toLowerCase().startsWith(BASE_MODEL_PREFIX)) continue;
    const value = tag.slice(BASE_MODEL_PREFIX.length).trim();
    if (value.includes("/")) return value;
  }
  return null;
}

export function quantizationLabels(model: Pick<HuggingFaceModel, "modelId" | "tags">): string[] {
  const text = `${model.modelId} ${(model.tags ?? []).join(" ")}`.toLowerCase();
  const labels = new Set<string>();

  for (const marker of QUANT_MARKERS) {
    const pattern =
      marker.startsWith("q") && marker.length === 2
        ? new RegExp(`(^|[-_\\s])${marker}($|[-_\\s])`, "i")
        : new RegExp(`(^|[-_\\s])${marker}($|[-_\\s])`, "i");
    if (pattern.test(text)) labels.add(marker.toUpperCase());
  }

  return [...labels].sort((a, b) => quantRank(a) - quantRank(b));
}

export function isDerivativeModel(model: Pick<HuggingFaceModel, "modelId" | "tags">): boolean {
  const owner = model.modelId.split("/")[0]?.toLowerCase() ?? "";
  if (DERIVATIVE_OWNERS.has(owner)) return true;
  if (baseModelFromTags(model.tags ?? [])) return true;
  return quantizationLabels(model).length > 0;
}

export function originalModelKey(model: Pick<HuggingFaceModel, "modelId" | "tags">): string {
  const baseModel = baseModelFromTags(model.tags ?? []);
  return baseModel ? modelFamilyName(baseModel) : modelFamilyName(model.modelId);
}

export function modelDisplayName(modelId: string): string {
  return modelId.split("/").filter(Boolean).pop() ?? modelId;
}

export function engagementTier(likes: number, downloads: number): "heavy" | "warm" | "fresh" {
  if (likes >= 1000 || downloads >= 250_000) return "heavy";
  if (likes >= 250 || downloads >= 50_000) return "warm";
  return "fresh";
}

function quantRank(label: string): number {
  const normalized = label.toLowerCase();
  if (normalized === "mlx") return 0;
  if (normalized.startsWith("oq")) return 0.5;
  if (normalized === "gguf") return 1;
  if (normalized === "awq") return 2;
  if (normalized === "gptq") return 3;
  if (normalized.endsWith("-bit")) return 8;
  const qMatch = normalized.match(/^q([2-8])/);
  if (qMatch) return 10 + Number(qMatch[1]);
  return 50;
}
