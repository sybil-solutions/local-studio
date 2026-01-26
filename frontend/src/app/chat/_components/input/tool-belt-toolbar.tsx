// CRITICAL
"use client";

import {
  Paperclip,
  Image as ImageIcon,
  Mic,
  MicOff,
  Square,
  Globe,
  Code,
  Brain,
  Settings,
  SlidersHorizontal,
  Clock,
  Loader2,
  Wrench,
  ArrowUp,
  Volume2,
  VolumeX,
} from "lucide-react";
import { ToolDropdown, DropdownItem } from "./tool-dropdown";
import type { ModelOption } from "../../types";

interface ToolBeltToolbarProps {
  isLoading?: boolean;
  elapsedSeconds?: number;
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
}

export function ToolBeltToolbar({
  isLoading,
  elapsedSeconds,
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
}: ToolBeltToolbarProps) {
  const hasActiveTools = Boolean(mcpEnabled || artifactsEnabled || deepResearchEnabled);

  return (
    <div className="flex items-center justify-between px-2 py-1.5 border-t border-(--border)">
      <div className="flex items-center gap-1 min-w-0">
        {isLoading && elapsedSeconds !== undefined && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <Clock className="h-3.5 w-3.5 text-blue-400 animate-pulse" />
            <span className="text-xs font-mono text-blue-400">
              {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, "0")}
            </span>
          </div>
        )}

        <ToolDropdown
          icon={Paperclip}
          label="Attach media"
          isActive={attachmentsCount > 0}
          disabled={disabled}
        >
          <DropdownItem
            icon={Paperclip}
            label="Attach file"
            onClick={onAttachFile}
            disabled={disabled}
          />
          <DropdownItem
            icon={ImageIcon}
            label="Attach image"
            onClick={onAttachImage}
            disabled={disabled}
          />
        </ToolDropdown>

        <button
          onClick={isRecording ? onStopRecording : onStartRecording}
          disabled={disabled || isTranscribing}
          className={`flex items-center justify-center p-2 rounded-lg transition-all disabled:opacity-50 ${
            isRecording
              ? "bg-(--error)/20 text-(--error)"
              : isTranscribing
                ? "bg-(--link)/20 text-(--link)"
                : "hover:bg-(--accent) text-[#9a9590]"
          }`}
          title={
            isTranscribing ? "Transcribing..." : isRecording ? "Stop recording" : "Voice input"
          }
        >
          {isTranscribing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isRecording ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </button>

        {onTTSToggle && (
          <button
            onClick={onTTSToggle}
            disabled={disabled}
            className={`hidden md:flex items-center justify-center p-2 rounded-lg transition-all disabled:opacity-50 ${
              isTTSEnabled
                ? "bg-(--success)/20 text-(--success)"
                : "hover:bg-(--accent) text-[#9a9590]"
            }`}
            title={isTTSEnabled ? "Disable TTS" : "Enable TTS"}
          >
            {isTTSEnabled ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </button>
        )}

        <ToolDropdown icon={Wrench} label="Tools" isActive={hasActiveTools} disabled={disabled}>
          <DropdownItem
            icon={Globe}
            label="Web search & tools"
            isActive={mcpEnabled}
            onClick={onMcpToggle}
            disabled={disabled}
          />
          {onArtifactsToggle && (
            <DropdownItem
              icon={Code}
              label="Code preview"
              isActive={artifactsEnabled}
              onClick={onArtifactsToggle}
              disabled={disabled}
            />
          )}
          {onDeepResearchToggle && (
            <DropdownItem
              icon={Brain}
              label="Deep Research"
              isActive={deepResearchEnabled}
              onClick={onDeepResearchToggle}
              disabled={disabled}
            />
          )}
          {onOpenMcpSettings && (
            <>
              <div className="h-px bg-(--border) my-1" />
              <DropdownItem
                icon={Settings}
                label="MCP servers"
                onClick={onOpenMcpSettings}
                disabled={disabled}
              />
            </>
          )}
        </ToolDropdown>

        {onOpenChatSettings && (
          <button
            onClick={onOpenChatSettings}
            disabled={disabled}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition-all disabled:opacity-50 ${
              hasSystemPrompt
                ? "bg-(--card-hover) text-[#e8e4dd] border border-(--border)/50"
                : "hover:bg-(--accent) text-[#9a9590]"
            }`}
            title={hasSystemPrompt ? "System prompt (active)" : "System prompt"}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {availableModels.length > 0 && onModelChange && (
          <select
            value={selectedModel || ""}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={disabled || isLoading}
            className="max-w-[140px] md:max-w-[180px] px-2 py-1 text-xs bg-transparent border border-(--border) rounded-lg text-[#9a9590] focus:outline-none disabled:opacity-50 truncate appearance-none cursor-pointer hover:border-[#4a4745] transition-colors"
            title={selectedModel || "Select model"}
          >
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
        )}

        {isLoading ? (
          <button
            onClick={onStop}
            className="h-8 w-8 flex items-center justify-center rounded-full bg-(--error) text-white hover:bg-(--error)/90 transition-colors flex-shrink-0"
            title="Stop"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={!canSend}
            className={`h-8 w-8 flex items-center justify-center rounded-full transition-colors flex-shrink-0 ${
              canSend
                ? "bg-[#e8e4dd] text-[#1a1918] hover:bg-[#d4d0c9]"
                : "bg-(--accent) text-[#9a9590]/50 cursor-not-allowed"
            }`}
            title="Send"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}
