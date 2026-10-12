"use client";

import { formatBytes } from "@/lib/formatters";
import { StatusPill } from "@/ui";
import { CloseIcon, FileIcon } from "@/ui/icons";

export type AgentComposerAttachment = {
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

export function AgentAttachmentTray({
  attachments,
  modelSupportsVision,
  onRemove,
}: {
  attachments: AgentComposerAttachment[];
  modelSupportsVision: boolean;
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  const hasInlineImage = attachments.some(
    (attachment) => attachment.mode === "data-url" && attachment.type.startsWith("image/"),
  );

  return (
    <div className="px-3 pt-2.5">
      {hasInlineImage && !modelSupportsVision ? (
        <div className="mb-2 flex items-center gap-2" role="status">
          <StatusPill tone="warning" variant="badge">
            Vision unavailable
          </StatusPill>
          <span className="truncate text-[length:var(--fs-xs)] text-(--ui-warning)">
            The model will receive file details, not the image.
          </span>
        </div>
      ) : null}
      <div className="flex max-h-14 flex-nowrap gap-2 overflow-x-auto [scrollbar-width:thin]">
        {attachments.map((file) => (
          <span
            key={file.id}
            className="inline-flex h-12 max-w-[220px] shrink-0 items-center gap-2 rounded-xl border border-(--border) bg-(--bg)/35 px-2 text-[length:var(--fs-sm)] text-(--dim)"
            title={`${file.name} · ${file.type} · ${formatBytes(file.size)}${file.path ? ` · ${file.path}` : ""}`}
          >
            <AttachmentPreview file={file} />
            <span className="truncate">{file.name}</span>
            <span className="shrink-0 opacity-70">{formatBytes(file.size)}</span>
            <button
              type="button"
              onClick={() => onRemove(file.id)}
              className="ml-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-(--hover) hover:text-(--fg)"
              aria-label={`Remove ${file.name}`}
              title={`Remove ${file.name}`}
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function AttachmentPreview({ file }: { file: AgentComposerAttachment }) {
  if (isImageAttachment(file)) {
    return <img src={file.content} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />;
  }

  if (isRenderableAttachment(file) && file.previewKind === "pdf") {
    return (
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-(--border) bg-(--bg) font-mono text-[length:var(--fs-2xs)] text-(--fg)">
        PDF
      </span>
    );
  }

  if (isRenderableAttachment(file) && file.previewKind === "video") {
    return (
      <video src={file.previewUrl} className="h-8 w-8 shrink-0 rounded-lg object-cover" muted />
    );
  }

  if (isRenderableAttachment(file) && file.previewKind === "audio") {
    return (
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-(--border) bg-(--bg) font-mono text-[length:var(--fs-2xs)] text-(--fg)">
        AUD
      </span>
    );
  }

  return <FileIcon className="h-3 w-3 shrink-0" />;
}

function isImageAttachment(file: Pick<AgentComposerAttachment, "type" | "mode" | "content">) {
  return (
    file.type.startsWith("image/") && file.mode === "data-url" && file.content.startsWith("data:")
  );
}

function isRenderableAttachment(
  file: Pick<AgentComposerAttachment, "previewKind" | "previewUrl" | "type">,
) {
  return Boolean(
    file.previewUrl &&
    (file.previewKind === "image" ||
      file.previewKind === "video" ||
      file.previewKind === "audio" ||
      file.previewKind === "pdf"),
  );
}
