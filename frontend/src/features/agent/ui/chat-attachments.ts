"use client";

import { newId, randomIdSegment } from "@/features/agent/messages/helpers";
import type { AgentImageInput } from "@/features/agent/contracts";
import { formatBytes } from "@/lib/formatters";

export type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  path?: string;
  mode: "text" | "data-url" | "metadata";
  content: string;
  previewUrl?: string;
  previewKind?: "image" | "video" | "audio" | "pdf" | "file";
};

export type ProjectFileAttachmentInput = {
  id: string;
  name: string;
  path: string;
  content: string;
  truncated: boolean;
  size: number;
};

const MAX_INLINE_TEXT_ATTACHMENT_BYTES = 350_000;
const MAX_INLINE_IMAGE_ATTACHMENT_BYTES = 6_000_000;

export function attachmentDedupKey(file: Pick<ChatAttachment, "name" | "type" | "size" | "path">) {
  const path = file.path?.trim();
  if (path) return `path:${path}`;
  return `file:${file.name.trim().toLowerCase()}:${file.type}:${file.size}`;
}

export function isImageAttachment(file: Pick<ChatAttachment, "type" | "mode" | "content">) {
  return (
    file.type.startsWith("image/") && file.mode === "data-url" && file.content.startsWith("data:")
  );
}

export function imageInputFromAttachment(
  file: Pick<ChatAttachment, "type" | "mode" | "content">,
): AgentImageInput | null {
  if (!isImageAttachment(file)) return null;
  const marker = ";base64,";
  const markerIndex = file.content.indexOf(marker);
  if (markerIndex === -1) return null;
  const data = file.content.slice(markerIndex + marker.length).replace(/\s+/g, "");
  if (!data) return null;
  return { type: "image", data, mimeType: file.type };
}

function previewKindFor(type: string): ChatAttachment["previewKind"] {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  return "file";
}

function objectUrlFor(file: File): string | undefined {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return undefined;
  try {
    return URL.createObjectURL(file);
  } catch {
    return undefined;
  }
}

function newAttachmentId() {
  return newId("file");
}

function extensionFromMimeType(type: string): string {
  if (!type) return "bin";
  const normalized = type.toLowerCase().split(";")[0]?.trim() ?? "";
  const known: Record<string, string> = {
    "application/json": "json",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
    "text/csv": "csv",
    "text/html": "html",
    "text/markdown": "md",
    "text/plain": "txt",
    "video/quicktime": "mov",
  };
  if (known[normalized]) return known[normalized];
  const [, subtype] = normalized.split("/");
  const sanitized = subtype?.replace(/[^a-z0-9]+/g, "").replace(/^x/, "");
  return sanitized || "bin";
}

export function imageFileFromDataUrlText(value: string): File | null {
  if (typeof File === "undefined" || typeof atob === "undefined") return null;
  const trimmed = value.trim();
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!match) return null;
  const type = match[1] ?? "image/png";
  const base64 = (match[2] ?? "").replace(/\s+/g, "");
  if (!base64) return null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const extension = extensionFromMimeType(type);
    return new File([bytes], `pasted-${Date.now().toString(36)}.${extension}`, { type });
  } catch {
    return null;
  }
}

function fileDisplayName(file: File): string {
  const name = file.name.trim();
  if (name) return name;
  return `pasted-${Date.now().toString(36)}-${randomIdSegment(4)}.${extensionFromMimeType(file.type)}`;
}

function isTextLike(file: File, name = file.name) {
  if (file.type.startsWith("text/")) return true;
  return /\.(md|markdown|txt|json|csv|tsv|log|yaml|yml|xml|html|css|js|jsx|ts|tsx|py|sh|sql)$/i.test(
    name,
  );
}

function getDesktopFilePath(file: File): string | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { localStudioDesktop?: { getPathForFile?: unknown } })
    .localStudioDesktop;
  const getPathForFile = bridge?.getPathForFile;
  if (typeof getPathForFile !== "function") return null;
  try {
    const path = getPathForFile(file);
    return typeof path === "string" && path.trim() ? path : null;
  } catch {
    return null;
  }
}

export function dataTransferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes("Files");
}

