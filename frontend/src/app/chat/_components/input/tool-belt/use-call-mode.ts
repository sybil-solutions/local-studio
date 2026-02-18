// CRITICAL
"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "@/store";
import { useShallow } from "zustand/react/shallow";
import type { ChatMessage } from "@/lib/types";

/** Silence detection + loop timing constants */
const MIN_RECORD_MS = 1500;
const SILENCE_TIMEOUT_MS = 1500;
const MAX_RECORD_MS = 60000;
const SILENCE_RMS_THRESHOLD = 0.015;
const DEDUPE_WINDOW_MS = 5000;
const REOPEN_DELAY_MS = 600;
const TTS_MAX_CHARS = 2000;
const VOLUME_CHECK_INTERVAL_MS = 100;

export interface UseCallModeArgs {
  messages: ChatMessage[];
  isLoading: boolean;
  selectedModel: string;
  onSubmit: (text: string) => Promise<void>;
}

export function useCallMode({ messages, isLoading, selectedModel, onSubmit }: UseCallModeArgs) {
  const {
    callModeEnabled,
    setCallModeEnabled,
    setIsRecording,
    setRecordingDuration,
    setIsTranscribing,
    setTranscriptionError,
    setCallModeSpeakingMessageId,
    pushToast,
  } = useAppStore(
    useShallow((s) => ({
      callModeEnabled: s.callModeEnabled,
      setCallModeEnabled: s.setCallModeEnabled,
      setIsRecording: s.setIsRecording,
      setRecordingDuration: s.setRecordingDuration,
      setIsTranscribing: s.setIsTranscribing,
      setTranscriptionError: s.setTranscriptionError,
      setCallModeSpeakingMessageId: s.setCallModeSpeakingMessageId,
      pushToast: s.pushToast,
    })),
  );

  // ── Refs for recording ───────────────────────────────────────────────
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const volumeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recordStartTimeRef = useRef(0);

  // ── Refs for TTS playback ────────────────────────────────────────────
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);

  // ── Refs for loop coordination ───────────────────────────────────────
  const enabledRef = useRef(false);
  const phaseRef = useRef<"idle" | "recording" | "transcribing" | "waiting" | "speaking">("idle");
  const lastTranscriptRef = useRef("");
  const lastTranscriptTimeRef = useRef(0);
  const lastSpokenIdRef = useRef<string | null>(null);
  const reopenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failCountRef = useRef(0);
  const MAX_CONSECUTIVE_FAILS = 3;

  // Keep enabledRef in sync
  useEffect(() => {
    enabledRef.current = callModeEnabled;
  }, [callModeEnabled]);

  // ── Cleanup helpers ──────────────────────────────────────────────────

  const clearTimers = useCallback(() => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    if (volumeTimerRef.current) clearInterval(volumeTimerRef.current);
    if (reopenTimerRef.current) clearTimeout(reopenTimerRef.current);
    recordingTimerRef.current = null;
    silenceTimerRef.current = null;
    maxTimerRef.current = null;
    volumeTimerRef.current = null;
    reopenTimerRef.current = null;
  }, []);

  const releaseMediaResources = useCallback(() => {
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch { /* already stopped */ }
      mediaRecorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch { /* ok */ }
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    audioChunksRef.current = [];
  }, []);

  const releaseTTSResources = useCallback(() => {
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    if (ttsAudioRef.current) {
      ttsAudioRef.current.onended = null;
      ttsAudioRef.current.onerror = null;
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = "";
      ttsAudioRef.current = null;
    }
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
  }, []);

  const fullCleanup = useCallback(() => {
    clearTimers();
    releaseMediaResources();
    releaseTTSResources();
    setIsRecording(false);
    setIsTranscribing(false);
    setRecordingDuration(0);
    setCallModeSpeakingMessageId(null);
    phaseRef.current = "idle";
    failCountRef.current = 0;
  }, [clearTimers, releaseMediaResources, releaseTTSResources, setIsRecording, setIsTranscribing, setRecordingDuration, setCallModeSpeakingMessageId]);

  // ── Transcription ────────────────────────────────────────────────────

  const transcribeBlob = useCallback(
    async (blob: Blob): Promise<string | null> => {
      setIsTranscribing(true);
      setTranscriptionError(null);
      phaseRef.current = "transcribing";
      try {
        const form = new FormData();
        form.append("file", blob, "recording.webm");
        const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.details || err.error || `Transcription failed (${res.status})`);
        }
        const data = await res.json();
        if (!data.text) throw new Error("No transcription returned");
        failCountRef.current = 0;
        return data.text as string;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Transcription failed";
        setTranscriptionError(msg);
        setTimeout(() => setTranscriptionError(null), 5000);
        failCountRef.current += 1;
        return null;
      } finally {
        setIsTranscribing(false);
      }
    },
    [setIsTranscribing, setTranscriptionError],
  );

  // ── TTS playback ────────────────────────────────────────────────────

  const speakText = useCallback(
    async (text: string, messageId: string): Promise<boolean> => {
      phaseRef.current = "speaking";
      setCallModeSpeakingMessageId(messageId);
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      try {
        const trimmed = text.length > TTS_MAX_CHARS ? text.slice(0, TTS_MAX_CHARS) : text;
        const res = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: trimmed, response_format: "wav" }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const raw = await res.text();
          throw new Error(raw || `TTS failed (${res.status})`);
        }
        const blob = await res.blob();
        if (blob.size === 0) throw new Error("Empty TTS response");
        if (!enabledRef.current) return false;
        const url = URL.createObjectURL(blob);
        ttsUrlRef.current = url;
        const audio = new Audio(url);
        ttsAudioRef.current = audio;
        return await new Promise<boolean>((resolve) => {
          audio.onended = () => resolve(true);
          audio.onerror = () => resolve(false);
          audio.play().catch(() => resolve(false));
        });
      } catch (err) {
        if (controller.signal.aborted) return false;
        console.error("Call-mode TTS error:", err);
        failCountRef.current += 1;
        return false;
      } finally {
        releaseTTSResources();
        setCallModeSpeakingMessageId(null);
      }
    },
    [releaseTTSResources, setCallModeSpeakingMessageId],
  );

  // ── Recording with silence detection ─────────────────────────────────

  const startCallRecording = useCallback(async () => {
    if (!enabledRef.current) return;
    if (phaseRef.current === "recording") return;

    phaseRef.current = "recording";
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!enabledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      // Audio analysis for silence detection
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);

      recorder.start();
      recordStartTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingDuration(0);

      // Duration counter
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordStartTimeRef.current) / 1000);
        setRecordingDuration(elapsed);
      }, 1000);

      // Max recording guard
      maxTimerRef.current = setTimeout(() => {
        stopCallRecording();
      }, MAX_RECORD_MS);

      // Volume-based silence detection
      const dataArray = new Float32Array(analyser.fftSize);
      let lastVoiceTime = Date.now();

      volumeTimerRef.current = setInterval(() => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]! * dataArray[i]!;
        const rms = Math.sqrt(sum / dataArray.length);

        if (rms > SILENCE_RMS_THRESHOLD) {
          lastVoiceTime = Date.now();
        }

        const elapsed = Date.now() - recordStartTimeRef.current;
        if (elapsed > MIN_RECORD_MS && Date.now() - lastVoiceTime > SILENCE_TIMEOUT_MS) {
          stopCallRecording();
        }
      }, VOLUME_CHECK_INTERVAL_MS);
    } catch (err) {
      console.error("Call-mode recording failed:", err);
      releaseMediaResources();
      clearTimers();
      setIsRecording(false);
      phaseRef.current = "idle";
      failCountRef.current += 1;

      if (failCountRef.current >= MAX_CONSECUTIVE_FAILS && enabledRef.current) {
        pushToast({
          kind: "error",
          title: "Call mode stopped",
          message: "Too many consecutive failures. Disabling call mode.",
          dedupeKey: "call-mode-max-fails",
        });
        setCallModeEnabled(false);
      }
    }
  }, [clearTimers, pushToast, releaseMediaResources, setCallModeEnabled, setIsRecording, setRecordingDuration]);

  const stopCallRecording = useCallback(() => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") return;

    clearTimers();
    setIsRecording(false);

    const recorder = mediaRecorderRef.current;
    recorder.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      releaseMediaResources();

      if (!enabledRef.current) return;

      // Transcribe
      const transcript = await transcribeBlob(blob);
      if (!transcript || !enabledRef.current) {
        if (enabledRef.current && failCountRef.current < MAX_CONSECUTIVE_FAILS) {
          reopenTimerRef.current = setTimeout(() => startCallRecording(), REOPEN_DELAY_MS);
        } else if (enabledRef.current) {
          pushToast({
            kind: "error",
            title: "Call mode stopped",
            message: "Too many consecutive failures.",
            dedupeKey: "call-mode-max-fails",
          });
          setCallModeEnabled(false);
        }
        return;
      }

      // Dedupe check
      const now = Date.now();
      if (
        transcript === lastTranscriptRef.current &&
        now - lastTranscriptTimeRef.current < DEDUPE_WINDOW_MS
      ) {
        if (enabledRef.current) {
          reopenTimerRef.current = setTimeout(() => startCallRecording(), REOPEN_DELAY_MS);
        }
        return;
      }
      lastTranscriptRef.current = transcript;
      lastTranscriptTimeRef.current = now;

      // Auto-submit
      phaseRef.current = "waiting";
      try {
        await onSubmit(transcript);
      } catch (err) {
        console.error("Call-mode submit error:", err);
        failCountRef.current += 1;
        if (enabledRef.current && failCountRef.current < MAX_CONSECUTIVE_FAILS) {
          reopenTimerRef.current = setTimeout(() => startCallRecording(), REOPEN_DELAY_MS);
        }
      }
    };
    recorder.stop();
  }, [
    clearTimers,
    onSubmit,
    pushToast,
    releaseMediaResources,
    setCallModeEnabled,
    setIsRecording,
    startCallRecording,
    transcribeBlob,
  ]);

  // ── Watch for assistant response → auto-speak → reopen mic ──────────

  const messagesRef = useRef(messages);
  const isLoadingRef = useRef(isLoading);
  messagesRef.current = messages;
  isLoadingRef.current = isLoading;

  useEffect(() => {
    if (!callModeEnabled) return;
    if (phaseRef.current !== "waiting") return;
    if (isLoading) return;

    // isLoading just went false while we're in call mode waiting phase
    const latest = [...messages].reverse().find((m) => m.role === "assistant");
    if (!latest || latest.id === lastSpokenIdRef.current) {
      // No new assistant message — reopen mic
      if (enabledRef.current) {
        reopenTimerRef.current = setTimeout(() => startCallRecording(), REOPEN_DELAY_MS);
      }
      return;
    }

    // Extract text from the assistant message parts
    const textParts = latest.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");

    if (!textParts.trim()) {
      lastSpokenIdRef.current = latest.id;
      if (enabledRef.current) {
        reopenTimerRef.current = setTimeout(() => startCallRecording(), REOPEN_DELAY_MS);
      }
      return;
    }

    lastSpokenIdRef.current = latest.id;

    // Speak, then reopen mic
    void speakText(textParts, latest.id).then(() => {
      if (enabledRef.current) {
        reopenTimerRef.current = setTimeout(() => startCallRecording(), REOPEN_DELAY_MS);
      }
    });
  }, [callModeEnabled, isLoading, messages, speakText, startCallRecording]);

  // ── Toggle handler ───────────────────────────────────────────────────

  const toggleCallMode = useCallback(() => {
    if (callModeEnabled) {
      fullCleanup();
      setCallModeEnabled(false);
    } else {
      if (!selectedModel) {
        pushToast({
          kind: "warning",
          title: "Select a model first",
          message: "Call mode requires a selected model to send messages.",
          dedupeKey: "call-mode-no-model",
        });
        return;
      }
      failCountRef.current = 0;
      lastSpokenIdRef.current = null;
      setCallModeEnabled(true);
      void startCallRecording();
    }
  }, [callModeEnabled, fullCleanup, pushToast, selectedModel, setCallModeEnabled, startCallRecording]);

  // ── Cleanup on unmount ───────────────────────────────────────────────

  useEffect(() => {
    return () => {
      fullCleanup();
    };
  }, [fullCleanup]);

  // ── Cleanup when call mode is disabled externally ────────────────────

  useEffect(() => {
    if (!callModeEnabled && phaseRef.current !== "idle") {
      fullCleanup();
    }
  }, [callModeEnabled, fullCleanup]);

  return { toggleCallMode };
}
