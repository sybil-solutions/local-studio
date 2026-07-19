import { spawn } from "node:child_process";
import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import { resolveBinary } from "../../core/command";
import { secureSpeechDirectory } from "./storage";

export const MAX_VOICE_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_NORMALIZED_BYTES = 1_100_000;
const TRANSCODE_TIMEOUT_MS = 60_000;

export class VoiceReferenceError extends Schema.TaggedErrorClass<VoiceReferenceError>()(
  "VoiceReferenceError",
  { status: Schema.Number, code: Schema.String, message: Schema.String },
) {
  constructor(status: number, code: string, message: string) {
    super({ status, code, message });
  }
}

export interface NormalizedVoiceReference {
  audio: Uint8Array;
  durationMs: number;
}

type VoiceInputFormat = "aiff" | "caf" | "flac" | "matroska" | "mov" | "mp3" | "ogg" | "wav";

interface VoiceReferenceDependencies {
  ffmpegPath: () => string | null;
  transcode: (
    command: string,
    input: Uint8Array,
    format: VoiceInputFormat,
    output: string,
  ) => Effect.Effect<void, VoiceReferenceError>;
}

const FFMPEG_ARGS = [
  "-hide_banner",
  "-nostdin",
  "-y",
  "-v",
  "error",
  "-max_alloc",
  "67108864",
  "-protocol_whitelist",
  "pipe",
  "-probesize",
  "1048576",
  "-analyzeduration",
  "5000000",
] as const;

const transcode = (
  command: string,
  input: Uint8Array,
  format: VoiceInputFormat,
  output: string,
): Effect.Effect<void, VoiceReferenceError> =>
  Effect.callback<void, VoiceReferenceError>((resume) => {
    const child = spawn(
      command,
      [
        ...FFMPEG_ARGS,
        "-f",
        format,
        "-i",
        "pipe:0",
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-threads",
        "1",
        "-filter_threads",
        "1",
        "-ac",
        "1",
        "-ar",
        "24000",
        "-c:a",
        "pcm_s16le",
        "-t",
        "20.1",
        "-f",
        "wav",
        output,
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    let settled = false;
    const settle = (effect: Effect.Effect<void, VoiceReferenceError>): void => {
      if (settled) return;
      settled = true;
      resume(effect);
    };
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.once("error", () =>
      settle(
        Effect.fail(
          new VoiceReferenceError(503, "ffmpeg_unavailable", "FFmpeg could not be started"),
        ),
      ),
    );
    child.once("close", (code) =>
      settle(
        code === 0
          ? Effect.void
          : Effect.fail(
              new VoiceReferenceError(
                400,
                "voice_audio_invalid",
                "Voice reference could not be decoded",
              ),
            ),
      ),
    );
    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      child.stdin.destroy();
      child.kill("SIGKILL");
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: TRANSCODE_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          new VoiceReferenceError(504, "voice_decode_timeout", "Voice reference decode timed out"),
        ),
    }),
  );

const defaultDependencies: VoiceReferenceDependencies = {
  ffmpegPath: () => resolveBinary(process.env["LOCAL_STUDIO_FFMPEG_CLI"] ?? "ffmpeg"),
  transcode,
};

const ascii = (bytes: Buffer, offset: number): string =>
  bytes.subarray(offset, offset + 4).toString("ascii");

const detectedFormat = (input: Uint8Array): VoiceInputFormat => {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (ascii(bytes, 0) === "RIFF" && ascii(bytes, 8) === "WAVE") return "wav";
  if (ascii(bytes, 0) === "OggS") return "ogg";
  if (ascii(bytes, 0) === "fLaC") return "flac";
  if (ascii(bytes, 0) === "FORM" && ["AIFF", "AIFC"].includes(ascii(bytes, 8))) return "aiff";
  if (ascii(bytes, 0) === "caff") return "caf";
  if (ascii(bytes, 4) === "ftyp") return "mov";
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "matroska";
  if (bytes.subarray(0, 3).toString("ascii") === "ID3") return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return "mp3";
  throw new VoiceReferenceError(
    400,
    "voice_audio_invalid",
    "Voice reference must be WAV, WebM, Ogg, FLAC, MP3, AIFF, CAF, or MP4 audio",
  );
};

