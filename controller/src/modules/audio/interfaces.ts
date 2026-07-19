import type { Effect } from "effect";
import type { SttTranscriptionResult } from "../../services/stt";
import type { SttIntegrationError } from "../../services/stt";
import type { TtsSynthesisRequest } from "../../services/tts";
import type { TtsIntegrationError } from "../../services/tts";

export interface AudioRouteDependencies {
  transcribe?: (request: {
    audioPath: string;
    modelPath: string;
    language?: string;
  }) => Effect.Effect<SttTranscriptionResult, SttIntegrationError>;
  transcodeToWav?: (options: {
    sourcePath: string;
    outputPath: string;
  }) => Effect.Effect<string, SttIntegrationError>;
  synthesize?: (request: TtsSynthesisRequest) => Effect.Effect<void, TtsIntegrationError>;
}
