// CRITICAL
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type { AppContext } from "../../types/context";
import { resolveBinary } from "../../core/command";
import { runCliCommand } from "../../services/integrations/cli/cli-runner";
import { SttIntegrationError, transcribeAudio } from "../../services/integrations/stt";
import type { SttMode, SttTranscriptionResult } from "../../services/integrations/stt";
import { synthesizeSpeech, TtsIntegrationError } from "../../services/integrations/tts";
import type { TtsMode, TtsSynthesisRequest } from "../../services/integrations/tts";

interface AudioRouteDependencies {
  transcribe?: (request: {
    audioPath: string;
    modelPath: string;
    language?: string;
  }) => Promise<SttTranscriptionResult>;
  transcodeToWav?: (options: {
    sourcePath: string;
    outputPath: string;
  }) => Promise<string>;
  synthesize?: (request: TtsSynthesisRequest) => Promise<void>;
}

const parseField = (value: FormDataEntryValue | null): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseMode = (value: FormDataEntryValue | null): SttMode => {
  const modeValue = (parseField(value) ?? "strict").toLowerCase();
  if (modeValue === "strict" || modeValue === "best_effort") {
    return modeValue;
  }
  throw new SttIntegrationError(400, "invalid_mode", "mode must be strict or best_effort");
};

const parseReplace = (value: FormDataEntryValue | null): boolean => {
  const replaceValue = parseField(value);
  if (!replaceValue) return false;
  return ["1", "true", "yes", "on"].includes(replaceValue.toLowerCase());
};

const parseJsonMode = (value: unknown): TtsMode => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "strict";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "strict" || normalized === "best_effort") {
    return normalized;
  }
  throw new TtsIntegrationError(400, "invalid_mode", "mode must be strict or best_effort");
};

const parseJsonReplace = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }
  return false;
};

const looksLikeWav = (bytes: Uint8Array, mimeType?: string): boolean => {
  if (mimeType?.toLowerCase().includes("wav")) {
    return true;
  }
  if (bytes.length < 12) return false;
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const wave = String.fromCharCode(...bytes.slice(8, 12));
  return riff === "RIFF" && wave === "WAVE";
};

const resolveSttModelPath = (
  context: AppContext,
  modelField: FormDataEntryValue | null
): { requestedModel: string; modelPath: string } => {
  const requestedModel = parseField(modelField) ?? process.env["VLLM_STUDIO_STT_MODEL"]?.trim();
  if (!requestedModel) {
    throw new SttIntegrationError(
      400,
      "model_missing",
      "No STT model provided. Set model field or VLLM_STUDIO_STT_MODEL."
    );
  }

  const modelPath = requestedModel.includes("/")
    ? resolve(requestedModel)
    : resolve(context.config.models_dir, "stt", requestedModel);

  if (!existsSync(modelPath)) {
    throw new SttIntegrationError(400, "model_not_found", "STT model path does not exist", {
      requested_model: requestedModel,
      resolved_model_path: modelPath,
    });
  }

  return { requestedModel, modelPath };
};

const resolveTtsModelPath = (
  context: AppContext,
  modelValue: unknown
): { requestedModel: string; modelPath: string } => {
  const explicitModel = typeof modelValue === "string" ? modelValue.trim() : "";
  const requestedModel = explicitModel || process.env["VLLM_STUDIO_TTS_MODEL"]?.trim();
  if (!requestedModel) {
    throw new TtsIntegrationError(
      400,
      "model_missing",
      "No TTS model provided. Set model field or VLLM_STUDIO_TTS_MODEL."
    );
  }

  const modelPath = requestedModel.includes("/")
    ? resolve(requestedModel)
    : resolve(context.config.models_dir, "tts", requestedModel);

  if (!existsSync(modelPath)) {
    throw new TtsIntegrationError(400, "model_not_found", "TTS model path does not exist", {
      requested_model: requestedModel,
      resolved_model_path: modelPath,
    });
  }

  return { requestedModel, modelPath };
};

const ensureServiceLease = async (
  context: AppContext,
  mode: SttMode | TtsMode,
  replace: boolean,
  serviceId: "stt" | "tts"
): Promise<Record<string, unknown> | null> => {
  const holder = await context.processManager.findInferenceProcess(context.config.inference_port);
  if (!holder) {
    return null;
  }

  if (replace) {
    await context.processManager.evictModel(true);
    return null;
  }

  if (mode === "best_effort") {
    return null;
  }

  return {
    code: "gpu_lease_conflict",
    requested_service: { id: serviceId },
    holder_service: { id: "llm" },
    actions: ["replace", "best_effort"],
  };
};

