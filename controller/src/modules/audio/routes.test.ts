// CRITICAL
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import type { AppContext } from "../../types/context";
import { SttIntegrationError } from "../../services/integrations/stt";
import { TtsIntegrationError } from "../../services/integrations/tts";
import type { ProcessInfo } from "../lifecycle/types";
import { registerAudioRoutes } from "./routes";

const createWavBytes = (): Buffer =>
  Buffer.from([
    ...Buffer.from("RIFF"),
    0,
    0,
    0,
    0,
    ...Buffer.from("WAVE"),
    0,
    0,
    0,
    0,
  ]);

const createWavFile = (): File => {
  const bytes = createWavBytes();
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new File([arrayBuffer], "recording.wav", { type: "audio/wav" });
};

describe("audio routes", () => {
  let app: Hono;
  let temporaryRoot: string;
  let sttModelPath: string;
  let ttsModelPath: string;

  const findInferenceProcess = mock(async (): Promise<ProcessInfo | null> => null);
  const evictModel = mock(async () => null);
  const transcribe = mock(async () => ({ text: "hello world", stdout: "", stderr: "" }));
  const transcodeToWav = mock(async ({ outputPath }: { outputPath: string }) => outputPath);
  const synthesize = mock(async ({ outputPath }: { outputPath: string }) => {
    await writeFile(outputPath, createWavBytes());
  });

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "vllm-studio-audio-routes-"));

    const sttModelsDirectory = join(temporaryRoot, "models", "stt");
    const ttsModelsDirectory = join(temporaryRoot, "models", "tts");
    await mkdir(sttModelsDirectory, { recursive: true });
    await mkdir(ttsModelsDirectory, { recursive: true });

    sttModelPath = join(sttModelsDirectory, "tiny.en.bin");
    ttsModelPath = join(ttsModelsDirectory, "en_US-amy-medium.onnx");
    await writeFile(sttModelPath, "stub-stt-model");
    await writeFile(ttsModelPath, "stub-tts-model");

    findInferenceProcess.mockReset();
    evictModel.mockReset();
    transcribe.mockReset();
    transcodeToWav.mockReset();
    synthesize.mockReset();

    findInferenceProcess.mockImplementation(async () => null);
    evictModel.mockImplementation(async () => null);
    transcribe.mockImplementation(async () => ({ text: "hello world", stdout: "", stderr: "" }));
    transcodeToWav.mockImplementation(async ({ outputPath }: { outputPath: string }) => outputPath);
    synthesize.mockImplementation(async ({ outputPath }: { outputPath: string }) => {
      await writeFile(outputPath, createWavBytes());
    });

    process.env["VLLM_STUDIO_STT_MODEL"] = "";
    process.env["VLLM_STUDIO_TTS_MODEL"] = "";

    app = new Hono();
    const context = {
      config: {
        host: "127.0.0.1",
        port: 8080,
        inference_port: 8000,
        data_dir: temporaryRoot,
        db_path: join(temporaryRoot, "controller.db"),
        models_dir: join(temporaryRoot, "models"),
      },
      logger: {
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
        debug: mock(() => undefined),
      },
      processManager: {
        findInferenceProcess,
        evictModel,
      },
    } as unknown as AppContext;

    registerAudioRoutes(app, context, {
      transcribe,
      transcodeToWav,
      synthesize,
    });
  });

  afterEach(async () => {
    delete process.env["VLLM_STUDIO_STT_MODEL"];
    delete process.env["VLLM_STUDIO_TTS_MODEL"];
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("returns 400 when STT file is missing", async () => {
    const form = new FormData();
    form.set("model", sttModelPath);

    const response = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe("file_missing");
  });

  it("returns 400 when STT model is missing after fallback resolution", async () => {
    const form = new FormData();
    form.set("file", createWavFile());

    const response = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe("model_missing");
  });

  it("returns 400 when resolved STT model path does not exist", async () => {
    const form = new FormData();
    form.set("file", createWavFile());
    form.set("model", "missing-model.bin");

    const response = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe("model_not_found");
  });

  it("returns STT lease conflict payload for strict mode", async () => {
    findInferenceProcess.mockImplementation(async () => ({
      pid: 42,
      backend: "vllm",
      model_path: "/models/qwen",
      port: 8000,
      served_model_name: "qwen",
    }));

    const form = new FormData();
    form.set("file", createWavFile());
    form.set("model", sttModelPath);

    const response = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.code).toBe("gpu_lease_conflict");
    expect(json.actions).toEqual(["replace", "best_effort"]);
  });

  it("evicts STT lease holder when replace=1 is passed", async () => {
    findInferenceProcess.mockImplementation(async () => ({
      pid: 42,
      backend: "vllm",
      model_path: "/models/qwen",
      port: 8000,
      served_model_name: "qwen",
    }));

    const form = new FormData();
    form.set("file", createWavFile());
    form.set("model", sttModelPath);
    form.set("replace", "1");

    const response = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(200);
    expect(evictModel).toHaveBeenCalledTimes(1);
  });

  it("returns transcription payload on STT success", async () => {
    const form = new FormData();
    form.set("file", createWavFile());
    form.set("model", sttModelPath);

    const response = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ text: "hello world" });
  });

  it("transcodes non-wav STT uploads before transcription", async () => {
    const blob = new Blob(["webm-bytes"], { type: "audio/webm" });
    const form = new FormData();
    form.set("file", blob, "recording.webm");
    form.set("model", sttModelPath);

    const response = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(200);
    expect(transcodeToWav).toHaveBeenCalledTimes(1);
  });

  it("surfaces STT transcode dependency errors", async () => {
    transcodeToWav.mockImplementation(async () => {
      throw new SttIntegrationError(503, "ffmpeg_missing", "Install ffmpeg");
    });

    const blob = new Blob(["webm-bytes"], { type: "audio/webm" });
    const form = new FormData();
    form.set("file", blob, "recording.webm");
    form.set("model", sttModelPath);

    const response = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.code).toBe("ffmpeg_missing");
  });

  it("returns 400 when TTS input is missing", async () => {
    const response = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: ttsModelPath, response_format: "wav" }),
    });

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe("input_missing");
  });

  it("returns 400 for unsupported TTS response formats", async () => {
    const response = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ttsModelPath,
        input: "hello",
        response_format: "mp3",
      }),
    });

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe("unsupported_response_format");
  });

  it("returns 400 when TTS model is missing", async () => {
    const response = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "hello", response_format: "wav" }),
    });

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe("model_missing");
  });

  it("returns TTS lease conflict payload for strict mode", async () => {
    findInferenceProcess.mockImplementation(async () => ({
      pid: 42,
      backend: "vllm",
      model_path: "/models/qwen",
      port: 8000,
      served_model_name: "qwen",
    }));

    const response = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ttsModelPath,
        input: "hello",
        response_format: "wav",
      }),
    });

    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.code).toBe("gpu_lease_conflict");
    expect(json.requested_service).toEqual({ id: "tts" });
    expect(json.actions).toEqual(["replace", "best_effort"]);
  });

  it("surfaces missing TTS binary/dependency errors", async () => {
    synthesize.mockImplementation(async () => {
      throw new TtsIntegrationError(503, "tts_cli_missing", "Install piper");
    });

    const response = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ttsModelPath,
        input: "hello",
        response_format: "wav",
      }),
    });

    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.code).toBe("tts_cli_missing");
  });

  it("returns WAV audio payload on TTS success", async () => {
    const response = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ttsModelPath,
        input: "hello",
        response_format: "wav",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
  });
});
