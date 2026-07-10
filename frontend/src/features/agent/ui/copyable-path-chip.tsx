"use client";

import { useCallback, type ReactNode } from "react";
import { Copy, FileText } from "@/ui/icon-registry";
import { useCopiedFlag } from "@/features/agent/ui/use-copied-flag";

/**
 * A file-path reference chip: an "open" affordance plus a copy-to-clipboard
 * button. Reusable across the assistant markdown renderer and anywhere else a
 * path needs to be surfaced as an actionable chip.
 */
export function CopyablePathChip({
  value,
  children,
  onOpen,
}: {
  value: string;
  children: ReactNode;
  onOpen: (path: string) => void;
}) {
  const [copied, markCopied] = useCopiedFlag();
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(value).then(markCopied, () => undefined);
  }, [value, markCopied]);
  return (
    <span className="chat-ref-chip chat-ref-path" role="group" title={value}>
      <button
        type="button"
        onClick={() => onOpen(value)}
        className="chat-ref-chip-open"
        aria-label={`Open ${value}`}
        title={`Open ${value}`}
      >
        <FileText className="chat-ref-chip-icon" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onOpen(value)}
        className="chat-ref-chip-label cursor-pointer bg-transparent text-left"
        title={`Open ${value}`}
      >
        {children}
      </button>
      <button
        type="button"
        onClick={handleCopy}
        className="chat-ref-chip-copy"
        aria-label={copied ? "Copied path" : `Copy ${value}`}
        title={copied ? "Copied" : "Copy path"}
      >
        <Copy className="h-2.5 w-2.5" aria-hidden />
      </button>
    </span>
  );
}
