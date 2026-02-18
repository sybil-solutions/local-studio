// CRITICAL
import type { AppContext } from "../../../types/context";
import type { JobReporter } from "../orchestrator";
import { fetchInference } from "../../../services/inference/inference-client";

/**
 * Voice assistant turn workflow.
 *
 * Stages:
 * 1. Optional STT (if audio_base64 provided)
 * 2. LLM completion (required)
 * 3. Optional TTS (if tts_model provided)
 *
 * @param context - App context.
 * @param jobId - Job identifier.
 * @param input - Workflow input.
 * @param reporter - Progress/log reporter.
 * @returns Workflow result.
 */
export async function voiceAssistantTurn(
  context: AppContext,
  _jobId: string,
  input: Record<string, unknown>,
  reporter: JobReporter,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  let userText = typeof input["text"] === "string" ? input["text"] : "";

  // ── Stage 1: Optional STT ──────────────────────────────────────────
  const audioPath = input["audio_path"] as string | undefined;
  const sttModel = input["stt_model"] as string | undefined;
  if (audioPath && sttModel && !userText) {
    reporter.progress(10);
    reporter.log("STT: transcribing audio input");
    try {
      const { transcribeAudio } = await import("../../../services/integrations/stt");
      const sttResult = await transcribeAudio({ audioPath, modelPath: sttModel });
      userText = sttResult.text;
      result["stt_text"] = userText;
      reporter.log(`STT: transcribed "${userText.slice(0, 80)}"`);
    } catch (err) {
      reporter.log(`STT: failed — ${String(err)}`);
      throw new Error(`STT failed: ${String(err)}`);
    }
  }
  reporter.progress(20);

  if (!userText) {
    throw new Error("No text input and no audio provided");
  }

  // ── Stage 2: LLM completion ────────────────────────────────────────
  reporter.progress(30);
  reporter.log(`LLM: sending "${userText.slice(0, 80)}" to inference`);

  const model = typeof input["model"] === "string" ? input["model"] : undefined;
  const messages = [{ role: "user", content: userText }];

  try {
    const body: Record<string, unknown> = { messages, stream: false };
    if (model) body["model"] = model;

    const response = await fetchInference(context, "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    });

    if (response.status !== 200) {
      const text = await response.text();
      throw new Error(`LLM returned ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const assistantText = data.choices?.[0]?.message?.content ?? "";
    result["llm_text"] = assistantText;
    reporter.log(`LLM: received ${assistantText.length} chars`);
  } catch (err) {
    reporter.log(`LLM: failed — ${String(err)}`);
    throw new Error(`LLM failed: ${String(err)}`);
  }
  reporter.progress(70);

  // ── Stage 3: Optional TTS ──────────────────────────────────────────
  const ttsModel = input["tts_model"] as string | undefined;
  const ttsOutput = input["tts_output_path"] as string | undefined;
  const llmText = result["llm_text"] as string;
  if (ttsModel && llmText) {
    reporter.progress(80);
    reporter.log(`TTS: synthesizing ${llmText.length} chars`);
    try {
      const { synthesizeSpeech } = await import("../../../services/integrations/tts");
      const outputPath = ttsOutput ?? `/tmp/job-tts-${_jobId}.wav`;
      await synthesizeSpeech({
        text: llmText.slice(0, 2000),
        modelPath: ttsModel,
        outputPath,
      });
      result["tts_output_path"] = outputPath;
      reporter.log(`TTS: generated to ${outputPath}`);
    } catch (err) {
      reporter.log(`TTS: failed — ${String(err)}`);
      // TTS failure is non-fatal
      result["tts_error"] = String(err);
    }
  }

  reporter.progress(100);
  reporter.status("completed");
  reporter.log("Workflow completed");
  return result;
}
