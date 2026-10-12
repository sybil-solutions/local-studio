import { quantizationLabels } from "@/lib/huggingface";

const QUANTIZATION_TAGS = [
  "awq",
  "gptq",
  "exl2",
  "exl3",
  "fp8",
  "fp16",
  "bf16",
  "int8",
  "int4",
  "w4a16",
  "w8a16",
];

export function extractQuantizations(tags: string[]): string[] {
  const labels = quantizationLabels({ modelId: "", tags });
  if (labels.length) return labels;
  const normalized = tags.map((tag) => tag.toLowerCase());
  return QUANTIZATION_TAGS.filter((quantization) =>
    normalized.includes(quantization.toLowerCase()),
  ).map((quantization) => quantization.toUpperCase());
}
