"use client";

import * as Icons from "../icons";
import type { Artifact } from "@/lib/types";
import { ArtifactViewer } from "./artifact-viewer";

interface ArtifactModalProps {
  artifact: Artifact | null;
  onClose: () => void;
}

export function ArtifactModal({ artifact, onClose }: ArtifactModalProps) {
  if (!artifact) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-3 md:p-6">
      <div className="relative w-full max-w-5xl max-h-[90vh] overflow-auto rounded-xl border border-(--border) bg-(--card)">
        <button
          onClick={onClose}
          className="absolute right-2 top-2 z-10 p-1.5 rounded-full bg-(--background) border border-(--border) hover:bg-(--accent)"
          title="Close"
        >
          <Icons.X className="h-4 w-4" />
        </button>
        <div className="p-3">
          <ArtifactViewer artifact={artifact} isActive />
        </div>
      </div>
    </div>
  );
}
