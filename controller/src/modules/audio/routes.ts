import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { Schema } from "effect";
import { CHATTERBOX_BACKEND } from "@local-studio/contracts/speech";
import type { AppContext } from "../../app-context";
import {
  boundedFormData,
  readBoundedRequestBody,
  RequestBodyTooLargeError,
} from "../../http/bounded-body";
import { SttIntegrationError, transcribeAudio } from "../../services/stt";
import { synthesizeSpeech, TtsIntegrationError } from "../../services/tts";
import type { AudioRouteDependencies } from "./interfaces";
import { SpeechServiceError } from "../speech/service";
import { VoiceProfileError } from "../speech/voice-store";
const AUDIO_TEMP_PATH_SEGMENTS = ["tmp", "audio"];
// Cap the STT upload so a single large POST can't buffer unbounded bytes into
// memory and OOM the controller. Generous for any real speech clip.
const MAX_STT_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_STT_REQUEST_BYTES = MAX_STT_UPLOAD_BYTES + 1024 * 1024;
const MAX_TTS_REQUEST_BYTES = 64 * 1024;
const JsonObjectSchema = Schema.Record(Schema.String, Schema.Unknown);
import {
  defaultTranscodeToWav,
  ensureServiceLease,
  looksLikeWav,
  parseField,
  parseJsonMode,
  parseMode,
  resolveSttModelPath,
  resolveTtsModelPath,
} from "./helpers";

export const registerAudioRoutes = (
  app: Hono,
  context: AppContext,
  dependencies: AudioRouteDependencies = {},
): void => {
  const transcribe = dependencies.transcribe ?? transcribeAudio;
  const transcodeToWav = dependencies.transcodeToWav ?? defaultTranscodeToWav;
  const synthesize = dependencies.synthesize ?? synthesizeSpeech;

  app.post("/v1/audio/transcriptions", async (ctx) => {
    const cleanupPaths = new Set<string>();

    try {
      const formData = await boundedFormData(ctx.req.raw, MAX_STT_REQUEST_BYTES).catch(
        (error) => {
          if (error instanceof RequestBodyTooLargeError) throw error;
          throw new SttIntegrationError(
            400,
            "invalid_multipart",
            "Request body must be multipart/form-data",
          );
        },
      );
      const file = formData.get("file");
      if (!(file instanceof File)) {
        throw new SttIntegrationError(400, "file_missing", "Multipart field 'file' is required");
      }
      if (file.size > MAX_STT_UPLOAD_BYTES) {
        throw new SttIntegrationError(
          413,
          "file_too_large",
          `Audio upload exceeds the ${Math.round(MAX_STT_UPLOAD_BYTES / (1024 * 1024))} MB limit`,
        );
      }

      const mode = parseMode(formData.get("mode"));
      const language = parseField(formData.get("language"));
      const { modelPath } = resolveSttModelPath(context, formData.get("model"));

      const conflict = await ensureServiceLease(context, mode, "stt");
      if (conflict) {
        return ctx.json(conflict, { status: 409 });
      }

      const temporaryDirectory = join(context.config.data_dir, ...AUDIO_TEMP_PATH_SEGMENTS);
      await mkdir(temporaryDirectory, { recursive: true });

      const uploadBuffer = new Uint8Array(await file.arrayBuffer());
      const uploadExtension = extname(file.name || "") || ".bin";
      const uploadPath = join(temporaryDirectory, `${randomUUID()}${uploadExtension}`);
      cleanupPaths.add(uploadPath);
      await writeFile(uploadPath, uploadBuffer);

      let audioPath = uploadPath;
      if (!looksLikeWav(uploadBuffer)) {
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
          "STT completed but returned an empty transcript",
        );
      }

      return ctx.json({ text: transcription.text });
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return ctx.json(
          {
            code: "file_too_large",
            error: `Audio upload exceeds the ${Math.round(MAX_STT_UPLOAD_BYTES / (1024 * 1024))} MB limit`,
          },
          { status: 413 },
        );
      }
      if (error instanceof SttIntegrationError) {
        return ctx.json(
          {
            code: error.code,
            error: error.message,
            ...error.details,
          },
          { status: error.status },
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
        { status: 500 },
      );
    } finally {
      await Promise.all(
        [...cleanupPaths].map(async (pathValue) => {
          try {
            await unlink(pathValue);
          } catch {
            // Ignore cleanup failures.
          }
        }),
      );
    }
  });

  app.post("/v1/audio/speech", async (ctx) => {
    const cleanupPaths = new Set<string>();

    try {
      let body: Record<string, unknown> = {};
      try {
        const bytes = await readBoundedRequestBody(ctx.req.raw, MAX_TTS_REQUEST_BYTES);
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        body = Schema.decodeUnknownSync(JsonObjectSchema)(parsed);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) throw error;
        body = {};
      }

      const input = typeof body["input"] === "string" ? body["input"].trim() : "";
      if (!input) {
        throw new TtsIntegrationError(
          400,
          "input_missing",
          "input is required and cannot be empty",
        );
      }

      const requestedFormat =
        typeof body["response_format"] === "string"
          ? body["response_format"].trim().toLowerCase()
          : "wav";
      if (requestedFormat !== "wav") {
        throw new TtsIntegrationError(
          400,
          "unsupported_response_format",
          "Only response_format='wav' is supported",
        );
      }

      const requestedModel = typeof body["model"] === "string" ? body["model"].trim() : "";
      if (requestedModel === CHATTERBOX_BACKEND) {
        const voiceId = typeof body["voice"] === "string" ? body["voice"].trim() : "";
        if (!voiceId) {
          throw new SpeechServiceError(
            400,
            "voice_required",
            "voice is required for Chatterbox speech",
          );
        }
        const output = await context.speechService.synthesize({ text: input, voiceId });
        const audio = new ArrayBuffer(output.audio.byteLength);
        new Uint8Array(audio).set(output.audio);
        return new Response(audio, {
          status: 200,
          headers: { "Content-Type": output.contentType },
        });
      }

      const mode = parseJsonMode(body["mode"]);
      const { modelPath } = resolveTtsModelPath(context, body["model"]);

      const conflict = await ensureServiceLease(context, mode, "tts");
      if (conflict) {
        return ctx.json(conflict, { status: 409 });
      }

      const temporaryDirectory = join(context.config.data_dir, ...AUDIO_TEMP_PATH_SEGMENTS);
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
      if (error instanceof RequestBodyTooLargeError) {
        return ctx.json(
          { code: "request_too_large", error: "Speech request exceeds 64 KB" },
          { status: 413 },
        );
      }
      if (error instanceof SpeechServiceError || error instanceof VoiceProfileError) {
        return Response.json({ code: error.code, error: error.message }, { status: error.status });
      }
      if (error instanceof TtsIntegrationError) {
        return ctx.json(
          {
            code: error.code,
            error: error.message,
            ...error.details,
          },
          { status: error.status },
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
        { status: 500 },
      );
    } finally {
      await Promise.all(
        [...cleanupPaths].map(async (pathValue) => {
          try {
            await unlink(pathValue);
          } catch {
            // Ignore cleanup failures.
          }
        }),
      );
    }
  });
};
