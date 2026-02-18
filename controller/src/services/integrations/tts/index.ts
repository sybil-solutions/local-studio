import { synthesizeWithPiper } from "./piper-adapter";
import type { TtsSynthesisRequest } from "./types";
import { TtsIntegrationError } from "./types";

/**
 * Run TTS synthesis using the configured backend.
 * @param request - TTS synthesis request.
 * @returns Nothing.
 */
export const synthesizeSpeech = async (request: TtsSynthesisRequest): Promise<void> => {
  const backend = (process.env["VLLM_STUDIO_TTS_BACKEND"] ?? "piper").toLowerCase();

  if (backend === "piper") {
    await synthesizeWithPiper(request);
    return;
  }

  throw new TtsIntegrationError(400, "tts_backend_unsupported", "Unsupported TTS backend", {
    backend,
    supported_backends: ["piper"],
  });
};

export type { TtsMode, TtsSynthesisRequest } from "./types";
export { TtsIntegrationError } from "./types";
