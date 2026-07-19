import type { HuggingFaceModelCardPayload } from "@/lib/huggingface";
import type { StarterPreset } from "@/lib/types";

export type GgufFileOption = { value: string; label: string };

export function ggufFileOptions(payload: HuggingFaceModelCardPayload): GgufFileOption[] {
  return (payload.siblings ?? [])
    .flatMap((file) => {
      const name = file.rfilename?.trim();
      if (!name || !/\.gguf$/i.test(name)) return [];
      if (/(?:^|[-_.])(mmproj|projector|adapter|draft)(?:[-_.]|$)/i.test(name)) return [];
      const size =
        typeof file.size === "number" && file.size > 0 ? formatFileSize(file.size) : null;
      return [{ value: name, label: size ? `${name} · ${size}` : name }];
    })
    .sort((first, second) => first.value.localeCompare(second.value));
}

export function manualDownloadPreset(
  modelId: string,
  file: GgufFileOption | undefined,
): StarterPreset | undefined {
  if (!file) return undefined;
  const name = modelId.split("/").pop() || modelId;
  return {
    id: `manual-${modelId.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
    name,
    description: `Exact GGUF file selected from ${modelId}.`,
    kind: "download",
    tags: ["local", "gguf"],
    size_gb: null,
    min_vram_gb: null,
    model_id: modelId,
    allow_patterns: [file.value],
    backend: "llamacpp",
    gguf_file: file.value,
  };
}

function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index >= 3 ? 1 : 0)} ${units[index]}`;
}
