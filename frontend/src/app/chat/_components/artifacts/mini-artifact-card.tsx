"use client";

import * as Icons from "../icons";
import type { Artifact } from "@/lib/types";

interface MiniArtifactCardProps {
  artifact: Artifact;
  onClick?: () => void;
}

export function MiniArtifactCard({ artifact, onClick }: MiniArtifactCardProps) {
  const icon =
    artifact.type === "svg" ? (
      <Icons.Palette className="h-4 w-4" />
    ) : artifact.type === "html" ? (
      <Icons.FileCode className="h-4 w-4" />
    ) : (
      <Icons.Code className="h-4 w-4" />
    );

  const lines = artifact.code.split("\n").length;
  const title = artifact.title || `${artifact.type.toUpperCase()} Artifact`;
  const versionLabel = artifact.version ? `v${artifact.version}` : null;

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-(--border) bg-(--card) hover:bg-(--accent) px-3 py-1 text-left transition-colors text-xs"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-(--accent) text-[#9a9590]">
        {icon}
      </span>
      <span className="max-w-[160px] truncate text-(--foreground)">{title}</span>
      {versionLabel && (
        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-violet-300">
          {versionLabel}
        </span>
      )}
      <span className="rounded-full border border-(--border) bg-(--background) px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#9a9590]">
        {artifact.type}
      </span>
      <span className="text-[10px] text-[#9a9590]">{lines} lines</span>
    </button>
  );
}
