// CRITICAL
"use client";

import { useCallback, useState } from "react";
import api from "@/lib/api";

export function JobCreateForm() {
  const [text, setText] = useState("");
  const [ttsModel, setTtsModel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!text.trim()) return;
    setSubmitting(true);
    setLastResult(null);
    try {
      const input: Record<string, unknown> = { text: text.trim() };
      if (ttsModel.trim()) input["tts_model"] = ttsModel.trim();
      const { job } = await api.createJob("voice_assistant_turn", input);
      setLastResult(`Created job ${job.id}`);
      setText("");
    } catch (err) {
      setLastResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }, [text, ttsModel]);

  return (
    <div className="space-y-3">
      <h3 className="text-xs uppercase tracking-widest text-foreground/40">
        New Voice Turn
      </h3>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="User message text…"
        className="w-full px-3 py-2 text-sm bg-black/20 border border-foreground/10 rounded font-mono focus:outline-none focus:border-foreground/30"
      />
      <input
        type="text"
        value={ttsModel}
        onChange={(e) => setTtsModel(e.target.value)}
        placeholder="TTS model (optional, e.g. en_US-amy.onnx)"
        className="w-full px-3 py-2 text-sm bg-black/20 border border-foreground/10 rounded font-mono focus:outline-none focus:border-foreground/30"
      />
      <button
        onClick={handleSubmit}
        disabled={submitting || !text.trim()}
        className="px-4 py-1.5 text-xs uppercase tracking-wider bg-foreground/10 hover:bg-foreground/20 rounded disabled:opacity-40 transition-colors"
      >
        {submitting ? "Creating…" : "Create Job"}
      </button>
      {lastResult && (
        <div className="text-xs font-mono text-foreground/50">{lastResult}</div>
      )}
    </div>
  );
}
