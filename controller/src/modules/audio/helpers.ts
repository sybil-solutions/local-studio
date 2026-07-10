import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AppContext } from "../../app-context";
import { resolveBinary, runCommandAsync } from "../../core/command";
import { SttIntegrationError } from "../../services/stt";
import type { SttMode } from "../../services/stt";
import { TtsIntegrationError } from "../../services/tts";
import type { TtsMode } from "../../services/tts";
const AUDIO_DEFAULT_MODE = "strict";
const AUDIO_TRANSCODE_TIMEOUT_MS = 60_000;

export const parseField = (value: FormDataEntryValue | null): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const parseMode = (value: FormDataEntryValue | null): SttMode => {
  const modeValue = (parseField(value) ?? AUDIO_DEFAULT_MODE).toLowerCase();
  if (modeValue === "strict" || modeValue === "best_effort") {
    return modeValue;
  }
  throw new SttIntegrationError(400, "invalid_mode", "mode must be strict or best_effort");
};

export const parseJsonMode = (value: unknown): TtsMode => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return AUDIO_DEFAULT_MODE;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "strict" || normalized === "best_effort") {
    return normalized;
  }
  throw new TtsIntegrationError(400, "invalid_mode", "mode must be strict or best_effort");
};

export const looksLikeWav = (bytes: Uint8Array): boolean => {
  // Verify the RIFF/WAVE header rather than trusting a client-supplied MIME
  // type: a client sending arbitrary bytes as audio/wav would otherwise skip
  // transcode and feed non-WAV data straight to the STT engine.
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const wave = String.fromCharCode(...bytes.slice(8, 12));
  return riff === "RIFF" && wave === "WAVE";
};

type AudioModelError = new (
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => Error;

const resolveAudioModelPath = (
  context: AppContext,
  requested: string | undefined,
  subdir: "stt" | "tts",
  envVariable: string,
  IntegrationError: AudioModelError,
): { requestedModel: string; modelPath: string } => {
  const requestedModel = requested || process.env[envVariable]?.trim();
  if (!requestedModel) {
    throw new IntegrationError(
      400,
      "model_missing",
      `No ${subdir.toUpperCase()} model provided. Set model field or ${envVariable}.`,
    );
  }

  const modelPath = requestedModel.includes("/")
    ? resolve(requestedModel)
    : resolve(context.config.models_dir, subdir, requestedModel);

  if (!existsSync(modelPath)) {
    throw new IntegrationError(
      400,
      "model_not_found",
      `${subdir.toUpperCase()} model path does not exist`,
      { requested_model: requestedModel, resolved_model_path: modelPath },
    );
  }

  return { requestedModel, modelPath };
};

export const resolveSttModelPath = (
  context: AppContext,
  modelField: FormDataEntryValue | null,
): { requestedModel: string; modelPath: string } =>
  resolveAudioModelPath(
    context,
    parseField(modelField),
    "stt",
    "LOCAL_STUDIO_STT_MODEL",
    SttIntegrationError,
  );

export const resolveTtsModelPath = (
  context: AppContext,
  modelValue: unknown,
): { requestedModel: string; modelPath: string } =>
  resolveAudioModelPath(
    context,
    typeof modelValue === "string" ? modelValue.trim() : undefined,
    "tts",
    "LOCAL_STUDIO_TTS_MODEL",
    TtsIntegrationError,
  );

export const ensureServiceLease = async (
  context: AppContext,
  mode: SttMode | TtsMode,
  serviceId: "stt" | "tts",
): Promise<Record<string, unknown> | null> => {
  const holder = await context.processManager.findInferenceProcess(context.config.inference_port);
  if (!holder) {
    return null;
  }

  if (mode === "best_effort") {
    return null;
  }

  return {
    code: "gpu_lease_conflict",
    requested_service: { id: serviceId },
    holder_service: { id: "llm" },
    actions: ["best_effort"],
  };
};

export const defaultTranscodeToWav = async (options: {
  sourcePath: string;
  outputPath: string;
}): Promise<string> => {
  const ffmpegPath = resolveBinary(process.env["LOCAL_STUDIO_FFMPEG_CLI"] ?? "ffmpeg");
  if (!ffmpegPath) {
    throw new SttIntegrationError(
      503,
      "ffmpeg_missing",
      "ffmpeg is required for non-WAV uploads. Install ffmpeg or upload WAV input.",
    );
  }

  const result = await runCommandAsync(
    ffmpegPath,
    ["-y", "-i", options.sourcePath, "-ac", "1", "-ar", "16000", "-f", "wav", options.outputPath],
    { timeoutMs: AUDIO_TRANSCODE_TIMEOUT_MS },
  );

  if (result.timedOut) {
    throw new SttIntegrationError(504, "audio_transcode_timeout", "Audio transcode timed out", {
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }

  if (result.status !== 0) {
    throw new SttIntegrationError(
      400,
      "audio_transcode_failed",
      "Failed to transcode audio to WAV",
      {
        exit_code: result.status,
        signal: result.signal,
        stderr: result.stderr,
        stdout: result.stdout,
      },
    );
  }

  return options.outputPath;
};