const wavDuration = (audio: Uint8Array): number => {
  const bytes = Buffer.from(audio);
  if (bytes.length < 44 || ascii(bytes, 0) !== "RIFF" || ascii(bytes, 8) !== "WAVE") {
    throw new VoiceReferenceError(400, "voice_audio_invalid", "Voice reference is not valid audio");
  }
  let byteRate = 0;
  let dataBytes = 0;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = ascii(bytes, offset);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) break;
    if (id === "fmt " && size >= 16) {
      const pcm = bytes.readUInt16LE(start) === 1;
      const mono = bytes.readUInt16LE(start + 2) === 1;
      const sampleRate = bytes.readUInt32LE(start + 4);
      byteRate = bytes.readUInt32LE(start + 8);
      const bits = bytes.readUInt16LE(start + 14);
      if (!pcm || !mono || sampleRate !== 24_000 || bits !== 16) byteRate = 0;
    }
    if (id === "data") dataBytes = size;
    offset = end + (size % 2);
  }
  if (!byteRate || !dataBytes) {
    throw new VoiceReferenceError(400, "voice_audio_invalid", "Voice reference is not valid audio");
  }
  return Math.round((dataBytes / byteRate) * 1000);
};

const storageError = (error: unknown): VoiceReferenceError =>
  new VoiceReferenceError(500, "voice_storage_failed", String(error));

export const normalizeVoiceReference = (
  input: Uint8Array,
  dataDirectory: string,
  dependencies: VoiceReferenceDependencies = defaultDependencies,
): Effect.Effect<NormalizedVoiceReference, VoiceReferenceError> =>
  Effect.gen(function* () {
    if (!input.length) {
      return yield* Effect.fail(
        new VoiceReferenceError(400, "voice_audio_invalid", "Voice reference is empty"),
      );
    }
    if (input.length > MAX_VOICE_UPLOAD_BYTES) {
      return yield* Effect.fail(
        new VoiceReferenceError(
          413,
          "voice_audio_too_large",
          `Voice reference must be smaller than ${MAX_VOICE_UPLOAD_BYTES / 1024 / 1024} MB`,
        ),
      );
    }
    const format = yield* Effect.try({
      try: () => detectedFormat(input),
      catch: (error) =>
        error instanceof VoiceReferenceError
          ? error
          : new VoiceReferenceError(400, "voice_audio_invalid", String(error)),
    });
    const ffmpeg = dependencies.ffmpegPath();
    if (!ffmpeg) {
      return yield* Effect.fail(
        new VoiceReferenceError(
          503,
          "ffmpeg_missing",
          "FFmpeg is required to create a voice profile",
        ),
      );
    }
    const directory = join(dataDirectory, "runtime", "speech", "uploads");
    const output = join(directory, `${randomUUID()}.wav`);
    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: async () => {
          secureSpeechDirectory(directory);
          await writeFile(output, new Uint8Array(), { mode: 0o600, flag: "wx" });
          return output;
        },
        catch: storageError,
      }),
      (path) =>
        Effect.gen(function* () {
          yield* dependencies.transcode(ffmpeg, input, format, path);
          const audio = yield* Effect.tryPromise({
            try: async () => {
              await chmod(path, 0o600);
              return readFile(path);
            },
            catch: storageError,
          });
          if (audio.length > MAX_NORMALIZED_BYTES) {
            return yield* Effect.fail(
              new VoiceReferenceError(400, "voice_audio_invalid", "Voice reference is too long"),
            );
          }
          const durationMs = yield* Effect.try({
            try: () => wavDuration(audio),
            catch: (error) =>
              error instanceof VoiceReferenceError
                ? error
                : new VoiceReferenceError(400, "voice_audio_invalid", String(error)),
          });
          if (durationMs < 6_000 || durationMs > 20_000) {
            return yield* Effect.fail(
              new VoiceReferenceError(
                400,
                "voice_duration_invalid",
                "Voice reference must be 6 to 20 seconds",
              ),
            );
          }
          return { audio, durationMs };
        }),
      (path) =>
        Effect.tryPromise({ try: () => unlink(path), catch: () => undefined }).pipe(Effect.ignore),
    );
  });
