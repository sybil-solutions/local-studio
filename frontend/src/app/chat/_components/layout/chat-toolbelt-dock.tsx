"use client";

import type { ReactNode } from "react";

interface ChatToolbeltDockProps {
  toolBelt: ReactNode;
  showEmptyState: boolean;
}

export function ChatToolbeltDock({ toolBelt, showEmptyState }: ChatToolbeltDockProps) {
  return (
    <div className="fixed left-0 right-0 bottom-0 z-20 md:static">
      {/* Mobile: flush to bottom, no extra padding */}
      <div className="md:hidden">
        {toolBelt}
      </div>
      {!showEmptyState && (
        <div className="hidden md:block shrink-0 pb-0 md:pb-3">{toolBelt}</div>
      )}
    </div>
  );
}
