'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Paperclip,
  Image as ImageIcon,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
  FileText,
  Send,
  StopCircle,
  Globe,
  Code,
  Settings,
  SlidersHorizontal,
  Brain,
  Clock,
  Plus,
  Loader2,
} from 'lucide-react';

export interface Attachment {
  id: string;
  type: 'file' | 'image' | 'audio';
  name: string;
  size: number;
  url?: string;
  file?: File;
  base64?: string;
}

export interface MCPServer {
  name: string;
  enabled: boolean;
  icon?: string;
}

interface ToolBeltProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (attachments?: Attachment[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  modelName?: string;
  onStop?: () => void;
  // MCP & Artifacts toggles
  mcpEnabled?: boolean;
  onMcpToggle?: () => void;
  mcpServers?: MCPServer[];
  artifactsEnabled?: boolean;
  onArtifactsToggle?: () => void;
  onOpenMcpSettings?: () => void;
  // Chat settings
  onOpenChatSettings?: () => void;
  hasSystemPrompt?: boolean;
  // Deep Research
  deepResearchEnabled?: boolean;
  onDeepResearchToggle?: () => void;
  // Timer for streaming duration
  elapsedSeconds?: number;
  // Queued context - additional input while streaming
  queuedContext?: string;
  onQueuedContextChange?: (value: string) => void;
}

export function ToolBelt({
  value,
  onChange,
  onSubmit,
  disabled,
  isLoading,
  placeholder = 'Message...',
  modelName,
  onStop,
  mcpEnabled = false,
  onMcpToggle,
  mcpServers = [],
  artifactsEnabled = false,
  onArtifactsToggle,
  onOpenMcpSettings,
  onOpenChatSettings,
  hasSystemPrompt = false,
  deepResearchEnabled = false,
  onDeepResearchToggle,
  elapsedSeconds = 0,
  queuedContext = '',
  onQueuedContextChange,
}: ToolBeltProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [isTTSEnabled, setIsTTSEnabled] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [value]);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Extract base64 data after the comma (data:image/png;base64,...)
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, type: 'file' | 'image') => {
    const files = Array.from(e.target.files || []);
    const newAttachments: Attachment[] = [];

    for (const file of files) {
      const attachment: Attachment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: type === 'image' ? 'image' : 'file',
        name: file.name,
        size: file.size,
        url: type === 'image' ? URL.createObjectURL(file) : undefined,
        file,
      };

      // Convert images to base64 for API
      if (type === 'image') {
        try {
          attachment.base64 = await fileToBase64(file);
        } catch (err) {
          console.error('Failed to convert image to base64:', err);
        }
      }

      newAttachments.push(attachment);
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
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
      formData.append('file', audioBlob, 'recording.webm');
      formData.append('model', 'whisper-1');

      // Use local proxy which handles auth via server-side API_KEY env var
      const response = await fetch('/api/voice/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || `Transcription failed (${response.status})`);
      }

      const data = await response.json();
      if (!data.text) {
        throw new Error('No transcription returned');
      }
      return data.text;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Transcription failed';
      console.error('Transcription error:', err);
      setTranscriptionError(errorMessage);
      // Auto-clear error after 5 seconds
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
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((track) => track.stop());

        // Transcribe the audio and insert text
        const transcript = await transcribeAudio(audioBlob);
        if (transcript) {
          onChange(value ? `${value} ${transcript}` : transcript);
          // Focus the textarea after transcription
          textareaRef.current?.focus();
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to start recording:', err);
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
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSubmit = () => {
    if ((!value.trim() && attachments.length === 0) || disabled) return;
    onSubmit(attachments.length > 0 ? [...attachments] : undefined);
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="px-2 md:px-3 pb-[env(safe-area-inset-bottom)] md:pb-0 bg-[var(--background)]">
      <div className="max-w-4xl mx-auto w-full">
        {/* Attachments Preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="relative group flex items-center gap-2 px-3 py-2 bg-[var(--accent)] rounded-lg border border-[var(--border)]"
              >
                {attachment.type === 'image' ? (
                  <div className="flex items-center gap-2">
                    {attachment.url && (
                      <img
                        src={attachment.url}
                        alt={attachment.name}
                        className="w-10 h-10 rounded object-cover"
                      />
                    )}
                    <div className="text-xs">
                      <p className="font-medium truncate max-w-[100px]">{attachment.name}</p>
                      <p className="text-[#9a9590]">{formatFileSize(attachment.size)}</p>
                    </div>
                  </div>
                ) : attachment.type === 'audio' ? (
                  <div className="flex items-center gap-2">
                    <Mic className="h-4 w-4 text-[var(--success)]" />
                    <div className="text-xs">
                      <p className="font-medium">{attachment.name}</p>
                      <p className="text-[#9a9590]">{formatFileSize(attachment.size)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-[#9a9590]" />
                    <div className="text-xs">
                      <p className="font-medium truncate max-w-[100px]">{attachment.name}</p>
                      <p className="text-[#9a9590]">{formatFileSize(attachment.size)}</p>
                    </div>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(attachment.id)}
                  className="absolute -top-1 -right-1 p-0.5 rounded-full bg-[var(--error)] text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Recording Indicator */}
        {isRecording && (
          <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-[var(--error)] animate-pulse" />
            <span className="text-sm text-[var(--error)]">Recording</span>
            <span className="text-sm font-mono text-[#9a9590]">
              {formatDuration(recordingDuration)}
            </span>
            <button
              onClick={stopRecording}
              className="ml-auto flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-[var(--error)] text-white hover:opacity-90"
            >
              <StopCircle className="h-4 w-4" />
              Stop
            </button>
          </div>
        )}

        {/* Transcribing Indicator */}
        {isTranscribing && (
          <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-[var(--link)]/10 border border-[var(--link)]/20 rounded-lg">
            <Loader2 className="h-4 w-4 text-[var(--link)] animate-spin" />
            <span className="text-sm text-[var(--link)]">Transcribing audio...</span>
          </div>
        )}

        {/* Transcription Error */}
        {transcriptionError && (
          <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-[var(--error)]/10 border border-[var(--error)]/20 rounded-lg">
            <span className="text-sm text-[var(--error)]">{transcriptionError}</span>
            <button
              onClick={() => setTranscriptionError(null)}
              className="ml-auto p-1 hover:bg-[var(--error)]/20 rounded"
            >
              <X className="h-3.5 w-3.5 text-[var(--error)]" />
            </button>
          </div>
        )}

        {/* Main Input Area */}
        <div className={`relative flex flex-col border rounded-2xl md:rounded-xl bg-[var(--card)] shadow-sm ${isLoading ? 'border-blue-500/30' : 'border-[var(--border)]'}`}>
          {/* Textarea - switches to queued context while loading */}
          <textarea
            ref={textareaRef}
            value={isLoading && onQueuedContextChange ? queuedContext : value}
            onChange={(e) => isLoading && onQueuedContextChange ? onQueuedContextChange(e.target.value) : onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'No model running' : (isLoading ? 'Type here to queue for next message...' : placeholder)}
            disabled={disabled}
            rows={1}
            className="w-full px-4 py-3 md:py-3 bg-transparent text-base md:text-sm resize-none focus:outline-none disabled:opacity-50 placeholder:text-[#9a9590]"
            style={{ minHeight: '52px', maxHeight: '200px', fontSize: '16px' }}
          />

          {/* Tool Bar */}
          <div className="flex items-center justify-between px-2 py-1.5 border-t border-[var(--border)]">
            <div className="flex items-center gap-0.5">
              {/* Streaming Timer - shows in toolbar when loading */}
              {isLoading && elapsedSeconds !== undefined && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 mr-1">
                  <Clock className="h-3.5 w-3.5 text-blue-400 animate-pulse" />
                  <span className="text-xs font-mono text-blue-400">
                    {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
                  </span>
                </div>
              )}
              {/* File Upload */}
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => handleFileSelect(e, 'file')}
                className="hidden"
                multiple
                accept=".txt,.pdf,.doc,.docx,.md,.json,.csv"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                className="p-2 md:p-1.5 rounded hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
                title="Attach file"
              >
                <Paperclip className="h-4 w-4 md:h-3.5 md:w-3.5 text-[#9a9590]" />
              </button>

              {/* Image Upload */}
              <input
                ref={imageInputRef}
                type="file"
                onChange={(e) => handleFileSelect(e, 'image')}
                className="hidden"
                multiple
                accept="image/*"
              />
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={disabled}
                className="p-2 md:p-1.5 rounded hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
                title="Attach image"
              >
                <ImageIcon className="h-4 w-4 md:h-3.5 md:w-3.5 text-[#9a9590]" />
              </button>

              {/* Audio Recording / Speech-to-Text */}
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={disabled || isTranscribing}
                className={`p-1.5 rounded transition-colors disabled:opacity-50 hidden md:inline-flex ${
                  isRecording
                    ? 'bg-[var(--error)]/20 text-[var(--error)]'
                    : isTranscribing
                    ? 'bg-[var(--link)]/20 text-[var(--link)]'
                    : 'hover:bg-[var(--accent)]'
                }`}
                title={isTranscribing ? 'Transcribing...' : isRecording ? 'Stop recording' : 'Voice input (speech-to-text)'}
              >
                {isTranscribing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : isRecording ? (
                  <MicOff className="h-3.5 w-3.5" />
                ) : (
                  <Mic className="h-3.5 w-3.5 text-[#9a9590]" />
                )}
              </button>

              {/* TTS Toggle */}
              <button
                onClick={() => setIsTTSEnabled(!isTTSEnabled)}
                disabled={disabled}
                className={`p-1.5 rounded transition-colors disabled:opacity-50 hidden md:inline-flex ${
                  isTTSEnabled
                    ? 'bg-[var(--success)]/20 text-[var(--success)]'
                    : 'hover:bg-[var(--accent)]'
                }`}
                title={isTTSEnabled ? 'Disable TTS' : 'Enable TTS'}
              >
                {isTTSEnabled ? (
                  <Volume2 className="h-3.5 w-3.5" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5 text-[#9a9590]" />
                )}
              </button>

              {/* Tools Toggle */}
              <button
                onClick={onMcpToggle}
                disabled={disabled}
                className={`flex items-center gap-1.5 px-2 py-1.5 md:px-2 md:py-1 rounded-lg transition-all disabled:opacity-50 ${
                  mcpEnabled
                    ? 'bg-purple-500/10 text-purple-400 dark:text-purple-300'
                    : 'hover:bg-[var(--accent)] text-[#9a9590]'
                }`}
                title={mcpEnabled ? 'Disable web search & tools' : 'Enable web search & tools'}
              >
                <Globe className="h-4 w-4 md:h-3.5 md:w-3.5" />
                <span className="text-xs hidden sm:inline">Tools</span>
              </button>

              {/* Preview Toggle */}
              <button
                onClick={onArtifactsToggle}
                disabled={disabled}
                className={`flex items-center gap-1.5 px-2 py-1.5 md:px-2 md:py-1 rounded-lg transition-all disabled:opacity-50 ${
                  artifactsEnabled
                    ? 'bg-purple-500/10 text-purple-400 dark:text-purple-300'
                    : 'hover:bg-[var(--accent)] text-[#9a9590]'
                }`}
                title={artifactsEnabled ? 'Disable code preview' : 'Enable code preview & sandbox'}
              >
                <Code className="h-4 w-4 md:h-3.5 md:w-3.5" />
                <span className="text-xs hidden sm:inline">Preview</span>
              </button>

              {/* Research Toggle */}
              {onDeepResearchToggle && (
                <button
                  onClick={onDeepResearchToggle}
                  disabled={disabled}
                  className={`flex items-center gap-1.5 px-2 py-1.5 md:px-2 md:py-1 rounded-lg transition-all disabled:opacity-50 ${
                    deepResearchEnabled
                      ? 'bg-purple-500/10 text-purple-400 dark:text-purple-300'
                      : 'hover:bg-[var(--accent)] text-[#9a9590]'
                  }`}
                  title={deepResearchEnabled ? 'Deep Research enabled' : 'Enable Deep Research mode'}
                >
                  <Brain className="h-4 w-4 md:h-3.5 md:w-3.5" />
                  <span className="text-xs hidden sm:inline">Research</span>
                </button>
              )}

              {/* MCP Settings */}
              <button
                onClick={onOpenMcpSettings}
                disabled={disabled}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-[var(--accent)] transition-colors disabled:opacity-50 hidden sm:inline-flex text-[#9a9590]"
                title="Configure MCP servers"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>

              {/* System Prompt */}
              <button
                onClick={onOpenChatSettings}
                disabled={disabled}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all disabled:opacity-50 hover:bg-[var(--accent)] text-[#9a9590]"
                title={hasSystemPrompt ? 'System prompt active' : 'Configure system prompt'}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span className="text-xs hidden sm:inline">System</span>
              </button>
            </div>

            <div className="flex items-center">
              {isLoading ? (
                <button
                  onClick={onStop}
                  className="p-2.5 md:p-2 rounded-lg bg-[var(--error)] text-white hover:opacity-90 transition-all active:scale-95"
                  title="Stop"
                >
                  <StopCircle className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={(!value.trim() && attachments.length === 0) || disabled}
                  className="p-2.5 md:p-2 rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-all active:scale-95 disabled:opacity-30 disabled:active:scale-100"
                  title="Send"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
