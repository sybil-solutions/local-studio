// CRITICAL
"use client";

import { ArrowUp, PanelRightOpen, Square } from "lucide-react";
import { buildDisplayModelLabel, type ModelOption } from "../../../types";
import { ToolBeltToolbarMobileMenu } from "./tool-belt-toolbar-mobile-menu";

type Props = {
  isLoading?: boolean;
  elapsedSeconds?: number;
  lastRunDurationSeconds?: number | null;
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
};

export function ToolBeltToolbarMobile({
  isLoading,
  elapsedSeconds,
  lastRunDurationSeconds,
  isRecording,
  isTranscribing,
  attachmentsCount,
  disabled,
  canSend,
  hasSystemPrompt,
  mcpEnabled,
  artifactsEnabled,
  deepResearchEnabled,
  isTTSEnabled,
  onOpenResults,
  availableModels = [],
  selectedModel,
  onModelChange,
  onOpenChatSettings,
  onOpenMcpSettings,
  onMcpToggle,
  onArtifactsToggle,
  onDeepResearchToggle,
  onTTSToggle,
  onAttachFile,
  onAttachImage,
  onStartRecording,
  onStopRecording,
  onStop,
  onSubmit,
  callModeEnabled,
  onCallModeToggle,
}: Props) {
  return (
    <div className="md:hidden flex items-center gap-2">
      <ToolBeltToolbarMobileMenu
        isLoading={isLoading}
        elapsedSeconds={elapsedSeconds}
        lastRunDurationSeconds={lastRunDurationSeconds}
        isRecording={isRecording}
        isTranscribing={isTranscribing}
        attachmentsCount={attachmentsCount}
        disabled={disabled}
        hasSystemPrompt={hasSystemPrompt}
        mcpEnabled={mcpEnabled}
        artifactsEnabled={artifactsEnabled}
        deepResearchEnabled={deepResearchEnabled}
        isTTSEnabled={isTTSEnabled}
        onOpenResults={onOpenResults}
        onOpenChatSettings={onOpenChatSettings}
        onOpenMcpSettings={onOpenMcpSettings}
        onMcpToggle={onMcpToggle}
        onArtifactsToggle={onArtifactsToggle}
        onDeepResearchToggle={onDeepResearchToggle}
        onTTSToggle={onTTSToggle}
        onAttachFile={onAttachFile}
        onAttachImage={onAttachImage}
        onStartRecording={onStartRecording}
        onStopRecording={onStopRecording}
        callModeEnabled={callModeEnabled}
        onCallModeToggle={onCallModeToggle}
      />

      {onOpenResults && (
        <button
          onClick={onOpenResults}
          disabled={disabled}
          className="h-10 w-10 flex items-center justify-center rounded-full border border-(--border) bg-(--border) text-(--dim) hover:bg-(--border) transition-colors disabled:opacity-50"
          title="Open results"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      )}

      {availableModels.length > 0 && onModelChange && (
        <div className="flex-1 min-w-0">
          <select
            value={selectedModel || ""}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={disabled || isLoading}
            className="h-10 w-full px-3 font-mono text-[12px] bg-(--border) border border-(--border) rounded-full text-(--dim) focus:outline-none disabled:opacity-50 truncate appearance-none cursor-pointer hover:bg-(--border) transition-colors"
            title={selectedModel || "Select model"}
            >
            {availableModels.map((model, idx) => (
              <option key={`${model.id}-${idx}`} value={model.id}>
                {buildDisplayModelLabel(model.id, model.provider)}
              </option>
            ))}
          </select>
        </div>
      )}

      {isLoading ? (
        <button
          onClick={onStop}
          className="h-10 w-10 flex items-center justify-center rounded-full bg-(--err) text-white transition-colors:ease-in:200ms shrink-0"
          title="Stop"
        >
          <Square className="h-4 w-4 fill-current" />
        </button>
      ) : (
        <button
          onClick={onSubmit}
          disabled={!canSend}
          className={`h-10 w-10 flex items-center justify-center rounded-full transition-colors:ease-in:200ms shrink-0 ${
            canSend
              ? "bg-(--fg) text-(--bg)"
              : "bg-(--border) border border-(--border) text-(--dim)/40 cursor-not-allowed"
          }`}
          title="Send"
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
