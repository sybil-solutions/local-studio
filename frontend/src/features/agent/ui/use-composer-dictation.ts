"use client";

import { useCallback, useRef, useState } from "react";
import api from "@/lib/api/client";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type DictationState = "idle" | "requesting" | "recording" | "transcribing";

type ActiveRecording = {
  recorder: MediaRecorder;
  stream: MediaStream;
};

const MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

function preferredMimeType(): string {
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function extensionForMimeType(type: string): string {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was denied";
  }
  return error instanceof Error ? error.message : "Dictation failed";
}

export function useComposerDictation(onTranscript: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState("");
  const active = useRef<ActiveRecording | null>(null);
  const mounted = useRef(true);

  const stop = useCallback(() => {
    const current = active.current;
    if (!current) return;
    active.current = null;
    if (current.recorder.state !== "inactive") current.recorder.stop();
    stopStream(current.stream);
  }, []);

  const start = useCallback(async () => {
    if (active.current || state !== "idle") return;
    setError("");
    setState("requesting");
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Microphone recording is unavailable");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      const captureStream = stream;
      if (!mounted.current) {
        stopStream(captureStream);
        return;
      }
      const mimeType = preferredMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        stopStream(captureStream);
        active.current = null;
        if (!mounted.current) return;
        setError("Microphone recording failed");
        setState("idle");
      };
      recorder.onstop = () => {
        stopStream(captureStream);
        active.current = null;
        if (!mounted.current) return;
        const type = recorder.mimeType || mimeType || "audio/webm";
        const file = new File(
          [new Blob(chunks, { type })],
          `dictation.${extensionForMimeType(type)}`,
          {
            type,
          },
        );
        setState("transcribing");
        void api
          .transcribeAudio({ recording: file })
          .then((text) => {
            if (mounted.current) onTranscript(text);
          })
          .catch((transcriptionError) => {
            if (mounted.current) setError(errorMessage(transcriptionError));
          })
          .finally(() => {
            if (mounted.current) setState("idle");
          });
      };
      active.current = { recorder, stream: captureStream };
      recorder.start(500);
      setState("recording");
    } catch (captureError) {
      if (stream) stopStream(stream);
      if (!mounted.current) return;
      setError(errorMessage(captureError));
      setState("idle");
    }
  }, [onTranscript, state]);

  useMountSubscription(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, [stop]);

  return {
    error,
    recording: state === "recording",
    transcribing: state === "transcribing",
    busy: state !== "idle",
    toggle: state === "recording" ? stop : start,
  };
}