export function filesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  const files: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file) return;
    // Chromium/Electron can expose the same pasted file through both
    // DataTransfer.files and DataTransfer.items with different lastModified
    // values. Deliberately leave lastModified out so one paste yields one
    // composer attachment.
    const key = `${file.name.trim().toLowerCase()}:${file.type}:${file.size}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  Array.from(dataTransfer.files ?? []).forEach(push);
  Array.from(dataTransfer.items ?? []).forEach((item) => {
    if (item.kind === "file") push(item.getAsFile());
  });
  return files;
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function createAttachment(file: File): Promise<ChatAttachment> {
  const id = newAttachmentId();
  const name = fileDisplayName(file);
  const type = file.type || "application/octet-stream";
  const path = getDesktopFilePath(file) ?? undefined;
  const previewKind = previewKindFor(type);
  const previewUrl = ["image", "video", "audio", "pdf"].includes(previewKind ?? "")
    ? objectUrlFor(file)
    : undefined;
  if (isTextLike(file, name) && file.size <= MAX_INLINE_TEXT_ATTACHMENT_BYTES) {
    return {
      id,
      name,
      type: file.type || "text/plain",
      size: file.size,
      path,
      mode: "text",
      content: await readFileAsText(file),
      previewKind,
      previewUrl,
    };
  }
  if (previewKind === "image" && file.size <= MAX_INLINE_IMAGE_ATTACHMENT_BYTES) {
    return {
      id,
      name,
      type,
      size: file.size,
      path,
      mode: "data-url",
      content: await readFileAsDataUrl(file),
      previewKind,
      previewUrl,
    };
  }
  const metadataContent =
    previewKind === "image"
      ? [
          `Image is above the ${formatBytes(MAX_INLINE_IMAGE_ATTACHMENT_BYTES)} inline image limit, so only metadata is attached to the model.`,
          path ? `It is available on disk at ${path}.` : "",
        ]
          .filter(Boolean)
          .join(" ")
      : path
        ? `File is too large to inline; it is available on disk at ${path}.`
        : previewKind === "pdf"
          ? "PDF preview is visible in the chat UI, but only metadata is attached to the model."
          : previewKind === "audio" || previewKind === "video"
            ? "Media preview is visible in the chat UI, but only metadata is attached to the model."
            : "File is too large to inline; only metadata is attached.";
  return {
    id,
    name,
    type,
    size: file.size,
    path,
    mode: "metadata",
    content: metadataContent,
    previewKind,
    previewUrl,
  };
}

export function createProjectFileAttachment(file: ProjectFileAttachmentInput): ChatAttachment {
  const truncatedMessage = file.size
    ? `File is too large or binary to inline; it is available on disk at ${file.path}.`
    : `File is available on disk at ${file.path}.`;
  return {
    id: file.id,
    name: file.name,
    type: "text/plain",
    size: file.size,
    path: file.path,
    mode: file.truncated ? "metadata" : "text",
    content: file.truncated ? truncatedMessage : file.content,
    previewKind: "file",
  };
}

export function attachmentPrompt(
  attachments: ChatAttachment[],
  options: { modelSupportsVision?: boolean } = {},
) {
  if (attachments.length === 0) return "";
  const modelSupportsVision = options.modelSupportsVision !== false;
  return attachments
    .map((file, index) => {
      const pathInfo = file.path ? `\nLocal path: ${file.path}` : "";
      const header = `Attachment ${index + 1}: ${file.name} (${file.type}, ${formatBytes(file.size)})${pathInfo}`;
      if (file.mode === "text") return `${header}\n\`\`\`\n${file.content}\n\`\`\``;
      if (file.mode === "data-url" && file.type.startsWith("image/")) {
        if (!modelSupportsVision) {
          return `${header}\nThe selected model does not accept image input, so this image is only attached as metadata. If the user asks about the image or screenshot, say you cannot see it because only metadata was attached, and ask them to open the file with a vision-capable model or provide the visual details.`;
        }
        return `${header}\nImage is attached as multimodal input. Do not print or transcribe its base64 data.`;
      }
      return `${header}\n${file.content}`;
    })
    .join("\n\n");
}
