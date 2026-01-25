// CRITICAL
"use client";

import { useRef, useEffect, type ChangeEvent, type KeyboardEvent } from "react";
import { AttachmentsPreview } from "./attachments-preview";
import { RecordingIndicator } from "./recording-indicator";
import { TranscriptionStatus } from "./transcription-status";
import { ToolBeltToolbar } from "./tool-belt-toolbar";
import type { Attachment, ModelOption } from "../../types";
import { useAppStore } from "@/store";

interface ToolBeltProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (attachments?: Attachment[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  onStop?: () => void;
  selectedModel?: string;
  availableModels?: ModelOption[];
  onModelChange?: (modelId: string) => void;
  mcpEnabled?: boolean;
  onMcpToggle?: () => void;
  artifactsEnabled?: boolean;
  onArtifactsToggle?: () => void;
  onOpenMcpSettings?: () => void;
  onOpenChatSettings?: () => void;
  hasSystemPrompt?: boolean;
  deepResearchEnabled?: boolean;
  onDeepResearchToggle?: () => void;
  elapsedSeconds?: number;
  queuedContext?: string;
  onQueuedContextChange?: (value: string) => void;
}

export function ToolBelt({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder = "Message...",
  onStop,
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
  elapsedSeconds = 0,
  queuedContext = "",
  onQueuedContextChange,
}: ToolBeltProps) {
  const isDisabled = false;
  const attachments = useAppStore((state) => state.attachments);
  const setAttachments = useAppStore((state) => state.setAttachments);
  const updateAttachments = useAppStore((state) => state.updateAttachments);
  const isRecording = useAppStore((state) => state.isRecording);
  const setIsRecording = useAppStore((state) => state.setIsRecording);
  const isTranscribing = useAppStore((state) => state.isTranscribing);
  const setIsTranscribing = useAppStore((state) => state.setIsTranscribing);
  const transcriptionError = useAppStore((state) => state.transcriptionError);
  const setTranscriptionError = useAppStore((state) => state.setTranscriptionError);
  const recordingDuration = useAppStore((state) => state.recordingDuration);
  const setRecordingDuration = useAppStore((state) => state.setRecordingDuration);
  const isTTSEnabled = useAppStore((state) => state.isTTSEnabled);
  const setIsTTSEnabled = useAppStore((state) => state.setIsTTSEnabled);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      const minHeight = Number.parseFloat(
        window.getComputedStyle(textareaRef.current).minHeight,
      );
      const baseHeight = Number.isFinite(minHeight) && minHeight > 0 ? minHeight : 44;
      const shouldCap = window.innerWidth >= 768;
      const newHeight = shouldCap
        ? Math.min(Math.max(scrollHeight, baseHeight), 200)
        : Math.max(scrollHeight, baseHeight);
      textareaRef.current.style.height = newHeight + "px";
      textareaRef.current.style.overflowY =
        shouldCap && scrollHeight > 200 ? "auto" : "hidden";
    }
  }, [value, isLoading, queuedContext]);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>, type: "file" | "image") => {
    const files = Array.from(e.target.files || []);
    const newAttachments: Attachment[] = [];

    for (const file of files) {
      const attachment: Attachment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: type === "image" ? "image" : "file",
        name: file.name,
        size: file.size,
        url: type === "image" ? URL.createObjectURL(file) : undefined,
        file,
      };

      if (type === "image") {
        try {
          attachment.base64 = await fileToBase64(file);
        } catch (err) {
          console.error("Failed to convert image to base64:", err);
        }
      }

      newAttachments.push(attachment);
    }

    updateAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = "";
  };

  const removeAttachment = (id: string) => {
    updateAttachments((prev) => {
      const attachment = prev.find((a) => a.id === id);
      if (attachment?.url) {
        URL.revokeObjectURL(attachment.url);
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  const transcribeAudio = async (audioBlob: Blob): Promise<string | null> => {
    try {
      setIsTranscribing(true);
      setTranscriptionError(null);

      const formData = new FormData();
      formData.append("file", audioBlob, "recording.webm");
      formData.append("model", "whisper-1");

      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.details || errorData.error || `Transcription failed (${response.status})`,
        );
      }

      const data = await response.json();
      if (!data.text) {
        throw new Error("No transcription returned");
      }
      return data.text;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Transcription failed";
      console.error("Transcription error:", err);
      setTranscriptionError(errorMessage);
      setTimeout(() => setTranscriptionError(null), 5000);
      return null;
    } finally {
      setIsTranscribing(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());

        const transcript = await transcribeAudio(audioBlob);
        if (transcript) {
          onChange(value ? `${value} ${transcript}` : transcript);
          textareaRef.current?.focus();
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(useAppStore.getState().recordingDuration + 1);
      }, 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSubmit = () => {
    if (isLoading) return;
    if (!value.trim() && attachments.length === 0) return;
    onSubmit(attachments.length > 0 ? [...attachments] : undefined);
    setAttachments([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = value.trim() || attachments.length > 0;

  return (
    <div className="px-3 md:px-3 pb-0 md:pb-0 bg-(--background)">
      <div className="w-full max-w-none md:max-w-4xl md:mx-auto px-0 md:px-0">
        <AttachmentsPreview
          attachments={attachments}
          onRemove={removeAttachment}
          formatFileSize={formatFileSize}
        />

        {isRecording && (
          <RecordingIndicator
            duration={recordingDuration}
            onStop={stopRecording}
            formatDuration={formatDuration}
          />
        )}

        <TranscriptionStatus
          isTranscribing={isTranscribing}
          error={transcriptionError}
          onDismissError={() => setTranscriptionError(null)}
        />

        <div
          className={`relative flex flex-col border rounded-2xl md:rounded-xl bg-(--card) shadow-sm ${
            isLoading ? "border-blue-500/30" : "border-(--border)"
          }`}
        >
          <textarea
            ref={textareaRef}
            value={isLoading && onQueuedContextChange ? queuedContext : value}
            onChange={(e) =>
              isLoading && onQueuedContextChange
                ? onQueuedContextChange(e.target.value)
                : onChange(e.target.value)
            }
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
            className="w-full px-3 py-2 md:px-4 md:py-3 bg-transparent text-[15px] md:text-sm resize-none focus:outline-none disabled:opacity-50 placeholder:text-[#9a9590] overflow-y-hidden min-h-[52px] md:min-h-[44px]"
            style={{ fontSize: "16px", lineHeight: "1.5" }}
          />

          <input
            ref={fileInputRef}
            type="file"
            onChange={(e) => handleFileSelect(e, "file")}
            className="hidden"
            multiple
            accept=".txt,.pdf,.doc,.docx,.md,.json,.csv"
          />
          <input
            ref={imageInputRef}
            type="file"
            onChange={(e) => handleFileSelect(e, "image")}
            className="hidden"
            multiple
            accept="image/*"
          />

          <ToolBeltToolbar
            isLoading={isLoading}
            elapsedSeconds={elapsedSeconds}
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
            availableModels={availableModels}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            onOpenChatSettings={onOpenChatSettings}
            onOpenMcpSettings={onOpenMcpSettings}
            onMcpToggle={onMcpToggle}
            onArtifactsToggle={onArtifactsToggle}
            onDeepResearchToggle={onDeepResearchToggle}
            onTTSToggle={() => setIsTTSEnabled(!isTTSEnabled)}
            onAttachFile={() => fileInputRef.current?.click()}
            onAttachImage={() => imageInputRef.current?.click()}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            onStop={onStop}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
    </div>
  );
}
