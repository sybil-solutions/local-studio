import type { ReactNode } from "react";
import { Copy, GitFork } from "@/ui/icon-registry";
import { useCopiedFlag } from "@/features/agent/ui/use-copied-flag";
import { writeClipboardText } from "@/lib/clipboard";

export function AssistantActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-(--hl2) transition-colors hover:bg-(--hover) hover:text-(--fg) disabled:pointer-events-none disabled:opacity-30"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function AssistantMessageActions({
  copyText,
  onForkSession,
}: {
  copyText: string;
  onForkSession?: () => void;
}) {
  const [copied, markCopied] = useCopiedFlag();
  const copy = async () => {
    if (!copyText.trim()) return;
    await writeClipboardText(copyText);
    markCopied();
  };
  return (
    <div className="mt-2 flex items-center gap-1 text-(--dim)/65">
      <AssistantActionButton
        label={copied ? "Copied" : "Copy response"}
        onClick={() => void copy()}
        disabled={!copyText.trim()}
      >
        <Copy className="h-4 w-4" strokeWidth={1.5} />
      </AssistantActionButton>
      <AssistantActionButton
        label="Fork from this point"
        onClick={() => onForkSession?.()}
        disabled={!onForkSession}
      >
        <GitFork className="h-4 w-4" strokeWidth={1.5} />
      </AssistantActionButton>
    </div>
  );
}
