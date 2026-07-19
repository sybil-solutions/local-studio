import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import type { Scope } from "effect";
import { CHATTERBOX_BACKEND } from "@local-studio/contracts/speech";
import type { AppContext } from "../../app-context";
import {
  boundedFormData,
  readBoundedRequestBody,
  RequestBodyTooLargeError,
} from "../../http/bounded-body";
import { effectHandler } from "../../http/effect-handler";
import { documentRoute, mergeRoutes, type ControllerRouteApp } from "../../http/route-registrar";
import { SttIntegrationError, transcribeAudio } from "../../services/stt";
import { synthesizeSpeech, TtsIntegrationError } from "../../services/tts";
import type { AudioRouteDependencies } from "./interfaces";
import { SpeechServiceError } from "../speech/service";
import { VoiceProfileError } from "../speech/voice-store";
import {
  defaultTranscodeToWav,
  ensureServiceLease,
  looksLikeWav,
  parseField,
  parseMode,
  resolveSttModelPath,
  resolveTtsModelPath,
} from "./helpers";

const AUDIO_TEMP_PATH_SEGMENTS = ["tmp", "audio"];
const MAX_STT_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_STT_REQUEST_BYTES = MAX_STT_UPLOAD_BYTES + 1024 * 1024;
const MAX_TTS_REQUEST_BYTES = 64 * 1024;

const TtsRequestSchema = Schema.Struct({
  input: Schema.String,
  response_format: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  voice: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.Literals(["strict", "best_effort"])),
});

class AudioFileError extends Schema.TaggedErrorClass<AudioFileError>()("AudioFileError", {
  operation: Schema.Literals(["mkdir", "read", "write"]),
  message: Schema.String,
  source: Schema.optional(Schema.Unknown),
}) {}

const temporaryPath = (path: string): Effect.Effect<string, never, Scope.Scope> =>
  Effect.acquireRelease(Effect.succeed(path), (target) =>
    Effect.tryPromise({ try: () => unlink(target), catch: () => null }).pipe(Effect.ignore),
  );

const audioErrorResponse = (
  context: AppContext,
  error: unknown,
  service: "stt" | "tts",
): Response => {
  if (error instanceof RequestBodyTooLargeError) {
    return Response.json(
      service === "stt"
        ? {
            code: "file_too_large",
            error: `Audio upload exceeds the ${Math.round(MAX_STT_UPLOAD_BYTES / (1024 * 1024))} MB limit`,
          }
        : { code: "request_too_large", error: "Speech request exceeds 64 KB" },
      { status: 413 },
    );
  }
  if (
    error instanceof SttIntegrationError ||
    error instanceof TtsIntegrationError ||
    error instanceof SpeechServiceError ||
    error instanceof VoiceProfileError
  ) {
    return Response.json(
      {
        code: error.code,
        error: error.message,
        ...(error instanceof SpeechServiceError || error instanceof VoiceProfileError
          ? {}
          : error.details),
      },
      { status: error.status },
    );
  }
  context.logger.error(`audio ${service} route failed`, { error: String(error) });
  return Response.json(
    {
      code: `${service}_internal_error`,
      error: `Internal ${service.toUpperCase()} error`,
      details: String(error),
    },
    { status: 500 },
  );
};

