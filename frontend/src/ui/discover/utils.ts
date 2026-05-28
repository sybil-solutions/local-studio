import { QUANTIZATION_TAGS } from "./config";

export function extractProvider(modelId: string): string {
  const parts = modelId.split("/");
  if (parts.length >= 2) {
    return parts[0];
  }
  return "HuggingFace";
}

export function extractQuantizations(tags: string[]): string[] {
  const quantizations: string[] = [];
  const tagLower = tags.map((t) => t.toLowerCase());

  for (const quant of QUANTIZATION_TAGS) {
    if (tagLower.includes(quant.toLowerCase())) {
      quantizations.push(quant.toUpperCase());
    }
  }

  return quantizations;
}

export function normalizeModelId(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/[-_](awq|gptq|gguf|exl2|fp8|fp16|bf16|int8|int4|w4a16|w8a16)[-_]?/gi, "");
}
