// CRITICAL
"use client";

import type { ComponentType } from "react";
import {
  Paperclip,
  Image as ImageIcon,
  Globe,
  Code,
  Brain,
  Settings,
  SlidersHorizontal,
  Clock,
  Loader2,
  Volume2,
  VolumeX,
  Plus,
  PanelRightOpen,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
} from "lucide-react";
import { ToolDropdown, DropdownItem } from "../tool-dropdown";

function SpinningLoaderIcon({ className }: { className?: string }) {
  return <Loader2 className={`${className ?? ""} animate-spin`} />;
}

type Props = {
  isLoading?: boolean;
  elapsedSeconds?: number;
  lastRunDurationSeconds?: number | null;
  isRecording: boolean;
  isTranscribing: boolean;
  attachmentsCount: number;
  disabled?: boolean;
  hasSystemPrompt?: boolean;
  mcpEnabled?: boolean;
  artifactsEnabled?: boolean;
  deepResearchEnabled?: boolean;
  isTTSEnabled?: boolean;
  onOpenResults?: () => void;
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
  callModeEnabled?: boolean;
  onCallModeToggle?: () => void;
};

export function ToolBeltToolbarMobileMenu({
  isLoading,
  elapsedSeconds,
  lastRunDurationSeconds,
  isRecording,
  isTranscribing,
  attachmentsCount,
  disabled,
  hasSystemPrompt,
  mcpEnabled,
  artifactsEnabled,
  deepResearchEnabled,
  isTTSEnabled,
  onOpenResults,
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
  callModeEnabled,
  onCallModeToggle,
}: Props) {
  const hasActiveTools = Boolean(mcpEnabled || artifactsEnabled || deepResearchEnabled);
  const hasMobileMenuActive = Boolean(
    attachmentsCount > 0 ||
      hasActiveTools ||
      hasSystemPrompt ||
      isRecording ||
      isTranscribing ||
      isTTSEnabled ||
      callModeEnabled,
  );

  const showAttachmentSection = Boolean(onAttachFile || onAttachImage);
  const showVoiceSection = Boolean(onStartRecording || onStopRecording || onTTSToggle);
  const showToolsSection = Boolean(
    onMcpToggle || onArtifactsToggle || onDeepResearchToggle || onOpenMcpSettings,
  );
  const showSettingsSection = Boolean(onOpenChatSettings);

  const voiceLabel = isTranscribing ? "Transcribing..." : isRecording ? "Stop recording" : "Voice input";
  const VoiceIcon = isTranscribing ? Loader2 : isRecording ? MicOff : Mic;
  const onVoiceClick = isRecording ? onStopRecording : onStartRecording;
  const VoiceIconComponent: ComponentType<{ className?: string }> = isTranscribing
    ? SpinningLoaderIcon
    : VoiceIcon;

  const hasRunTime = typeof elapsedSeconds === "number" && elapsedSeconds >= 0;
  const hasLastRun = typeof lastRunDurationSeconds === "number" && lastRunDurationSeconds > 0;
  const showRunChip = Boolean((isLoading && hasRunTime) || (!isLoading && hasLastRun));
  const runChipLabelSeconds = isLoading ? elapsedSeconds ?? 0 : lastRunDurationSeconds ?? 0;
  const runChipLabel = `${Math.floor(runChipLabelSeconds / 60)}:${(runChipLabelSeconds % 60).toString().padStart(2, "0")}`;

  return (
    <ToolDropdown
      icon={Plus}
      label="More actions"
      isActive={hasMobileMenuActive}
      disabled={disabled}
      showChevron={false}
      buttonVariant="circle"
    >
      {showRunChip && (
        <>
          <DropdownItem icon={Clock} label={`Runtime: ${runChipLabel}`} disabled />
          <div className="h-px bg-(--border) my-1" />
        </>
      )}

      {onOpenResults && (
        <>
          <DropdownItem icon={PanelRightOpen} label="Results" onClick={onOpenResults} disabled={disabled} closeOnClick />
          <div className="h-px bg-(--border) my-1" />
        </>
      )}

      {showAttachmentSection && (
        <>
          {onAttachFile && (
            <DropdownItem icon={Paperclip} label="Attach file" onClick={onAttachFile} disabled={disabled} closeOnClick />
          )}
          {onAttachImage && (
            <DropdownItem icon={ImageIcon} label="Attach image" onClick={onAttachImage} disabled={disabled} closeOnClick />
          )}
          {(showVoiceSection || showToolsSection || showSettingsSection) && (
            <div className="h-px bg-(--border) my-1" />
          )}
        </>
      )}

      {showVoiceSection && (
        <>
          {(onStartRecording || onStopRecording) && (
            <DropdownItem
              icon={VoiceIconComponent}
              label={voiceLabel}
              isActive={isRecording || isTranscribing}
              onClick={onVoiceClick}
              disabled={disabled || isTranscribing}
              closeOnClick
            />
          )}
          {onTTSToggle && (
            <DropdownItem
              icon={isTTSEnabled ? Volume2 : VolumeX}
              label={isTTSEnabled ? "Disable TTS" : "Enable TTS"}
              isActive={isTTSEnabled}
              onClick={onTTSToggle}
              disabled={disabled}
              closeOnClick
            />
          )}
          {onCallModeToggle && (
            <DropdownItem
              icon={callModeEnabled ? PhoneOff : Phone}
              label={callModeEnabled ? "End call mode" : "Call mode (hands-free)"}
              isActive={callModeEnabled}
              onClick={onCallModeToggle}
              disabled={disabled || isTranscribing}
              closeOnClick
            />
          )}
          {(showToolsSection || showSettingsSection) && <div className="h-px bg-(--border) my-1" />}
        </>
      )}

      {showToolsSection && (
        <>
          {onMcpToggle && (
            <DropdownItem icon={Globe} label="Web search & tools" isActive={mcpEnabled} onClick={onMcpToggle} disabled={disabled} closeOnClick />
          )}
          {onArtifactsToggle && (
            <DropdownItem icon={Code} label="Code preview" isActive={artifactsEnabled} onClick={onArtifactsToggle} disabled={disabled} closeOnClick />
          )}
          {onDeepResearchToggle && (
            <DropdownItem icon={Brain} label="Deep Research" isActive={deepResearchEnabled} onClick={onDeepResearchToggle} disabled={disabled} closeOnClick />
          )}
          {onOpenMcpSettings && (
            <>
              <div className="h-px bg-(--border) my-1" />
              <DropdownItem icon={Settings} label="MCP servers" onClick={onOpenMcpSettings} disabled={disabled} closeOnClick />
            </>
          )}
          {showSettingsSection && <div className="h-px bg-(--border) my-1" />}
        </>
      )}

      {showSettingsSection && onOpenChatSettings && (
        <DropdownItem
          icon={SlidersHorizontal}
          label={hasSystemPrompt ? "System prompt (active)" : "System prompt"}
          isActive={hasSystemPrompt}
          onClick={onOpenChatSettings}
          disabled={disabled}
          closeOnClick
        />
      )}
    </ToolDropdown>
  );
}

