// CRITICAL
import { resolveBinary } from "../../../core/command";
import { runCliCommand } from "../cli/cli-runner";
import type { SttTranscriptionRequest, SttTranscriptionResult } from "./types";
import { SttIntegrationError } from "./types";

const DEFAULT_TIMEOUT_MS = 180_000;

const parseWhisperOutput = (stdout: string, stderr: string): string => {
  const lines = `${stdout}\n${stderr}`
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
    });

  return lines.join(" ").replace(/\s+/g, " ").trim();
};

/**
 * Run whisper.cpp CLI and parse transcript output.
 * @param request - STT transcription request.
 * @returns Transcript text and raw CLI output.
 */
export const transcribeWithWhisperCpp = async (
  request: SttTranscriptionRequest
): Promise<SttTranscriptionResult> => {
  const configuredPath = process.env["VLLM_STUDIO_STT_CLI"];
  const cliPath = configuredPath ? resolveBinary(configuredPath) : resolveBinary("whisper-cli");

  if (!cliPath) {
    throw new SttIntegrationError(
      503,
      "stt_cli_missing",
      "STT CLI is not installed. Configure VLLM_STUDIO_STT_CLI or install whisper-cli.",
      {
        configured_path: configuredPath ?? null,
        expected_binary: "whisper-cli",
      }
    );
  }

  const args = ["-m", request.modelPath, "-f", request.audioPath, "-nt"];
  if (request.language && request.language.trim().length > 0) {
    args.push("--language", request.language.trim());
  }

  const result = await runCliCommand({
    command: cliPath,
    args,
    timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  if (result.timedOut) {
    throw new SttIntegrationError(504, "stt_timeout", "STT transcription timed out", {
      timeout_ms: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }

  if (result.exitCode !== 0) {
    throw new SttIntegrationError(502, "stt_cli_failed", "STT CLI exited with an error", {
      exit_code: result.exitCode,
      signal: result.signal,
      stderr: result.stderr,
      stdout: result.stdout,
      command: result.command,
      args: result.args,
    });
  }

  const text = parseWhisperOutput(result.stdout, result.stderr);
  if (!text) {
    throw new SttIntegrationError(502, "stt_empty_result", "STT CLI returned empty transcript", {
      stderr: result.stderr,
      stdout: result.stdout,
    });
  }

  return {
    text,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};
