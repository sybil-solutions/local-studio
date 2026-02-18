// CRITICAL
import { existsSync } from "node:fs";
import { resolveBinary } from "../../../core/command";
import { runCliCommand } from "../cli/cli-runner";
import type { TtsSynthesisRequest } from "./types";
import { TtsIntegrationError } from "./types";

const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Run piper CLI and synthesize a WAV output file.
 * @param request - TTS synthesis request.
 * @returns Nothing.
 */
export const synthesizeWithPiper = async (request: TtsSynthesisRequest): Promise<void> => {
  const configuredPath = process.env["VLLM_STUDIO_TTS_CLI"];
  const cliPath = configuredPath ? resolveBinary(configuredPath) : resolveBinary("piper");

  if (!cliPath) {
    throw new TtsIntegrationError(
      503,
      "tts_cli_missing",
      "TTS CLI is not installed. Configure VLLM_STUDIO_TTS_CLI or install piper.",
      {
        configured_path: configuredPath ?? null,
        expected_binary: "piper",
      }
    );
  }

  const result = await runCliCommand({
    command: cliPath,
    args: ["--model", request.modelPath, "--output_file", request.outputPath],
    timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    stdinText: request.text,
  });

  if (result.timedOut) {
    throw new TtsIntegrationError(504, "tts_timeout", "TTS synthesis timed out", {
      timeout_ms: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }

  if (result.exitCode !== 0) {
    throw new TtsIntegrationError(502, "tts_cli_failed", "TTS CLI exited with an error", {
      exit_code: result.exitCode,
      signal: result.signal,
      stderr: result.stderr,
      stdout: result.stdout,
      command: result.command,
      args: result.args,
    });
  }

  if (!existsSync(request.outputPath)) {
    throw new TtsIntegrationError(502, "tts_output_missing", "TTS CLI did not produce an output file", {
      output_path: request.outputPath,
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }
};
