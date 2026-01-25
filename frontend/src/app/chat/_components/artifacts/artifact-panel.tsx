// CRITICAL
"use client";

import { useMemo } from "react";
import { Code, FileCode, Palette, Layers } from "lucide-react";
import type { Artifact } from "@/lib/types";
import { ArtifactViewer } from "./artifact-viewer";
import { useAppStore } from "@/store";

interface ArtifactPanelProps {
  artifacts: Artifact[];
  isOpen: boolean;
}

export function ArtifactPanel({ artifacts, isOpen }: ArtifactPanelProps) {
  const selectedArtifactId = useAppStore((state) => state.artifactPanelSelectedId);
  const setSelectedArtifactId = useAppStore((state) => state.setArtifactPanelSelectedId);

  const resolvedSelectedId = useMemo(() => {
    if (selectedArtifactId && artifacts.some((a) => a.id === selectedArtifactId)) {
      return selectedArtifactId;
    }
    return artifacts[artifacts.length - 1]?.id ?? null;
  }, [selectedArtifactId, artifacts]);

  const selectedArtifact = artifacts.find((a) => a.id === resolvedSelectedId);

  const getIcon = (type: Artifact["type"]) => {
    switch (type) {
      case "svg":
        return <Palette className="h-3.5 w-3.5" />;
      case "html":
        return <FileCode className="h-3.5 w-3.5" />;
      default:
        return <Code className="h-3.5 w-3.5" />;
    }
  };

  if (!isOpen || artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Layers className="h-8 w-8 text-[#9a9590]/50 mb-2" />
        <p className="text-xs text-[#9a9590]">No artifacts yet</p>
        <p className="text-[10px] text-[#9a9590]/70 mt-1">
          Artifacts appear when the model generates code previews
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-(--border) flex-shrink-0">
        <select
          value={resolvedSelectedId || ""}
          onChange={(e) => setSelectedArtifactId(e.target.value)}
          className="w-full text-xs bg-(--accent) border border-(--border) rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-(--link)"
        >
          {artifacts.map((artifact, index) => (
            <option key={artifact.id} value={artifact.id}>
              {artifact.title || `${artifact.type.toUpperCase()} #${index + 1}`}
            </option>
          ))}
        </select>
      </div>

      {artifacts.length > 1 && (
        <div className="flex gap-1 px-3 py-2 border-b border-(--border) overflow-x-auto flex-shrink-0">
          {artifacts.map((artifact, index) => (
            <button
              key={artifact.id}
              onClick={() => setSelectedArtifactId(artifact.id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] whitespace-nowrap transition-colors flex-shrink-0 ${
                artifact.id === resolvedSelectedId
                  ? "bg-(--link)/20 text-(--link)"
                  : "bg-(--accent) text-[#9a9590] hover:text-(--foreground)"
              }`}
            >
              {getIcon(artifact.type)}
              <span>{artifact.title?.slice(0, 15) || `#${index + 1}`}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto p-2 min-h-0">
        {selectedArtifact && <ArtifactViewer artifact={selectedArtifact} isActive />}
      </div>
    </div>
  );
}
