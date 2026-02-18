// CRITICAL
"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

type Args = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isRecording: boolean;
  setIsRecording: (isRecording: boolean) => void;
  setRecordingDuration: (duration: number) => void;
  setIsTranscribing: (isTranscribing: boolean) => void;
  setTranscriptionError: (error: string | null) => void;
  setInput: (value: string) => void;
  getCurrentInput: () => string;
  getRecordingDuration: () => number;
};

async function transcribeAudio(args: {
  audioBlob: Blob;
  setIsTranscribing: (value: boolean) => void;
  setTranscriptionError: (value: string | null) => void;
}): Promise<string | null> {
  const { audioBlob, setIsTranscribing, setTranscriptionError } = args;
  try {
    setIsTranscribing(true);
    setTranscriptionError(null);

    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");

    const response = await fetch("/api/voice/transcribe", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.details || errorData.error || `Transcription failed (${response.status})`);
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
}

export function useAudioRecording({
  textareaRef,
  isRecording,
  setIsRecording,
  setRecordingDuration,
  setIsTranscribing,
  setTranscriptionError,
  setInput,
  getCurrentInput,
  getRecordingDuration,
}: Args) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
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

        const transcript = await transcribeAudio({
          audioBlob,
          setIsTranscribing,
          setTranscriptionError,
        });
        if (transcript) {
          const currentInput = getCurrentInput();
          setInput(currentInput ? `${currentInput} ${transcript}` : transcript);
          textareaRef.current?.focus();
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingDuration(getRecordingDuration() + 1);
      }, 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  }, [
    getCurrentInput,
    getRecordingDuration,
    setInput,
    setIsRecording,
    setIsTranscribing,
    setRecordingDuration,
    setTranscriptionError,
    textareaRef,
  ]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  }, [isRecording, setIsRecording]);

  return { startRecording, stopRecording };
}

