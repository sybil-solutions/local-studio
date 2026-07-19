import { Effect, Schema } from "effect";
import { resolveBinary, runCommandAsyncEffect } from "../core/command";

export type SttMode = "strict" | "best_effort";

export const SttTranscriptionRequestSchema = Schema.Struct({
  audioPath: Schema.String,
  modelPath: Schema.String,
  language: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
});

export type SttTranscriptionRequest = typeof SttTranscriptionRequestSchema.Type;

export interface SttTranscriptionResult {
  text: string;
  stdout: string;
  stderr: string;
}

export class SttIntegrationError extends Schema.TaggedErrorClass<SttIntegrationError>()(
  "SttIntegrationError",
  {
    status: Schema.Number,
    code: Schema.String,
    message: Schema.String,
    details: Schema.Record(Schema.String, Schema.Unknown),
  },
) {
  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super({ status, code, message, details });
  }
}

const DEFAULT_TIMEOUT_MS = 180_000;

const parseWhisperOutput = (stdout: string, stderr: string): string =>
  `${stdout}\n${stderr}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, ""))
    .filter((line) => {
      const lower = line.toLowerCase();
      if (lower.startsWith("main:")) return false;
      if (lower.startsWith("whisper_")) return false;
      if (lower.startsWith("system_info:")) return false;
      if (lower.startsWith("output ")) return false;
      if (lower.includes("samples, ") && lower.includes("thread")) return false;
      if (lower.includes("processing samples")) return false;
      if (lower.includes("failed to")) return false;
      return true;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const transcribeWithWhisperCpp = (
  request: SttTranscriptionRequest,
): Effect.Effect<SttTranscriptionResult, SttIntegrationError> =>
  Effect.gen(function* () {
    const configuredPath = process.env["LOCAL_STUDIO_STT_CLI"];
    const cliPath = configuredPath ? resolveBinary(configuredPath) : resolveBinary("whisper-cli");
    if (!cliPath) {
      return yield* Effect.fail(
        new SttIntegrationError(
          503,
          "stt_cli_missing",
          "STT CLI is not installed. Configure LOCAL_STUDIO_STT_CLI or install whisper-cli.",
          { configured_path: configuredPath ?? null, expected_binary: "whisper-cli" },
        ),
      );
    }
    const args = ["-m", request.modelPath, "-f", request.audioPath, "-nt"];
    if (request.language && request.language.trim().length > 0) {
      args.push("--language", request.language.trim());
    }
    const result = yield* runCommandAsyncEffect(cliPath, args, {
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    if (result.timedOut) {
      return yield* Effect.fail(
        new SttIntegrationError(504, "stt_timeout", "STT transcription timed out", {
          timeout_ms: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          stderr: result.stderr,
          stdout: result.stdout,
        }),
      );
    }
    if (result.status !== 0) {
      return yield* Effect.fail(
        new SttIntegrationError(502, "stt_cli_failed", "STT CLI exited with an error", {
          exit_code: result.status,
          signal: result.signal,
          stderr: result.stderr,
          stdout: result.stdout,
          command: cliPath,
          args,
        }),
      );
    }
    const text = parseWhisperOutput(result.stdout, result.stderr);
    if (!text) {
      return yield* Effect.fail(
        new SttIntegrationError(502, "stt_empty_result", "STT CLI returned empty transcript", {
          stderr: result.stderr,
          stdout: result.stdout,
        }),
      );
    }
    return { text, stdout: result.stdout, stderr: result.stderr };
  });

export const transcribeAudio = (
  input: SttTranscriptionRequest,
): Effect.Effect<SttTranscriptionResult, SttIntegrationError> =>
  Schema.decodeUnknownEffect(SttTranscriptionRequestSchema)(input).pipe(
    Effect.mapError(
      (source) =>
        new SttIntegrationError(400, "stt_request_invalid", "Invalid STT request", { source }),
    ),
    Effect.flatMap((request) => {
      const backend = (process.env["LOCAL_STUDIO_STT_BACKEND"] ?? "whispercpp").toLowerCase();
      if (backend === "whispercpp" || backend === "whisper.cpp") {
        return transcribeWithWhisperCpp(request);
      }
      return Effect.fail(
        new SttIntegrationError(400, "stt_backend_unsupported", "Unsupported STT backend", {
          backend,
          supported_backends: ["whispercpp"],
        }),
      );
    }),
  );
