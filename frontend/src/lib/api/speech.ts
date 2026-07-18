import { Schema } from "effect";
import {
  CHATTERBOX_BACKEND,
  CHATTERBOX_MODEL_REVISION,
  CHATTERBOX_PACKAGE_VERSION,
  type SpeechStatus,
  type SpeechVoiceProfile,
} from "@local-studio/contracts/speech";
import type { ApiCore } from "./core";

const SpeechInstallPhaseSchema = Schema.Union([
  Schema.Literal("missing"),
  Schema.Literal("installing"),
  Schema.Literal("ready"),
  Schema.Literal("failed"),
]);

const SpeechWorkerPhaseSchema = Schema.Union([
  Schema.Literal("stopped"),
  Schema.Literal("starting"),
  Schema.Literal("ready"),
  Schema.Literal("busy"),
  Schema.Literal("failed"),
]);

export const SpeechVoiceProfileSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  duration_ms: Schema.Number,
  created_at: Schema.String,
});

export const SpeechStatusSchema = Schema.Struct({
  backend: Schema.Literal(CHATTERBOX_BACKEND),
  package_version: Schema.Literal(CHATTERBOX_PACKAGE_VERSION),
  model_revision: Schema.Literal(CHATTERBOX_MODEL_REVISION),
  install: Schema.Struct({
    phase: SpeechInstallPhaseSchema,
    progress: Schema.Number,
    message: Schema.String,
    error: Schema.NullOr(Schema.String),
  }),
  worker: Schema.Struct({
    phase: SpeechWorkerPhaseSchema,
    queue_depth: Schema.Number,
    error: Schema.NullOr(Schema.String),
  }),
  gpu: Schema.NullOr(
    Schema.Struct({
      uuid: Schema.String,
      name: Schema.String,
      pci_bus_id: Schema.optional(Schema.String),
    }),
  ),
  prerequisites: Schema.Struct({
    ffmpeg: Schema.Boolean,
    python_311: Schema.Boolean,
    storage: Schema.Struct({
      available_bytes: Schema.NullOr(Schema.Number),
      required_bytes: Schema.Number,
      ready: Schema.Boolean,
    }),
  }),
  voice_count: Schema.Number,
});

const SpeechStatusResponseSchema = Schema.Struct({ status: SpeechStatusSchema });
const SpeechVoicesResponseSchema = Schema.Struct({
  voices: Schema.Array(SpeechVoiceProfileSchema),
});
const SpeechVoiceResponseSchema = Schema.Struct({ voice: SpeechVoiceProfileSchema });
const ErrorResponseSchema = Schema.Struct({
  code: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_TRANSCRIPTION_BYTES = 100 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
const VOICE_UPLOAD_TIMEOUT_MS = 130_000;
const TRANSCRIPTION_TIMEOUT_MS = 130_000;
const SPEECH_PREVIEW_TIMEOUT_MS = 370_000;

export class SpeechApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "SpeechApiError";
  }
}

function decodeStatus(input: unknown): SpeechStatus {
  return Schema.decodeUnknownSync(SpeechStatusResponseSchema)(input).status;
}

function decodeVoices(input: unknown): readonly SpeechVoiceProfile[] {
  return Schema.decodeUnknownSync(SpeechVoicesResponseSchema)(input).voices;
}

function decodeVoice(input: unknown): SpeechVoiceProfile {
  return Schema.decodeUnknownSync(SpeechVoiceResponseSchema)(input).voice;
}

function responseError(input: unknown, status: number): Error {
  try {
    const body = Schema.decodeUnknownSync(ErrorResponseSchema)(input);
    return new SpeechApiError(
      status,
      body.code ?? null,
      body.error ?? body.detail ?? body.message ?? `Request failed (${status})`,
    );
  } catch {
    return new SpeechApiError(status, null, `Request failed (${status})`);
  }
}

async function checkedResponse(response: Response): Promise<Response> {
  if (response.ok) return response;
  const body: unknown = await response.json().catch(() => null);
  throw responseError(body, response.status);
}

async function statusResponse(response: Response): Promise<SpeechStatus> {
  return decodeStatus(await (await checkedResponse(response)).json());
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    return await fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`${label} timed out`);
    }
    throw error;
  }
}

function multipartHeaders(core: ApiCore): Record<string, string> {
  const headers = core.buildHeaders();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "content-type") delete headers[key];
  }
  return headers;
}

