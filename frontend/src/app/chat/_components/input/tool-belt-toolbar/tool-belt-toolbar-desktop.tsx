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
  Phone,
  PhoneOff,
} from "lucide-react";
import { ToolDropdown, DropdownItem } from "../tool-dropdown";
import { buildDisplayModelLabel, type ModelOption } from "../../../types";

type Props = {
  isLoading?: boolean;
  elapsedSeconds?: number;
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

export function ToolBeltToolbarDesktop({
  isLoading,
  elapsedSeconds,
  thinkingSnippet,
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
  callModeEnabled,
  onCallModeToggle,
}: Props) {
  const hasActiveTools = Boolean(mcpEnabled || artifactsEnabled || deepResearchEnabled);

  return (
    <div className="hidden md:flex items-center justify-between">
      <div className="flex items-center gap-1 min-w-0">
        {isLoading && elapsedSeconds !== undefined && (
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg border border-blue-500/30 min-w-0">
            <Clock className="h-3 w-3 text-blue-400 animate-pulse shrink-0" />
            <span className="text-xs font-mono font-medium text-blue-400 shrink-0">
              {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, "0")}
            </span>
            <span className="text-(--border)">·</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <Wrench className="h-3 w-3 text-blue-400/70 shrink-0" />
              <span className="text-xs text-blue-200/80 truncate">
                {thinkingSnippet?.trim() ? thinkingSnippet.trim() : "Working..."}
              </span>
            </div>
          </div>
        )}

        <ToolDropdown
          icon={Paperclip}
          label="Attach media"
          isActive={attachmentsCount > 0}
          disabled={disabled}
        >
          <DropdownItem icon={Paperclip} label="Attach file" onClick={onAttachFile} disabled={disabled} />
          <DropdownItem icon={ImageIcon} label="Attach image" onClick={onAttachImage} disabled={disabled} />
        </ToolDropdown>

        <button
          onClick={isRecording ? onStopRecording : onStartRecording}
          disabled={disabled || isTranscribing}
          className={`flex items-center justify-center p-2 rounded-lg transition-all:ease-in:200ms disabled:opacity-50 ${
            isRecording
              ? "bg-(--err) text-(--err)"
              : isTranscribing
                ? "bg-(--hl1) text-(--hl1)"
                : "hover:bg-(--accent) text-(--dim)"
          }`}
          title={isTranscribing ? "Transcribing..." : isRecording ? "Stop recording" : "Voice input"}
        >
          {isTranscribing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isRecording ? (
            <MicOff className="h-3.5 w-3.5" />
          ) : (
            <Mic className="h-3.5 w-3.5" />
          )}
        </button>

        {onTTSToggle && (
          <button
            onClick={onTTSToggle}
            disabled={disabled}
            className={`flex items-center justify-center p-2 rounded-lg transition-all:ease-in:200ms disabled:opacity-50 ${
              isTTSEnabled ? "bg-(--hl2) text-(--hl2)" : "hover:bg-(--accent) text-(--dim)"
            }`}
            title={isTTSEnabled ? "Disable TTS" : "Enable TTS"}
          >
            {isTTSEnabled ? (
              <Volume2 className="h-3.5 w-3.5" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {onCallModeToggle && (
          <button
            onClick={onCallModeToggle}
            disabled={disabled || isTranscribing}
            className={`flex items-center justify-center p-2 rounded-lg transition-all:ease-in:200ms disabled:opacity-50 ${
              callModeEnabled
                ? "bg-green-500/20 text-green-400 ring-1 ring-green-500/40"
                : "hover:bg-(--accent) text-(--dim)"
            }`}
            title={callModeEnabled ? "End call mode" : "Start call mode (hands-free)"}
          >
            {callModeEnabled ? (
              <PhoneOff className="h-3.5 w-3.5" />
            ) : (
              <Phone className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        <ToolDropdown icon={Wrench} label="Tools" isActive={hasActiveTools} disabled={disabled}>
          <DropdownItem icon={Globe} label="Web search & tools" isActive={mcpEnabled} onClick={onMcpToggle} disabled={disabled} />
          {onArtifactsToggle && (
            <DropdownItem icon={Code} label="Code preview" isActive={artifactsEnabled} onClick={onArtifactsToggle} disabled={disabled} />
          )}
          {onDeepResearchToggle && (
            <DropdownItem icon={Brain} label="Deep Research" isActive={deepResearchEnabled} onClick={onDeepResearchToggle} disabled={disabled} />
          )}
          {onOpenMcpSettings && (
            <>
              <div className="h-px bg-(--border) my-1" />
              <DropdownItem icon={Settings} label="MCP servers" onClick={onOpenMcpSettings} disabled={disabled} />
            </>
          )}
        </ToolDropdown>

        {onOpenChatSettings && (
          <button
            onClick={onOpenChatSettings}
            disabled={disabled}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition-all:ease-in:200ms disabled:opacity-50 ${
              hasSystemPrompt
                ? "bg-(--surface) text-(--fg) border border-(--border)"
                : "hover:bg-(--accent) text-(--dim)"
            }`}
            title={hasSystemPrompt ? "System prompt (active)" : "System prompt"}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {availableModels.length > 0 && onModelChange && (
            <select
            value={selectedModel || ""}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={disabled || isLoading}
            className="max-w-[180px] px-2 py-1 font-sans font-medium text-xs bg-transparent border border-(--border) rounded-lg text-(--dim) focus:outline-none disabled:opacity-50 truncate appearance-none cursor-pointer hover:border-(--border) transition-colors:ease-in:200ms"
            title={selectedModel || "Select model"}
            >
            {availableModels.map((model, idx) => (
              <option key={`${model.id}-${idx}`} value={model.id}>
                {buildDisplayModelLabel(model.id, model.provider)}
              </option>
            ))}
            </select>
        )}

        {isLoading ? (
          <button
            onClick={onStop}
            className="h-8 w-8 flex items-center justify-center rounded-full bg-(--err) text-white transition-colors:ease-in:200ms shrink-0"
            title="Stop"
          >
            <Square className="h-3 w-3 fill-current" />
          </button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={!canSend}
            className={`h-8 w-8 flex items-center justify-center rounded-full transition-colors:ease-in:200ms shrink-0 ${
              canSend ? "bg-(--fg) text-(--bg)" : "bg-(--accent) text-(--dim)/50 cursor-not-allowed"
            }`}
            title="Send"
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}
