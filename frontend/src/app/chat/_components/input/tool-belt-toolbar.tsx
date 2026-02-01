// CRITICAL
"use client";

import { Plus, Mic, MicOff, Square, Loader2, ArrowUp } from "lucide-react";
import { useState, useRef, useEffect } from "react";
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
  agentMode?: boolean;
  onAgentModeToggle?: () => void;
}

export function ToolBeltToolbar({
  isLoading,
  isRecording,
  isTranscribing,
  attachmentsCount,
  disabled,
  canSend,
  mcpEnabled,
  hasSystemPrompt,
  availableModels = [],
  selectedModel,
  onModelChange,
  onMcpToggle,
  onAttachFile,
  onAttachImage,
  onOpenChatSettings,
  onStartRecording,
  onStopRecording,
  onStop,
  onSubmit,
  agentMode,
  onAgentModeToggle,
}: ToolBeltToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const hasActiveFeatures = mcpEnabled || agentMode || hasSystemPrompt || attachmentsCount > 0;

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5">
      {/* Plus menu */}
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          disabled={disabled}
          className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
            hasActiveFeatures ? "bg-[#333] text-green-400" : "bg-[#252525] text-[#777] hover:text-white"
          }`}
        >
          <Plus className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-52 bg-[#1c1c1c] border border-[#333] rounded-xl shadow-2xl py-1.5 z-50">
            <button onClick={() => { onAttachImage?.(); setMenuOpen(false); }} className="w-full px-4 py-2.5 text-left text-sm text-[#ddd] hover:bg-[#2a2a2a] flex items-center gap-3">
              <span>📷</span> Photo / Video
            </button>
            <button onClick={() => { onAttachFile?.(); setMenuOpen(false); }} className="w-full px-4 py-2.5 text-left text-sm text-[#ddd] hover:bg-[#2a2a2a] flex items-center gap-3">
              <span>📎</span> File
              {attachmentsCount > 0 && <span className="ml-auto text-xs text-blue-400">{attachmentsCount}</span>}
            </button>
            <div className="h-px bg-[#333] my-1.5" />
            <button onClick={() => { onMcpToggle?.(); }} className="w-full px-4 py-2.5 text-left text-sm text-[#ddd] hover:bg-[#2a2a2a] flex items-center gap-3">
              <span>🔧</span> Web Tools
              {mcpEnabled && <span className="ml-auto w-2 h-2 rounded-full bg-green-500" />}
            </button>
            <button onClick={() => { onAgentModeToggle?.(); }} className="w-full px-4 py-2.5 text-left text-sm text-[#ddd] hover:bg-[#2a2a2a] flex items-center gap-3">
              <span>🤖</span> Agent Mode
              {agentMode && <span className="ml-auto w-2 h-2 rounded-full bg-violet-500" />}
            </button>
            <div className="h-px bg-[#333] my-1.5" />
            <button onClick={() => { onOpenChatSettings?.(); setMenuOpen(false); }} className="w-full px-4 py-2.5 text-left text-sm text-[#ddd] hover:bg-[#2a2a2a] flex items-center gap-3">
              <span>⚙️</span> Settings
              {hasSystemPrompt && <span className="ml-auto w-2 h-2 rounded-full bg-yellow-500" />}
            </button>
          </div>
        )}
      </div>

      {/* Voice */}
      <button
        onClick={isRecording ? onStopRecording : onStartRecording}
        disabled={disabled || isTranscribing}
        className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${
          isRecording ? "bg-red-500/20 text-red-400" : isTranscribing ? "text-blue-400" : "text-[#777] hover:text-white"
        }`}
      >
        {isTranscribing ? <Loader2 className="h-4 w-4 animate-spin" /> : isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>

      {/* Model selector */}
      {availableModels.length > 0 && onModelChange && (
        <select
          value={selectedModel || ""}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={disabled || isLoading}
          title={selectedModel || "Select model"}
          className="flex-1 min-w-0 max-w-[120px] px-2 py-1 text-xs font-medium bg-[#252525] border border-[#333] rounded-lg text-[#999] focus:outline-none truncate"
        >
          {availableModels.map((model, idx) => (
            <option key={`${model.id}-${idx}`} value={model.id}>
              {model.id.split("/").pop()?.slice(0, 12) || model.id}
            </option>
          ))}
        </select>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Send/Stop */}
      {isLoading ? (
        <button onClick={onStop} className="w-8 h-8 flex items-center justify-center rounded-full bg-[#e8e4dd] text-black">
          <Square className="h-3.5 w-3.5 fill-current" />
        </button>
      ) : (
        <button
          onClick={onSubmit}
          disabled={!canSend}
          className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${
            canSend ? "bg-[#e8e4dd] text-black" : "bg-[#333] text-[#555]"
          }`}
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
