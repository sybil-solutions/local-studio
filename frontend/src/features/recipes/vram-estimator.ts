/**
 * VRAM / model-size utilities for LLM inference.
 *
 * Quant byte-widths sourced from:
 * - Standard formats: fp16/bf16/fp8/int8/int4
 * - GGUF formats: oobabooga's 19,517-measurement study
 *   (https://oobabooga.github.io/blog/posts/gguf-vram-formula/)
 */

export type QuantFormat =
  | "fp16"
  | "bf16"
  | "fp8"
  | "int8"
  | "int4"
  | "q6_k"
  | "q4_k_m"
  | "q5_k_m"
  | "q8_0"
  | "q4_0"
  | "q3_k_m"
  | "q2_k"
  | "iq3_m"
  | "iq2";

const QUANT_BYTES: Record<QuantFormat, number> = {
  fp16: 2,
  bf16: 2,
  fp8: 1,
  int8: 1,
  int4: 0.5,
  q6_k: 0.8125, // ~6.5 bits including scales.
  q4_k_m: 0.5625, // ~4.5 bits per param (empirical average)
  q5_k_m: 0.6875, // ~5.5 bits
  q8_0: 1.0625, // ~8.5 bits (slightly more than 1 byte due to group scales)
  q4_0: 0.53125, // ~4.25 bits
  q3_k_m: 0.4375, // ~3.5 bits
  q2_k: 0.375, // ~3 bits
  iq3_m: 0.4375,
  iq2: 0.3125, // ~2.5 bits
};

/**
 * Get quantized model size in MB from parameter count and quantization.
 */
export function estimateModelSizeMb(numParams: number, quant: QuantFormat): number {
  const bytesPerParam = QUANT_BYTES[quant] ?? 2;
  return (numParams * bytesPerParam) / (1024 * 1024);
}