const defaultTranscodeToWav = async (options: {
  sourcePath: string;
  outputPath: string;
}): Promise<string> => {
  const ffmpegPath = resolveBinary(process.env["VLLM_STUDIO_FFMPEG_CLI"] ?? "ffmpeg");
  if (!ffmpegPath) {
    throw new SttIntegrationError(
      503,
      "ffmpeg_missing",
      "ffmpeg is required for non-WAV uploads. Install ffmpeg or upload WAV input."
    );
  }

  const result = await runCliCommand({
    command: ffmpegPath,
    args: ["-y", "-i", options.sourcePath, "-ac", "1", "-ar", "16000", "-f", "wav", options.outputPath],
    timeoutMs: 60_000,
  });

  if (result.timedOut) {
    throw new SttIntegrationError(504, "audio_transcode_timeout", "Audio transcode timed out", {
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }

  if (result.exitCode !== 0) {
    throw new SttIntegrationError(400, "audio_transcode_failed", "Failed to transcode audio to WAV", {
      exit_code: result.exitCode,
      signal: result.signal,
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }

  return options.outputPath;
};

/**
 * Register speech routes.
 * @param app - Hono app.
 * @param context - Application context.
 * @param dependencies - Optional route dependency overrides for testing.
 * @returns Nothing.
 */
export const registerAudioRoutes = (
  app: Hono,
  context: AppContext,
  dependencies: AudioRouteDependencies = {}
): void => {
  const transcribe = dependencies.transcribe ?? transcribeAudio;
  const transcodeToWav = dependencies.transcodeToWav ?? defaultTranscodeToWav;
  const synthesize = dependencies.synthesize ?? synthesizeSpeech;

  app.post("/v1/audio/transcriptions", async (ctx) => {
    const cleanupPaths = new Set<string>();

    try {
      const formData = await ctx.req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        throw new SttIntegrationError(400, "file_missing", "Multipart field 'file' is required");
      }

      const mode = parseMode(formData.get("mode"));
      const replace = parseReplace(formData.get("replace"));
      const language = parseField(formData.get("language"));
      const { modelPath } = resolveSttModelPath(context, formData.get("model"));

      const conflict = await ensureServiceLease(context, mode, replace, "stt");
      if (conflict) {
        return ctx.json(conflict, { status: 409 });
      }

      const temporaryDirectory = join(context.config.data_dir, "tmp", "audio");
      await mkdir(temporaryDirectory, { recursive: true });

      const uploadBuffer = new Uint8Array(await file.arrayBuffer());
      const uploadExtension = extname(file.name || "") || ".bin";
      const uploadPath = join(temporaryDirectory, `${randomUUID()}${uploadExtension}`);
      cleanupPaths.add(uploadPath);
      await writeFile(uploadPath, uploadBuffer);

      let audioPath = uploadPath;
      if (!looksLikeWav(uploadBuffer, file.type)) {
        const wavPath = join(temporaryDirectory, `${randomUUID()}.wav`);
        cleanupPaths.add(wavPath);
        audioPath = await transcodeToWav({
          sourcePath: uploadPath,
          outputPath: wavPath,
        });
      }

      const transcription = await transcribe({
        audioPath,
        modelPath,
        ...(language ? { language } : {}),
      });

      if (!transcription.text || transcription.text.trim().length === 0) {
        throw new SttIntegrationError(
          502,
          "stt_empty_result",
          "STT completed but returned an empty transcript"
        );
      }

      return ctx.json({ text: transcription.text });
    } catch (error) {
      if (error instanceof SttIntegrationError) {
        return ctx.json(
          {
            code: error.code,
            error: error.message,
            ...error.details,
          },
          { status: error.status }
        );
      }

      context.logger.error("audio transcription route failed", {
        error: String(error),
      });

      return ctx.json(
        {
          code: "stt_internal_error",
          error: "Internal STT error",
          details: String(error),
        },
        { status: 500 }
      );
    } finally {
      await Promise.all(
        [...cleanupPaths].map(async (pathValue) => {
          try {
            await unlink(pathValue);
          } catch {
            // Ignore cleanup failures.
          }
        })
      );
    }
  });

  app.post("/v1/audio/speech", async (ctx) => {
    const cleanupPaths = new Set<string>();

    try {
      let body: Record<string, unknown> = {};
      try {
        body = (await ctx.req.json()) as Record<string, unknown>;
      } catch {
        body = {};
      }

      const input = typeof body["input"] === "string" ? body["input"].trim() : "";
      if (!input) {
        throw new TtsIntegrationError(400, "input_missing", "input is required and cannot be empty");
      }

      const requestedFormat =
        typeof body["response_format"] === "string"
          ? body["response_format"].trim().toLowerCase()
          : "wav";
      if (requestedFormat !== "wav") {
        throw new TtsIntegrationError(
          400,
          "unsupported_response_format",
          "Only response_format='wav' is supported"
        );
      }

      const mode = parseJsonMode(body["mode"]);
      const replace = parseJsonReplace(body["replace"]);
      const { modelPath } = resolveTtsModelPath(context, body["model"]);

      const conflict = await ensureServiceLease(context, mode, replace, "tts");
      if (conflict) {
        return ctx.json(conflict, { status: 409 });
      }

      const temporaryDirectory = join(context.config.data_dir, "tmp", "audio");
      await mkdir(temporaryDirectory, { recursive: true });

      const outputPath = join(temporaryDirectory, `${randomUUID()}.wav`);
      cleanupPaths.add(outputPath);

      await synthesize({
        text: input,
        modelPath,
        outputPath,
      });

      const audioBytes = await readFile(outputPath);
      return new Response(new Uint8Array(audioBytes), {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
        },
      });
    } catch (error) {
      if (error instanceof TtsIntegrationError) {
        return ctx.json(
          {
            code: error.code,
            error: error.message,
            ...error.details,
          },
          { status: error.status }
        );
      }

      context.logger.error("audio speech route failed", {
        error: String(error),
      });

      return ctx.json(
        {
          code: "tts_internal_error",
          error: "Internal TTS error",
          details: String(error),
        },
        { status: 500 }
      );
    } finally {
      await Promise.all(
        [...cleanupPaths].map(async (pathValue) => {
          try {
            await unlink(pathValue);
          } catch {
            // Ignore cleanup failures.
          }
        })
      );
    }
  });
};
