import { transcribeWithWhisperCpp } from "./whispercpp-adapter";
import type { SttTranscriptionRequest, SttTranscriptionResult } from "./types";
import { SttIntegrationError } from "./types";

export const transcribeAudio = async (
  request: SttTranscriptionRequest
): Promise<SttTranscriptionResult> => {
  const backend = (process.env["VLLM_STUDIO_STT_BACKEND"] ?? "whispercpp").toLowerCase();

  if (backend === "whispercpp" || backend === "whisper.cpp") {
    return transcribeWithWhisperCpp(request);
  }

  throw new SttIntegrationError(400, "stt_backend_unsupported", "Unsupported STT backend", {
    backend,
    supported_backends: ["whispercpp"],
  });
};

export type { SttMode, SttTranscriptionRequest, SttTranscriptionResult } from "./types";
export { SttIntegrationError } from "./types";
