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
    <div className="fixed inset-0 z-120 flex flex-col bg-black/90">
      {/* Header with safe area padding for mobile notch */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div className="flex items-center gap-2 text-sm text-[#999]">
          <Icons.Code className="h-4 w-4" />
          <span className="truncate max-w-[200px]">{artifact.title || "Artifact"}</span>
        </div>
        <button
          onClick={onClose}
          title="Close"
        >
          <Icons.X className="h-5 w-5 text-white" />
        </button>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        <ArtifactViewer artifact={artifact} isActive />
      </div>
    </div>
  );
}
