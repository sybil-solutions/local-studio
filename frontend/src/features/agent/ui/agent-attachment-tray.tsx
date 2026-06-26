"use client";

import { formatBytes } from "@/lib/formatters";
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
  onRemove,
}: {
  attachments: AgentComposerAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-4 pt-2">
      {attachments.map((file) => (
        <span
          key={file.id}
          className="inline-flex max-w-[220px] items-center gap-1 px-1 py-0.5 text-[length:var(--fs-sm)] text-(--dim)"
          title={`${file.name} · ${file.type} · ${formatBytes(file.size)}${file.path ? ` · ${file.path}` : ""}`}
        >
          <AttachmentPreview file={file} />
          <span className="truncate">{file.name}</span>
          <span className="shrink-0 opacity-70">{formatBytes(file.size)}</span>
          <button
            type="button"
            onClick={() => onRemove(file.id)}
            className="p-0.5 hover:text-(--fg)"
            aria-label={`Remove ${file.name}`}
            title={`Remove ${file.name}`}
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function AttachmentPreview({ file }: { file: AgentComposerAttachment }) {
  if (isImageAttachment(file)) {
    return <img src={file.content} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />;
  }

  if (isRenderableAttachment(file) && file.previewKind === "pdf") {
    return (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-(--border) bg-(--bg) font-mono text-[length:var(--fs-2xs)] text-(--fg)">
        PDF
      </span>
    );
  }

  if (isRenderableAttachment(file) && file.previewKind === "video") {
    return <video src={file.previewUrl} className="h-7 w-7 shrink-0 rounded object-cover" muted />;
  }

  if (isRenderableAttachment(file) && file.previewKind === "audio") {
    return (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-(--border) bg-(--bg) font-mono text-[length:var(--fs-2xs)] text-(--fg)">
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
