// CRITICAL
"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import * as Icons from "../icons";
import type { Artifact } from "@/lib/types";
import { CodePreview } from "../code";
import {
  buildSvgDocument,
  buildReactDocument,
  buildJsDocument,
  buildHtmlDocument,
  buildTextDocument,
} from "./artifact-templates";

interface ArtifactPreviewPanelProps {
  artifacts: Artifact[];
}

interface ArtifactGroup {
  id: string;
  label: string;
  artifacts: Artifact[];
  lastIndex: number;
}

export function ArtifactPreviewPanel({ artifacts }: ArtifactPreviewPanelProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");

  const groups = useMemo<ArtifactGroup[]>(() => {
    const map = new Map<string, ArtifactGroup>();
    artifacts.forEach((artifact, index) => {
      const titleKey = (artifact.title || artifact.type).trim().toLowerCase();
      const groupId = artifact.groupId || `${artifact.type}:${titleKey || artifact.type}`;
      const label = (artifact.title || artifact.type).trim() || artifact.type.toUpperCase();
      const existing = map.get(groupId);
      if (existing) {
        existing.artifacts.push(artifact);
        existing.lastIndex = index;
      } else {
        map.set(groupId, {
          id: groupId,
          label,
          artifacts: [artifact],
          lastIndex: index,
        });
      }
    });

    return Array.from(map.values())
      .map((group) => ({
        ...group,
        artifacts: [...group.artifacts].sort(
          (a, b) => (a.version ?? 0) - (b.version ?? 0),
        ),
      }))
      .sort((a, b) => a.lastIndex - b.lastIndex);
  }, [artifacts]);

  const resolvedGroupId =
    selectedGroupId && groups.some((group) => group.id === selectedGroupId)
      ? selectedGroupId
      : groups[groups.length - 1]?.id ?? null;

  const activeGroup = useMemo(() => {
    if (!resolvedGroupId) return null;
    return groups.find((group) => group.id === resolvedGroupId) ?? null;
  }, [groups, resolvedGroupId]);

  const versions = activeGroup?.artifacts ?? [];
  const resolvedVersionId =
    selectedVersionId && versions.some((artifact) => artifact.id === selectedVersionId)
      ? selectedVersionId
      : versions[versions.length - 1]?.id ?? null;

  const activeArtifact = useMemo(() => {
    if (!resolvedVersionId) return null;
    return versions.find((artifact) => artifact.id === resolvedVersionId) ?? null;
  }, [versions, resolvedVersionId]);

  const selectedIndex = useMemo(() => {
    if (!activeArtifact || versions.length === 0) return 0;
    return versions.findIndex((artifact) => artifact.id === activeArtifact.id);
  }, [versions, activeArtifact]);

  const handlePrev = useCallback(() => {
    if (versions.length <= 1) return;
    const newIndex = selectedIndex <= 0 ? versions.length - 1 : selectedIndex - 1;
    setSelectedVersionId(versions[newIndex].id);
  }, [versions, selectedIndex]);

  const handleNext = useCallback(() => {
    if (versions.length <= 1) return;
    const newIndex = selectedIndex >= versions.length - 1 ? 0 : selectedIndex + 1;
    setSelectedVersionId(versions[newIndex].id);
  }, [versions, selectedIndex]);

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="w-12 h-12 rounded-xl bg-white/3 flex items-center justify-center mb-4">
          <Icons.Layers className="h-6 w-6 text-[#444]" />
        </div>
        <p className="text-sm text-[#666] mb-1">No artifacts yet</p>
        <p className="text-xs text-[#444] max-w-50">
          Artifacts will appear here when the model generates code, SVGs, or HTML previews
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/6">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("preview")}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === "preview"
                ? "bg-white/8 text-foreground"
                : "text-[#666] hover:text-[#888]"
            }`}
          >
            Preview
          </button>
          <button
            onClick={() => setActiveTab("code")}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === "code" ? "bg-white/8 text-foreground" : "text-[#666] hover:text-[#888]"
            }`}
          >
            Code
          </button>
        </div>

        <div className="flex items-center gap-1">
          {versions.length > 1 && (
            <>
              <button onClick={handlePrev} className="p-1.5 rounded hover:bg-white/6 text-[#666]">
                <Icons.ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-[#666] tabular-nums">
                {selectedIndex + 1}/{versions.length}
              </span>
              <button onClick={handleNext} className="p-1.5 rounded hover:bg-white/6 text-[#666]">
                <Icons.ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Group selector */}
      {groups.length > 1 && (
        <div className="flex gap-1 p-2 border-b border-white/6 overflow-x-auto">
          {groups.map((group) => (
            <ArtifactGroupPill
              key={group.id}
              group={group}
              isSelected={group.id === activeGroup?.id}
              onClick={() => {
                setSelectedGroupId(group.id);
                setSelectedVersionId(group.artifacts[group.artifacts.length - 1]?.id ?? null);
              }}
            />
          ))}
        </div>
      )}

      {/* Version selector */}
      {activeGroup && activeGroup.artifacts.length > 1 && (
        <div className="flex gap-1 px-3 py-2 border-b border-white/6 overflow-x-auto">
          {activeGroup.artifacts.map((artifact) => (
            <ArtifactVersionPill
              key={artifact.id}
              artifact={artifact}
              isSelected={artifact.id === activeArtifact?.id}
              onClick={() => setSelectedVersionId(artifact.id)}
            />
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeArtifact && activeTab === "preview" && (
          <ArtifactPreviewIframe artifact={activeArtifact} isPlaying={isPlaying} />
        )}
        {activeArtifact && activeTab === "code" && (
          <CodePreview
            code={activeArtifact.code}
            language={
              activeArtifact.type === "react"
                ? "jsx"
                : activeArtifact.type === "javascript"
                  ? "javascript"
                  : activeArtifact.type === "python"
                    ? "python"
                    : activeArtifact.type
            }
            className="h-full text-[#e6e2dd]"
          />
        )}
      </div>

      {/* Bottom bar */}
      {activeArtifact && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-white/6">
          <div className="flex items-center gap-2 min-w-0">
            <ArtifactTypeIcon type={activeArtifact.type} />
            <span className="text-xs text-[#888] truncate">
              {activeArtifact.title || `${activeArtifact.type.toUpperCase()}`}
            </span>
            {activeArtifact.version && (
              <span className="text-[10px] text-violet-300">v{activeArtifact.version}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="p-1.5 rounded hover:bg-white/6 text-[#666]"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Icons.Pause className="h-3.5 w-3.5" /> : <Icons.Play className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ArtifactGroupPill({
  group,
  isSelected,
  onClick,
}: {
  group: ArtifactGroup;
  isSelected: boolean;
  onClick: () => void;
}) {
  const latestVersion = group.artifacts[group.artifacts.length - 1]?.version;

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] whitespace-nowrap transition-colors shrink-0 ${
        isSelected
          ? "bg-white/8 text-foreground border border-white/8"
          : "bg-transparent text-[#666] hover:bg-white/4 border border-transparent"
      }`}
    >
      <ArtifactTypeIcon type={group.artifacts[0]?.type ?? "html"} className="h-3 w-3" />
      <span className="max-w-30 truncate">{group.label}</span>
      {latestVersion && (
        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-300">
          v{latestVersion}
        </span>
      )}
    </button>
  );
}

function ArtifactVersionPill({
  artifact,
  isSelected,
  onClick,
}: {
  artifact: Artifact;
  isSelected: boolean;
  onClick: () => void;
}) {
  const versionLabel = artifact.version ? `v${artifact.version}` : "v1";

  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded-md text-[10px] font-mono transition-colors ${
        isSelected
          ? "bg-violet-500/15 text-violet-300 border border-violet-500/30"
          : "bg-white/2 text-[#666] hover:text-[#888] border border-white/5"
      }`}
    >
      {versionLabel}
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
      return <Icons.Palette className={`${className} text-pink-400`} />;
    case "html":
      return <Icons.FileCode className={`${className} text-blue-400`} />;
    case "react":
      return <Icons.Code className={`${className} text-cyan-400`} />;
    case "javascript":
      return <Icons.Code className={`${className} text-yellow-400`} />;
    default:
      return <Icons.Code className={`${className} text-[#666]`} />;
  }
}

function ArtifactPreviewIframe({
  artifact,
  isPlaying,
}: {
  artifact: Artifact;
  isPlaying: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const srcDoc = useMemo(() => {
    if (!isPlaying) return buildTextDocument("");

    switch (artifact.type) {
      case "svg": {
        const svgCode = artifact.code.includes("<svg")
          ? artifact.code
          : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${artifact.code}</svg>`;
        return buildSvgDocument(svgCode, 1);
      }
      case "html":
        return buildHtmlDocument(artifact.code);
      case "javascript":
        return buildJsDocument(artifact.code);
      case "react":
        return buildReactDocument(artifact.code);
      default:
        return buildTextDocument(artifact.code);
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
