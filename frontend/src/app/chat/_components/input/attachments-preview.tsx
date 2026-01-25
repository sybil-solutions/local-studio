// CRITICAL
"use client";

import Image from "next/image";
import { Mic, FileText, X } from "lucide-react";
import type { Attachment } from "../../types";

interface AttachmentsPreviewProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  formatFileSize: (bytes: number) => string;
}

export function AttachmentsPreview({
  attachments,
  onRemove,
  formatFileSize,
}: AttachmentsPreviewProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-3 px-3 md:px-0">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="relative group flex items-center gap-2 px-2.5 py-1.5 bg-(--accent) rounded-lg border border-(--border)"
        >
          {attachment.type === "image" ? (
            <div className="flex items-center gap-2">
              {attachment.url && (
                <Image
                  src={attachment.url}
                  alt={attachment.name}
                  width={32}
                  height={32}
                  className="w-8 h-8 rounded object-cover"
                  unoptimized
                />
              )}
              <div className="text-xs">
                <p className="font-medium truncate max-w-[100px]">{attachment.name}</p>
                <p className="text-[#9a9590]">{formatFileSize(attachment.size)}</p>
              </div>
            </div>
          ) : attachment.type === "audio" ? (
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-(--success)" />
              <div className="text-xs">
                <p className="font-medium">{attachment.name}</p>
                <p className="text-[#9a9590]">{formatFileSize(attachment.size)}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[#9a9590]" />
              <div className="text-xs">
                <p className="font-medium truncate max-w-[100px]">{attachment.name}</p>
                <p className="text-[#9a9590]">{formatFileSize(attachment.size)}</p>
              </div>
            </div>
          )}
          <button
            onClick={() => onRemove(attachment.id)}
            className="absolute -top-1 -right-1 p-0.5 rounded-full bg-(--error) text-white opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
