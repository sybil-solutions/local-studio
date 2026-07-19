import { existsSync } from "node:fs";
import { Effect, Schema } from "effect";
import { resolveBinary, runCommandAsyncEffect } from "../core/command";

export type TtsMode = "strict" | "best_effort";

export const TtsSynthesisRequestSchema = Schema.Struct({
  text: Schema.String,
  modelPath: Schema.String,
  outputPath: Schema.String,
  timeoutMs: Schema.optional(Schema.Number),
});

export type TtsSynthesisRequest = typeof TtsSynthesisRequestSchema.Type;

export class TtsIntegrationError extends Schema.TaggedErrorClass<TtsIntegrationError>()(
  "TtsIntegrationError",
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

const DEFAULT_TIMEOUT_MS = 300_000;

const synthesizeWithPiper = (
  request: TtsSynthesisRequest,
): Effect.Effect<void, TtsIntegrationError> =>
  Effect.gen(function* () {
    const configuredPath = process.env["LOCAL_STUDIO_TTS_CLI"];
    const cliPath = configuredPath ? resolveBinary(configuredPath) : resolveBinary("piper");
    if (!cliPath) {
      return yield* Effect.fail(
        new TtsIntegrationError(
          503,
          "tts_cli_missing",
          "TTS CLI is not installed. Configure LOCAL_STUDIO_TTS_CLI or install piper.",
          { configured_path: configuredPath ?? null, expected_binary: "piper" },
        ),
      );
    }
    const args = ["--model", request.modelPath, "--output_file", request.outputPath];
    const result = yield* runCommandAsyncEffect(cliPath, args, {
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      stdin: request.text,
    });
    if (result.timedOut) {
      return yield* Effect.fail(
        new TtsIntegrationError(504, "tts_timeout", "TTS synthesis timed out", {
          timeout_ms: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          stderr: result.stderr,
          stdout: result.stdout,
        }),
      );
    }
    if (result.status !== 0) {
      return yield* Effect.fail(
        new TtsIntegrationError(502, "tts_cli_failed", "TTS CLI exited with an error", {
          exit_code: result.status,
          signal: result.signal,
          stderr: result.stderr,
          stdout: result.stdout,
          command: cliPath,
          args,
        }),
      );
    }
    if (!existsSync(request.outputPath)) {
      return yield* Effect.fail(
        new TtsIntegrationError(
          502,
          "tts_output_missing",
          "TTS CLI did not produce an output file",
          {
            output_path: request.outputPath,
            stderr: result.stderr,
            stdout: result.stdout,
          },
        ),
      );
    }
  });

export const synthesizeSpeech = (
  input: TtsSynthesisRequest,
): Effect.Effect<void, TtsIntegrationError> =>
  Schema.decodeUnknownEffect(TtsSynthesisRequestSchema)(input).pipe(
    Effect.mapError(
      (source) =>
        new TtsIntegrationError(400, "tts_request_invalid", "Invalid TTS request", { source }),
    ),
    Effect.flatMap((request) => {
      const backend = (process.env["LOCAL_STUDIO_TTS_BACKEND"] ?? "piper").toLowerCase();
      return backend === "piper"
        ? synthesizeWithPiper(request)
        : Effect.fail(
            new TtsIntegrationError(400, "tts_backend_unsupported", "Unsupported TTS backend", {
              backend,
              supported_backends: ["piper"],
            }),
          );
    }),
  );
