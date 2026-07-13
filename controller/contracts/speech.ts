export const CHATTERBOX_BACKEND = "chatterbox-turbo";
export const CHATTERBOX_PACKAGE_VERSION = "0.1.7";
export const CHATTERBOX_MODEL_REVISION = "749d1c1a46eb10492095d68fbcf55691ccf137cd";

export type SpeechInstallPhase = "missing" | "installing" | "ready" | "failed";
export type SpeechWorkerPhase = "stopped" | "starting" | "ready" | "busy" | "failed";

export interface SpeechGpuTarget {
  uuid: string;
  name: string;
  pci_bus_id?: string;
}

export interface SpeechVoiceProfile {
  id: string;
  name: string;
  duration_ms: number;
  created_at: string;
}

export interface SpeechStatus {
  backend: typeof CHATTERBOX_BACKEND;
  package_version: typeof CHATTERBOX_PACKAGE_VERSION;
  model_revision: typeof CHATTERBOX_MODEL_REVISION;
  install: {
    phase: SpeechInstallPhase;
    progress: number;
    message: string;
    error: string | null;
  };
  worker: {
    phase: SpeechWorkerPhase;
    queue_depth: number;
    error: string | null;
  };
  gpu: SpeechGpuTarget | null;
  prerequisites: {
    ffmpeg: boolean;
    python_311: boolean;
    storage: {
      available_bytes: number | null;
      required_bytes: number;
      ready: boolean;
    };
  };
  voice_count: number;
}
