export type ModelVisionInput = {
  identifiers: readonly string[];
  recipeOverride?: boolean | null;
  metadata?: unknown;
  modalities?: readonly unknown[];
};

const VISION_IDENTIFIER_PATTERNS = [
  "mimo-v2.5",
  "mimo-v2-5",
  "step-3.7",
  "step-3_7",
  "step-3-7",
  "nex-n2",
  "gemma-4",
  "gemma4",
  "llava",
  "internvl",
  "qwen-vl",
  "qwen2-vl",
  "qwen2.5-vl",
  "qwen3-vl",
  "qwen-omni",
  "pixtral",
  "minicpm-v",
  "molmo",
  "phi-3.5-v",
  "phi-3-vision",
  "phi-4-mm",
  "phi-4-multimodal",
  "llama-3.2-vision",
  "llama-4",
  "deepseek-vl",
  "idefics",
  "ovis",
  "moondream",
  "fuyu",
  "kosmos",
  "-vl-",
  "-vlm",
  "vision",
  "multimodal",
  "-mm-",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const booleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const firstBoolean = (values: readonly unknown[]): boolean | undefined => {
  for (const value of values) {
    const parsed = booleanValue(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};

const imageModality = (value: unknown): boolean | undefined => {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const modalities = values
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (modalities.length === 0) return undefined;
  return modalities.some((entry) => entry === "image" || entry === "vision");
};

const firstImageModality = (values: readonly unknown[]): boolean | undefined => {
  let declared = false;
  for (const value of values) {
    const parsed = imageModality(value);
    if (parsed === true) return true;
    if (parsed === false) declared = true;
  }
  return declared ? false : undefined;
};

const legacyVision = (
  metadataValue: unknown,
  modalities: readonly unknown[],
): boolean | undefined => {
  const metadata = isRecord(metadataValue) ? metadataValue : {};
  const capabilities = isRecord(metadata["capabilities"]) ? metadata["capabilities"] : {};
  return (
    firstBoolean([
      metadata["vision"],
      metadata["supportsVision"],
      metadata["supports_vision"],
      metadata["multimodal"],
      capabilities["vision"],
      capabilities["image"],
    ]) ??
    firstImageModality([
      metadata["input"],
      metadata["inputs"],
      metadata["modalities"],
      metadata["input_modalities"],
      ...modalities,
    ])
  );
};

export const inferModelVision = (identifiers: readonly string[]): boolean =>
  identifiers.some((identifier) => {
    const normalized = identifier.toLowerCase();
    return VISION_IDENTIFIER_PATTERNS.some((pattern) => normalized.includes(pattern));
  });

export const resolveModelVision = ({
  identifiers,
  recipeOverride,
  metadata,
  modalities = [],
}: ModelVisionInput): boolean =>
  recipeOverride ?? legacyVision(metadata, modalities) ?? inferModelVision(identifiers);
