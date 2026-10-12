"use client";

import { useCallback, useState } from "react";
import { ExternalLink, FolderTree } from "@/ui/icon-registry";
import { rawFileUrl } from "@/features/agent/ui/filesystem-preview";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

// Escape hatches for files the panel cannot edit as text — PDFs, images,
// archives. On desktop they go to the OS (default app / file manager); on web
// the raw endpoint serves the bytes, which the browser downloads or previews.
export function FileOpenActions({
  root,
  relPath,
  compact = false,
}: {
  root: string;
  relPath: string;
  compact?: boolean;
}) {
  const absolute = `${root.replace(/\/+$/, "")}/${relPath}`;
  const openExternally = useCallback(() => {
    const openPath = window.localStudioDesktop?.openPath;
    if (openPath) {
      void openPath(absolute).then(
        (ok) => {
          if (!ok) window.open(rawFileUrl(root, relPath), "_blank", "noopener");
        },
        () => window.open(rawFileUrl(root, relPath), "_blank", "noopener"),
      );
      return;
    }
    window.open(rawFileUrl(root, relPath), "_blank", "noopener");
  }, [absolute, relPath, root]);
  const reveal = useCallback(() => {
    void window.localStudioDesktop?.revealPath?.(absolute);
  }, [absolute]);
  // Read after mount, not during render: the server pass has no desktop bridge,
  // so probing it inline would hydrate a different tree than it rendered.
  const [canReveal, setCanReveal] = useState(false);
  useMountSubscription(() => {
    setCanReveal(Boolean(window.localStudioDesktop?.revealPath));
  }, []);
  const className = compact
    ? "inline-flex h-6 items-center gap-1 rounded-md border border-(--border) bg-(--color-input) px-1.5 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
    : "inline-flex h-7 items-center gap-1.5 rounded-md border border-(--border) bg-(--color-input) px-2 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={openExternally}
        className={className}
        title={`Open ${absolute}`}
      >
        <ExternalLink className="h-3 w-3" />
        Open
      </button>
      {canReveal ? (
        <button
          type="button"
          onClick={reveal}
          className={className}
          title={`Reveal ${absolute} in the file manager`}
        >
          <FolderTree className="h-3 w-3" />
          Reveal
        </button>
      ) : null}
    </div>
  );
}
