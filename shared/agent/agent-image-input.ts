export type AgentImageInput = {
  type: "image";
  data: string;
  mimeType: string;
};

export const AGENT_IMAGE_LIMITS = {
  count: 4,
  perImageBytes: 6_000_000,
  totalBytes: 12_000_000,
} as const;

export const AGENT_IMAGE_MAX_BASE64_CHARS = Math.ceil(AGENT_IMAGE_LIMITS.perImageBytes / 3) * 4;

function isBase64Data(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  for (let index = 0; index < value.length - padding; index += 1) {
    const code = value.charCodeAt(index);
    const valid =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 43 ||
      code === 47;
    if (!valid) return false;
  }
  return true;
}

export function agentImageDataError(data: string): string | null {
  const normalized = data.trim();
  if (!normalized) return "Image data is required.";
  if (normalized.length > AGENT_IMAGE_MAX_BASE64_CHARS) {
    return "Each inline image must be 6 MB or smaller.";
  }
  return isBase64Data(normalized) ? null : "Image data must be valid base64.";
}

export function agentImageByteLength(data: string): number {
  const normalized = data.replace(/\s+/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

export function agentImageLimitError(images: readonly AgentImageInput[]): string | null {
  return agentImageSizesLimitError(images.map((image) => agentImageByteLength(image.data)));
}

export function agentImageSizesLimitError(sizes: readonly number[]): string | null {
  if (sizes.length > AGENT_IMAGE_LIMITS.count) {
    return `Attach up to ${AGENT_IMAGE_LIMITS.count} images per message.`;
  }
  if (sizes.some((size) => size > AGENT_IMAGE_LIMITS.perImageBytes)) {
    return "Each inline image must be 6 MB or smaller.";
  }
  if (sizes.reduce((total, size) => total + size, 0) > AGENT_IMAGE_LIMITS.totalBytes) {
    return "Inline images can total up to 12 MB per message.";
  }
  return null;
}
