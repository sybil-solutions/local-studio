import { QUANTIZATION_TAGS } from "./config";
import { normalizeModelId as normalizeHfModelId, quantizationLabels } from "@/lib/huggingface";

export function extractProvider(modelId: string): string {
  const parts = modelId.split("/");
  if (parts.length >= 2) {
    return parts[0];
  }
  return "HuggingFace";
}

export function extractQuantizations(tags: string[]): string[] {
  const labels = quantizationLabels({ modelId: "", tags });
  if (labels.length) return labels;
  const tagLower = tags.map((t) => t.toLowerCase());
  return QUANTIZATION_TAGS.filter((quant) => tagLower.includes(quant.toLowerCase())).map((quant) =>
    quant.toUpperCase(),
  );
}

export function normalizeModelId(modelId: string): string {
  return normalizeHfModelId(modelId);
}
