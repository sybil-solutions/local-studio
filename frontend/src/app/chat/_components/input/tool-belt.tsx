// CRITICAL
"use client";

import { useCallback, useRef, type KeyboardEvent } from "react";
import { AttachmentsPreview } from "./attachments-preview";
import { RecordingIndicator } from "./recording-indicator";
import { TranscriptionStatus } from "./transcription-status";
import { CallModeIndicator } from "./call-mode-indicator";
import { useAppStore } from "@/store";
import { useShallow } from "zustand/react/shallow";
import { ToolBeltToolbarContainer } from "./tool-belt/tool-belt-toolbar-container";
import { useComposerHeightCssVar } from "./tool-belt/use-composer-height-css-var";
import { useAutosizeTextarea } from "./tool-belt/use-autosize-textarea";
import { useAttachmentInputs } from "./tool-belt/use-attachment-inputs";
import { useAudioRecording } from "./tool-belt/use-audio-recording";
import { clearAttachmentUrls, formatDuration, formatFileSize } from "./tool-belt/utils";
import type { ToolBeltProps } from "./tool-belt/types";

export function ToolBelt({
  onSubmit,
  isLoading,
  thinkingSnippet,
  placeholder = "Message...",
  onStop,
  onOpenResults,
  selectedModel,
  availableModels = [],
  onModelChange,
  mcpEnabled = false,
  onMcpToggle,
  artifactsEnabled = false,
  onArtifactsToggle,
  onOpenMcpSettings,
  onOpenChatSettings,
  hasSystemPrompt = false,
  deepResearchEnabled = false,
  onDeepResearchToggle,
  planDrawer,
  callModeEnabled = false,
  onCallModeToggle,
}: ToolBeltProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const isDisabled = false;
  const {
    value,
    setInput,
    queuedContext,
    setQueuedContext,
    attachments,
    setAttachments,
    updateAttachments,
    isRecording,
    setIsRecording,
    isTranscribing,
    setIsTranscribing,
    transcriptionError,
    setTranscriptionError,
    recordingDuration,
    setRecordingDuration,
    isTTSEnabled,
    setIsTTSEnabled,
    callModeSpeakingMessageId,
  } = useAppStore(
    useShallow((state) => ({
      value: state.input,
      setInput: state.setInput,
      queuedContext: state.queuedContext,
      setQueuedContext: state.setQueuedContext,
      attachments: state.attachments,
      setAttachments: state.setAttachments,
      updateAttachments: state.updateAttachments,
      isRecording: state.isRecording,
      setIsRecording: state.setIsRecording,
      isTranscribing: state.isTranscribing,
      setIsTranscribing: state.setIsTranscribing,
      transcriptionError: state.transcriptionError,
      setTranscriptionError: state.setTranscriptionError,
      recordingDuration: state.recordingDuration,
      setRecordingDuration: state.setRecordingDuration,
      isTTSEnabled: state.isTTSEnabled,
      setIsTTSEnabled: state.setIsTTSEnabled,
      callModeSpeakingMessageId: state.callModeSpeakingMessageId,
    })),
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep the transcript from disappearing under the fixed mobile composer by exposing its height as a CSS var.
  useComposerHeightCssVar(rootRef);
  useAutosizeTextarea({ textareaRef, value, isLoading, queuedContext });

  const {
    fileInputRef,
    imageInputRef,
    handleFileInputChange,
    handleImageInputChange,
    removeAttachment,
    handleAttachFile,
    handleAttachImage,
  } = useAttachmentInputs({ updateAttachments });

  const { startRecording, stopRecording } = useAudioRecording({
    textareaRef,
    isRecording,
    setIsRecording,
    setRecordingDuration,
    setIsTranscribing,
    setTranscriptionError,
    setInput,
    getCurrentInput: () => useAppStore.getState().input,
    getRecordingDuration: () => useAppStore.getState().recordingDuration,
  });

  const handleTTSToggle = useCallback(() => {
    const current = useAppStore.getState().isTTSEnabled;
    setIsTTSEnabled(!current);
  }, [setIsTTSEnabled]);

  const handleDismissTranscriptionError = useCallback(() => {
    setTranscriptionError(null);
  }, [setTranscriptionError]);

  const handleTextChange = useCallback(
    (nextValue: string) => {
      if (isLoading) setQueuedContext(nextValue);
      else setInput(nextValue);
    },
    [isLoading, setInput, setQueuedContext],
  );

  const handleSubmit = useCallback(() => {
    if (isLoading) return;
    const state = useAppStore.getState();
    const inputValue = state.input;
    const currentAttachments = state.attachments;
    if (!inputValue.trim() && currentAttachments.length === 0) return;

    onSubmit(inputValue, currentAttachments.length > 0 ? [...currentAttachments] : undefined);

    clearAttachmentUrls(currentAttachments);
    setAttachments([]);
  }, [isLoading, onSubmit, setAttachments]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const canSend = value.trim() || attachments.length > 0;

  return (
    <div ref={rootRef} className="px-2 md:px-3 pb-0">
      <div className="w-full max-w-none md:max-w-4xl md:mx-auto px-0 md:px-0">
        <AttachmentsPreview
          attachments={attachments}
          onRemove={removeAttachment}
          formatFileSize={formatFileSize}
        />

        {isRecording && (
          <RecordingIndicator
            duration={recordingDuration}
            onStop={callModeEnabled ? (onCallModeToggle ?? stopRecording) : stopRecording}
            formatDuration={formatDuration}
          />
        )}

        {callModeEnabled && !isRecording && !isTranscribing && (
          <CallModeIndicator
            isSpeaking={callModeSpeakingMessageId !== null}
            onDisable={onCallModeToggle ?? (() => {})}
          />
        )}

        <TranscriptionStatus
          isTranscribing={isTranscribing}
          error={transcriptionError}
          onDismissError={handleDismissTranscriptionError}
        />

        <div
          className={`relative flex flex-col bg-(--surface) rounded-3xl border border-(--border) ${
            isLoading ? "ring-1 ring-blue-500/30" : ""
          }`}
          style={{
            boxShadow: "0 0 0 1px rgba(255,255,255,0.03), 0 8px 40px rgba(0,0,0,0.35)",
          }}
        >
          <div className="hidden md:block">{planDrawer}</div>
          <textarea
            ref={textareaRef}
            value={isLoading ? queuedContext : value}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isDisabled
                ? "No model running"
                : isLoading
                  ? "Type here to queue for next message..."
                  : placeholder
            }
            disabled={isDisabled}
            rows={1}
            className="w-full px-3 py-2.5 md:px-4 md:py-3 bg-transparent text-[15px] md:text-sm resize-none focus:outline-none disabled:opacity-50 placeholder:text-(--dim) overflow-y-hidden min-h-[44px] md:min-h-[44px]"
            style={{ fontSize: "16px", lineHeight: "1.5" }}
          />

          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileInputChange}
            className="hidden"
            multiple
            accept=".txt,.pdf,.doc,.docx,.md,.json,.csv"
          />
          <input
            ref={imageInputRef}
            type="file"
            onChange={handleImageInputChange}
            className="hidden"
            multiple
            accept="image/*"
          />

        <ToolBeltToolbarContainer
          isLoading={isLoading}
          thinkingSnippet={thinkingSnippet}
          isRecording={isRecording}
          isTranscribing={isTranscribing}
          attachmentsCount={attachments.length}
          disabled={isDisabled}
          canSend={canSend as boolean}
          hasSystemPrompt={hasSystemPrompt}
          mcpEnabled={mcpEnabled}
          artifactsEnabled={artifactsEnabled}
          deepResearchEnabled={deepResearchEnabled}
          isTTSEnabled={isTTSEnabled}
          onOpenResults={onOpenResults}
          availableModels={availableModels}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          onOpenChatSettings={onOpenChatSettings}
          onOpenMcpSettings={onOpenMcpSettings}
            onMcpToggle={onMcpToggle}
            onArtifactsToggle={onArtifactsToggle}
            onDeepResearchToggle={onDeepResearchToggle}
            onTTSToggle={handleTTSToggle}
            onAttachFile={handleAttachFile}
            onAttachImage={handleAttachImage}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            onStop={onStop}
            onSubmit={handleSubmit}
            callModeEnabled={callModeEnabled}
            onCallModeToggle={onCallModeToggle}
          />
        </div>
      </div>
    </div>
  );
}
