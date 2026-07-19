"use client";

import { Mic, Square } from "@/ui/icon-registry";
import { useComposerDictation } from "./use-composer-dictation";

export function ComposerDictationButton({
  disabled,
  inactiveClassName,
  onTranscript,
}: {
  disabled: boolean;
  inactiveClassName: string;
  onTranscript: (text: string) => void;
}) {
  const dictation = useComposerDictation(onTranscript);
  const title = dictation.error
    ? dictation.error
    : dictation.transcribing
      ? "Transcribing…"
      : dictation.recording
        ? "Stop dictation"
        : "Dictate message";

  return (
    <>
      <button
        type="button"
        onClick={() => void dictation.toggle()}
        disabled={disabled || (dictation.busy && !dictation.recording)}
        aria-pressed={dictation.recording}
        aria-label={dictation.recording ? "Stop dictation" : "Start dictation"}
        title={title}
        className={`inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${dictation.recording ? "bg-red-500/15 text-red-400" : inactiveClassName}`}
      >
        {dictation.recording ? (
          <Square className="h-3 w-3 fill-current" strokeWidth={1.5} />
        ) : (
          <Mic className="h-4 w-4" strokeWidth={1.5} />
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {dictation.error || (dictation.transcribing ? "Transcribing audio" : "")}
      </span>
    </>
  );
}