export const registerAudioRoutes = (
  app: ControllerRouteApp,
  context: AppContext,
  dependencies: AudioRouteDependencies = {},
): ControllerRouteApp => {
  const transcribe = dependencies.transcribe ?? transcribeAudio;
  const transcodeToWav = dependencies.transcodeToWav ?? defaultTranscodeToWav;
  const synthesize = dependencies.synthesize ?? synthesizeSpeech;

  return mergeRoutes(
    app.post(
      "/v1/audio/transcriptions",
      documentRoute,
      effectHandler((ctx) =>
        Effect.scoped(
          Effect.gen(function* () {
            const formData = yield* boundedFormData(ctx.req.raw, MAX_STT_REQUEST_BYTES).pipe(
              Effect.mapError((error) =>
                error instanceof RequestBodyTooLargeError
                  ? error
                  : new SttIntegrationError(
                      400,
                      "invalid_multipart",
                      "Request body must be multipart/form-data",
                    ),
              ),
            );
            const file = formData.get("file");
            if (!(file instanceof File)) {
              return yield* Effect.fail(
                new SttIntegrationError(400, "file_missing", "Multipart field 'file' is required"),
              );
            }
            if (file.size > MAX_STT_UPLOAD_BYTES) {
              return yield* Effect.fail(
                new SttIntegrationError(
                  413,
                  "file_too_large",
                  `Audio upload exceeds the ${Math.round(MAX_STT_UPLOAD_BYTES / (1024 * 1024))} MB limit`,
                ),
              );
            }
            const mode = yield* Effect.try({
              try: () => parseMode(formData.get("mode")),
              catch: (error) => error,
            });
            const language = parseField(formData.get("language"));
            const { modelPath } = yield* Effect.try({
              try: () => resolveSttModelPath(context, formData.get("model")),
              catch: (error) => error,
            });
            const conflict = yield* ensureServiceLease(context, mode, "stt");
            if (conflict) return ctx.json(conflict, { status: 409 });
            const directory = join(context.config.data_dir, ...AUDIO_TEMP_PATH_SEGMENTS);
            yield* Effect.tryPromise({
              try: () => mkdir(directory, { recursive: true }),
              catch: (source) =>
                new AudioFileError({
                  operation: "mkdir",
                  message: "Could not prepare audio storage",
                  source,
                }),
            });
            const uploadBuffer = yield* Effect.tryPromise({
              try: () => file.arrayBuffer(),
              catch: (source) =>
                new AudioFileError({ operation: "read", message: "Could not read upload", source }),
            }).pipe(Effect.map((bytes) => new Uint8Array(bytes)));
            const uploadPath = yield* temporaryPath(
              join(directory, `${randomUUID()}${extname(file.name || "") || ".bin"}`),
            );
            yield* Effect.tryPromise({
              try: () => writeFile(uploadPath, uploadBuffer),
              catch: (source) =>
                new AudioFileError({
                  operation: "write",
                  message: "Could not save upload",
                  source,
                }),
            });
            const audioPath = looksLikeWav(uploadBuffer)
              ? uploadPath
              : yield* Effect.gen(function* () {
                  const wavPath = yield* temporaryPath(join(directory, `${randomUUID()}.wav`));
                  return yield* transcodeToWav({ sourcePath: uploadPath, outputPath: wavPath });
                });
            const transcription = yield* transcribe({
              audioPath,
              modelPath,
              ...(language ? { language } : {}),
            });
            if (!transcription.text.trim()) {
              return yield* Effect.fail(
                new SttIntegrationError(
                  502,
                  "stt_empty_result",
                  "STT completed but returned an empty transcript",
                ),
              );
            }
            return ctx.json({ text: transcription.text });
          }),
        ).pipe(Effect.catch((error) => Effect.succeed(audioErrorResponse(context, error, "stt")))),
      ),
    ),

    app.post(
      "/v1/audio/speech",
      documentRoute,
      effectHandler((ctx) =>
        Effect.scoped(
          Effect.gen(function* () {
            const bytes = yield* readBoundedRequestBody(ctx.req.raw, MAX_TTS_REQUEST_BYTES);
            const body = yield* Effect.try({
              try: () => JSON.parse(new TextDecoder().decode(bytes)),
              catch: () => new TtsIntegrationError(400, "invalid_json", "Invalid speech request"),
            }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(TtsRequestSchema)));
            const input = body.input.trim();
            if (!input)
              return yield* Effect.fail(
                new TtsIntegrationError(
                  400,
                  "input_missing",
                  "input is required and cannot be empty",
                ),
              );
            const format = body.response_format?.trim().toLowerCase() ?? "wav";
            if (format !== "wav") {
              return yield* Effect.fail(
                new TtsIntegrationError(
                  400,
                  "unsupported_response_format",
                  "Only response_format='wav' is supported",
                ),
              );
            }
            if (body.model?.trim() === CHATTERBOX_BACKEND) {
              const voiceId = body.voice?.trim();
              if (!voiceId)
                return yield* Effect.fail(
                  new SpeechServiceError(
                    400,
                    "voice_required",
                    "voice is required for Chatterbox speech",
                  ),
                );
              const output = yield* context.speechService.synthesize({ text: input, voiceId });
              const responseAudio = new ArrayBuffer(output.audio.byteLength);
              new Uint8Array(responseAudio).set(output.audio);
              return new Response(responseAudio, {
                status: 200,
                headers: { "Content-Type": output.contentType },
              });
            }
            const mode = body.mode ?? "strict";
            const { modelPath } = yield* Effect.try({
              try: () => resolveTtsModelPath(context, body.model),
              catch: (error) => error,
            });
            const conflict = yield* ensureServiceLease(context, mode, "tts");
            if (conflict) return ctx.json(conflict, { status: 409 });
            const directory = join(context.config.data_dir, ...AUDIO_TEMP_PATH_SEGMENTS);
            yield* Effect.tryPromise({
              try: () => mkdir(directory, { recursive: true }),
              catch: (source) =>
                new AudioFileError({
                  operation: "mkdir",
                  message: "Could not prepare audio storage",
                  source,
                }),
            });
            const outputPath = yield* temporaryPath(join(directory, `${randomUUID()}.wav`));
            yield* synthesize({ text: input, modelPath, outputPath });
            const audio = yield* Effect.tryPromise({
              try: () => readFile(outputPath),
              catch: (source) =>
                new AudioFileError({
                  operation: "read",
                  message: "Could not read speech output",
                  source,
                }),
            });
            return new Response(new Uint8Array(audio), {
              status: 200,
              headers: { "Content-Type": "audio/wav" },
            });
          }),
        ).pipe(Effect.catch((error) => Effect.succeed(audioErrorResponse(context, error, "tts")))),
      ),
    ),
  );
};