async function readBoundedAudio(response: Response): Promise<Blob> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_PREVIEW_BYTES) {
    throw new Error("Speech preview exceeded the 20 MB response limit");
  }
  if (!response.body) throw new Error("Speech preview returned no audio");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > MAX_PREVIEW_BYTES) {
      await reader.cancel();
      throw new Error("Speech preview exceeded the 20 MB response limit");
    }
    chunks.push(result.value);
  }
  if (size < 44) throw new Error("Speech preview returned invalid WAV audio");
  const buffer = new ArrayBuffer(size);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const signature = String.fromCharCode(...bytes.subarray(0, 4));
  const format = String.fromCharCode(...bytes.subarray(8, 12));
  if (signature !== "RIFF" || format !== "WAVE") {
    throw new Error("Speech preview returned invalid WAV audio");
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function createSpeechApi(core: ApiCore) {
  return {
    transcribeAudio: async (input: { recording: File; signal?: AbortSignal }): Promise<string> => {
      if (!input.recording.size) throw new Error("Recording is empty");
      if (input.recording.size > MAX_TRANSCRIPTION_BYTES) {
        throw new Error("Recording must be 100 MB or smaller");
      }
      const form = new FormData();
      form.set("file", input.recording, input.recording.name);
      form.set("mode", "best_effort");
      const response = await checkedResponse(
        await timedFetch(
          core.buildUrl("/v1/audio/transcriptions"),
          {
            method: "POST",
            headers: multipartHeaders(core),
            body: form,
            credentials: "include",
          },
          TRANSCRIPTION_TIMEOUT_MS,
          "Audio transcription",
          input.signal,
        ),
      );
      const payload = (await response.json()) as { text?: unknown };
      if (typeof payload.text !== "string" || !payload.text.trim()) {
        throw new Error("Transcription returned no text");
      }
      return payload.text.trim();
    },
    getSpeechStatus: async (): Promise<SpeechStatus> =>
      decodeStatus(
        await core.request<unknown>("/v1/audio/status", {
          cache: "no-store",
          retries: 0,
        }),
      ),
    installSpeechRuntime: async (
      input: {
        repair?: boolean;
        signal?: AbortSignal;
      } = {},
    ): Promise<SpeechStatus> =>
      statusResponse(
        await timedFetch(
          core.buildUrl("/v1/audio/install"),
          {
            method: "POST",
            headers: core.buildHeaders(),
            body: JSON.stringify({ repair: input.repair ?? false }),
            credentials: "include",
          },
          25_000,
          "Voice runtime setup",
          input.signal,
        ),
      ),
    listSpeechVoices: async (): Promise<readonly SpeechVoiceProfile[]> =>
      decodeVoices(
        await core.request<unknown>("/v1/audio/voices", {
          cache: "no-store",
          retries: 0,
        }),
      ),
    createSpeechVoice: async (input: {
      name: string;
      consent: "self_voice_v1";
      reference: File;
      signal?: AbortSignal;
    }): Promise<SpeechVoiceProfile> => {
      if (!input.reference.size) throw new Error("Voice reference is empty");
      if (input.reference.size > MAX_REFERENCE_BYTES) {
        throw new Error("Voice reference must be 20 MB or smaller");
      }
      const form = new FormData();
      form.set("name", input.name);
      form.set("consent", input.consent);
      form.set("reference", input.reference, input.reference.name);
      const response = await checkedResponse(
        await timedFetch(
          core.buildUrl("/v1/audio/voices"),
          {
            method: "POST",
            headers: multipartHeaders(core),
            body: form,
            credentials: "include",
          },
          VOICE_UPLOAD_TIMEOUT_MS,
          "Voice reference upload",
          input.signal,
        ),
      );
      return decodeVoice(await response.json());
    },
    deleteSpeechVoice: async (voiceId: string, signal?: AbortSignal): Promise<void> => {
      await checkedResponse(
        await timedFetch(
          core.buildUrl(`/v1/audio/voices/${encodeURIComponent(voiceId)}`),
          { method: "DELETE", headers: core.buildHeaders(), credentials: "include" },
          15_000,
          "Voice profile deletion",
          signal,
        ),
      );
    },
    synthesizeSpeechPreview: async (input: {
      text: string;
      voiceId: string;
      signal?: AbortSignal;
    }): Promise<Blob> => {
      const response = await checkedResponse(
        await timedFetch(
          core.buildUrl("/v1/audio/speech"),
          {
            method: "POST",
            headers: core.buildHeaders({ Accept: "audio/wav" }),
            body: JSON.stringify({
              model: CHATTERBOX_BACKEND,
              input: input.text,
              voice: input.voiceId,
              response_format: "wav",
            }),
            credentials: "include",
          },
          SPEECH_PREVIEW_TIMEOUT_MS,
          "Speech preview",
          input.signal,
        ),
      );
      return readBoundedAudio(response);
    },
    cancelSpeechInstall: async (signal?: AbortSignal): Promise<SpeechStatus> =>
      statusResponse(
        await timedFetch(
          core.buildUrl("/v1/audio/install/cancel"),
          { method: "POST", headers: core.buildHeaders(), credentials: "include" },
          25_000,
          "Voice runtime cancellation",
          signal,
        ),
      ),
    stopSpeechRuntime: async (signal?: AbortSignal): Promise<SpeechStatus> =>
      statusResponse(
        await timedFetch(
          core.buildUrl("/v1/audio/runtime/stop"),
          { method: "POST", headers: core.buildHeaders(), credentials: "include" },
          25_000,
          "Voice engine stop",
          signal,
        ),
      ),
  };
}
