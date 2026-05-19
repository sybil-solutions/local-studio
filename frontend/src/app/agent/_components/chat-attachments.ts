"use client";

import { newId, randomIdSegment } from "@/lib/agent/session/helpers";

export type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  path?: string;
  mode: "text" | "data-url" | "metadata";
  content: string;
  previewUrl?: string;
  previewKind?: "image" | "video" | "pdf" | "file";
};

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

export function isRenderableAttachment(
  file: Pick<ChatAttachment, "previewKind" | "previewUrl" | "type">,
) {
  return Boolean(
    file.previewUrl &&
    (file.previewKind === "image" || file.previewKind === "video" || file.previewKind === "pdf"),
  );
}

function previewKindFor(type: string): ChatAttachment["previewKind"] {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
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

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  const bridge = (window as unknown as { vllmStudioDesktop?: { getPathForFile?: unknown } })
    .vllmStudioDesktop;
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
  const previewUrl =
    previewKind === "image" || previewKind === "video" || previewKind === "pdf"
      ? objectUrlFor(file)
      : undefined;
  if (isTextLike(file, name) && file.size <= 350_000) {
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
  if (previewKind === "image" && file.size <= 1_500_000) {
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
  return {
    id,
    name,
    type,
    size: file.size,
    path,
    mode: "metadata",
    content: path
      ? `File is too large to inline; it is available on disk at ${path}.`
      : previewKind === "pdf"
        ? "PDF preview is visible in the chat UI, but only metadata is attached to the model."
        : "File is too large to inline; only metadata is attached.",
    previewKind,
    previewUrl,
  };
}

export function attachmentPrompt(attachments: ChatAttachment[]) {
  if (attachments.length === 0) return "";
  return attachments
    .map((file, index) => {
      const pathInfo = file.path ? `\nLocal path: ${file.path}` : "";
      const header = `Attachment ${index + 1}: ${file.name} (${file.type}, ${formatFileSize(file.size)})${pathInfo}`;
      if (file.mode === "text") return `${header}\n\`\`\`\n${file.content}\n\`\`\``;
      if (file.mode === "data-url" && file.type.startsWith("image/")) {
        return `${header}\nImage data URL:\n${file.content}`;
      }
      return `${header}\n${file.content}`;
    })
    .join("\n\n");
}
