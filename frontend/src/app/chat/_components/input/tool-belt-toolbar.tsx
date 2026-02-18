// CRITICAL
"use client";

import { memo } from "react";
import type { ModelOption } from "../../types";
import { ToolBeltToolbarDesktop } from "./tool-belt-toolbar/tool-belt-toolbar-desktop";
import { ToolBeltToolbarMobile } from "./tool-belt-toolbar/tool-belt-toolbar-mobile";

export interface ToolBeltToolbarProps {
  isLoading?: boolean;
  elapsedSeconds?: number;
  lastRunDurationSeconds?: number | null;
  thinkingSnippet?: string;
  isRecording: boolean;
  isTranscribing: boolean;
  attachmentsCount: number;
  disabled?: boolean;
  canSend: boolean;
  hasSystemPrompt?: boolean;
  mcpEnabled?: boolean;
  artifactsEnabled?: boolean;
  deepResearchEnabled?: boolean;
  isTTSEnabled?: boolean;
  onOpenResults?: () => void;
  availableModels?: ModelOption[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  onOpenChatSettings?: () => void;
  onOpenMcpSettings?: () => void;
  onMcpToggle?: () => void;
  onArtifactsToggle?: () => void;
  onDeepResearchToggle?: () => void;
  onTTSToggle?: () => void;
  onAttachFile?: () => void;
  onAttachImage?: () => void;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  onStop?: () => void;
  onSubmit?: () => void;
  callModeEnabled?: boolean;
  onCallModeToggle?: () => void;
}

export const ToolBeltToolbar = memo(function ToolBeltToolbar(props: ToolBeltToolbarProps) {
  return (
    <div className="px-2 py-2">
      <ToolBeltToolbarDesktop {...props} />
      <ToolBeltToolbarMobile {...props} />
    </div>
  );
});

