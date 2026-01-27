// CRITICAL
"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  Code,
  FileCode,
  Palette,
  Layers,
  X,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
} from "lucide-react";
import type { Artifact } from "@/lib/types";
import { useAppStore } from "@/store";

interface ArtifactPreviewPanelProps {
  artifacts: Artifact[];
}

export function ArtifactPreviewPanel({ artifacts }: ArtifactPreviewPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");

  const resolvedSelectedId = useMemo(() => {
    if (selectedId && artifacts.some((a) => a.id === selectedId)) {
      return selectedId;
    }
    return artifacts[artifacts.length - 1]?.id ?? null;
  }, [selectedId, artifacts]);

  const selectedIndex = useMemo(() => {
    return artifacts.findIndex((a) => a.id === resolvedSelectedId);
  }, [artifacts, resolvedSelectedId]);

  const selectedArtifact = artifacts.find((a) => a.id === resolvedSelectedId);

  // Auto-select latest artifact
  useEffect(() => {
    if (artifacts.length > 0 && !selectedId) {
      setSelectedId(artifacts[artifacts.length - 1].id);
    }
  }, [artifacts, selectedId]);

  const handlePrev = useCallback(() => {
    if (artifacts.length <= 1) return;
    const newIndex = selectedIndex <= 0 ? artifacts.length - 1 : selectedIndex - 1;
    setSelectedId(artifacts[newIndex].id);
  }, [artifacts, selectedIndex]);

  const handleNext = useCallback(() => {
    if (artifacts.length <= 1) return;
    const newIndex = selectedIndex >= artifacts.length - 1 ? 0 : selectedIndex + 1;
    setSelectedId(artifacts[newIndex].id);
  }, [artifacts, selectedIndex]);

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="w-12 h-12 rounded-xl bg-white/[0.03] flex items-center justify-center mb-4">
          <Layers className="h-6 w-6 text-[#444]" />
        </div>
        <p className="text-sm text-[#666] mb-1">No artifacts yet</p>
        <p className="text-xs text-[#444] max-w-[200px]">
          Artifacts will appear here when the model generates code, SVGs, or HTML previews
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("preview")}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === "preview"
                ? "bg-white/[0.08] text-foreground"
                : "text-[#666] hover:text-[#888]"
            }`}
          >
            Preview
          </button>
          <button
            onClick={() => setActiveTab("code")}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === "code"
                ? "bg-white/[0.08] text-foreground"
                : "text-[#666] hover:text-[#888]"
            }`}
          >
            Code
          </button>
        </div>

        <div className="flex items-center gap-1">
          {artifacts.length > 1 && (
            <>
              <button
                onClick={handlePrev}
                className="p-1.5 rounded hover:bg-white/[0.06] text-[#666]"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-[#666] tabular-nums">
                {selectedIndex + 1}/{artifacts.length}
              </span>
              <button
                onClick={handleNext}
                className="p-1.5 rounded hover:bg-white/[0.06] text-[#666]"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Artifact selector */}
      {artifacts.length > 1 && (
        <div className="flex gap-1 p-2 border-b border-white/[0.06] overflow-x-auto">
          {artifacts.map((artifact) => (
            <ArtifactPill
              key={artifact.id}
              artifact={artifact}
              isSelected={artifact.id === resolvedSelectedId}
              onClick={() => setSelectedId(artifact.id)}
            />
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {selectedArtifact && activeTab === "preview" && (
          <ArtifactPreviewIframe artifact={selectedArtifact} isPlaying={isPlaying} />
        )}
        {selectedArtifact && activeTab === "code" && (
          <pre className="h-full overflow-auto p-4 text-xs font-mono text-[#888] leading-relaxed">
            <code>{selectedArtifact.code}</code>
          </pre>
        )}
      </div>

      {/* Bottom bar */}
      {selectedArtifact && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-white/[0.06]">
          <div className="flex items-center gap-2 min-w-0">
            <ArtifactTypeIcon type={selectedArtifact.type} />
            <span className="text-xs text-[#888] truncate">
              {selectedArtifact.title || `${selectedArtifact.type.toUpperCase()}`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-1.5 rounded hover:bg-white/[0.06] text-[#666]"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ArtifactPill({
  artifact,
  isSelected,
  onClick,
}: {
  artifact: Artifact;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] whitespace-nowrap transition-colors flex-shrink-0 ${
        isSelected
          ? "bg-white/[0.08] text-foreground border border-white/[0.08]"
          : "bg-transparent text-[#666] hover:bg-white/[0.04] border border-transparent"
      }`}
    >
      <ArtifactTypeIcon type={artifact.type} className="h-3 w-3" />
      <span className="max-w-[100px] truncate">
        {artifact.title?.slice(0, 20) || artifact.type}
      </span>
    </button>
  );
}

function ArtifactTypeIcon({
  type,
  className = "h-4 w-4",
}: {
  type: Artifact["type"];
  className?: string;
}) {
  switch (type) {
    case "svg":
      return <Palette className={`${className} text-pink-400`} />;
    case "html":
      return <FileCode className={`${className} text-blue-400`} />;
    case "react":
      return <Code className={`${className} text-cyan-400`} />;
    case "javascript":
      return <Code className={`${className} text-yellow-400`} />;
    default:
      return <Code className={`${className} text-[#666]`} />;
  }
}

// Simple iframe preview without the full artifact viewer complexity
function ArtifactPreviewIframe({
  artifact,
  isPlaying,
}: {
  artifact: Artifact;
  isPlaying: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const srcDoc = useMemo(() => {
    if (!isPlaying) return "<!DOCTYPE html><html><body style='background:#0a0a0a'></body></html>";

    switch (artifact.type) {
      case "svg": {
        const svgCode = artifact.code.includes("<svg")
          ? artifact.code
          : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${artifact.code}</svg>`;
        return `<!DOCTYPE html>
<html><head><style>*{margin:0;padding:0}body{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a}</style></head>
<body>${svgCode}</body></html>`;
      }
      case "html":
        return artifact.code.includes("<!DOCTYPE") || artifact.code.includes("<html")
          ? artifact.code
          : `<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script><style>*{margin:0;padding:0}body{background:#0a0a0a}</style></head><body>${artifact.code}</body></html>`;
      default:
        return `<!DOCTYPE html><html><body style="background:#0a0a0a;padding:20px"><pre style="color:#888;font-family:monospace;font-size:12px;white-space:pre-wrap">${artifact.code}</pre></body></html>`;
    }
  }, [artifact, isPlaying]);

  return (
    <div className="w-full h-full bg-[#0a0a0a]">
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms"
        title={artifact.title || "Artifact Preview"}
      />
    </div>
  );
}
