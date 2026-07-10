import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createTestApp,
  readControllerFunctionCallRows,
  readControllerRequestRows,
  registerControllerTestLifecycle,
  tempDir,
} from "./fixtures";

registerControllerTestLifecycle();

describe("controller route contracts", () => {
  test("vram calculator rejects malformed requests with structured errors", async () => {
    const app = await createTestApp();
    const response = await app.request("/vram-calculator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context_length: 0 }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.detail).toBe("model is required");
  });

  test("vram calculator estimates a single-file gguf model", async () => {
    const app = await createTestApp();
    const modelsDirectory = join(tempDir, "models");
    mkdirSync(modelsDirectory, { recursive: true });
    const ggufPath = join(modelsDirectory, "tiny.gguf");
    writeFileSync(ggufPath, Buffer.alloc(4 * 1024 * 1024));

    const response = await app.request("/vram-calculator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: ggufPath, context_length: 2048 }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.model_size_gb).toBeCloseTo(4 / 1024, 5);
    expect(body.total_gb).toBeGreaterThan(0);
    expect(typeof body.fits_in_vram).toBe("boolean");
  });

  test("system introspection routes expose stable contracts and observability", async () => {
    const app = await createTestApp();

    const gpusResponse = await app.request("/gpus");
    const gpusBody = await gpusResponse.json();
    expect(gpusResponse.status).toBe(200);
    expect(typeof gpusBody.count).toBe("number");
    expect(Array.isArray(gpusBody.gpus)).toBe(true);
    expect(gpusBody.count).toBe(gpusBody.gpus.length);

    const compatResponse = await app.request("/compat");
    const compatBody = await compatResponse.json();
    expect(compatResponse.status).toBe(200);
    expect(compatBody.platform).toEqual(expect.objectContaining({ kind: expect.any(String) }));
    expect(compatBody.gpu_monitoring).toEqual(
      expect.objectContaining({ available: expect.any(Boolean) }),
    );
    expect(compatBody.backends).toEqual(expect.any(Object));
    expect(Array.isArray(compatBody.checks)).toBe(true);

    const configResponse = await app.request("/config");
    const configBody = await configResponse.json();
    expect(configResponse.status).toBe(200);
    expect(configBody.config).toMatchObject({
      host: "127.0.0.1",
      port: 18080,
      inference_port: 65534,
      api_key_configured: false,
      models_dir: process.env.LOCAL_STUDIO_MODELS_DIR,
      data_dir: tempDir,
      db_path: join(tempDir, "controller.db"),
    });
    expect(configBody.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Controller", status: "running" }),
        expect.objectContaining({
          name: "Inference runtime",
          status: "stopped",
        }),
        expect.objectContaining({ name: "Frontend" }),
      ]),
    );
    expect(configBody.environment).toEqual(
      expect.objectContaining({
        controller_url: expect.any(String),
        inference_url: expect.any(String),
        frontend_url: expect.any(String),
      }),
    );
    expect(configBody.environment).not.toHaveProperty("litellm_url");
    expect(configBody.runtime).toEqual(expect.any(Object));

    const specResponse = await app.request("/api/spec");
    const specBody = await specResponse.json();
    expect(specResponse.status).toBe(200);
    expect(specBody).toMatchObject({
      openapi: "3.1.0",
      info: { title: "Local Studio API" },
    });
    expect(specBody.paths).toEqual(
      expect.objectContaining({
        "/status": expect.any(Object),
        "/config": expect.any(Object),
        "/compat": expect.any(Object),
      }),
    );

    const docsResponse = await app.request("/api/docs");
    const docsText = await docsResponse.text();
    expect(docsResponse.status).toBe(200);
    expect(docsText).toContain("/api/spec");

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/gpus",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/compat",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/config",
          status: 200,
          success: 1,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "compat.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "config.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  }, 30_000);

  test("studio settings and provider CRUD routes persist observable contracts", async () => {
    const app = await createTestApp();

    const settingsResponse = await app.request("/studio/settings");
    const settingsBody = await settingsResponse.json();
    expect(settingsResponse.status).toBe(200);
    expect(settingsBody.effective.models_dir).toBe(process.env.LOCAL_STUDIO_MODELS_DIR);

    const settingsUpdateResponse = await app.request("/studio/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ui_preferences: { theme: "midnight" } }),
    });
    const settingsUpdateBody = await settingsUpdateResponse.json();
    expect(settingsUpdateResponse.status).toBe(200);
    expect(settingsUpdateBody).toMatchObject({
      success: true,
      persisted: { ui_preferences: { theme: "midnight" } },
    });

    const providersResponse = await app.request("/studio/providers");
    const providersBody = await providersResponse.json();
    expect(providersResponse.status).toBe(200);
    expect(providersBody.providers).toEqual([]);

    const createProviderResponse = await app.request("/studio/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "local",
        name: "Local Provider",
        base_url: "http://127.0.0.1:8000",
        api_key: "secret-token",
        enabled: true,
      }),
    });
    const createProviderBody = await createProviderResponse.json();
    expect(createProviderResponse.status).toBe(200);
    expect(createProviderBody.provider).toEqual({
      id: "local",
      name: "Local Provider",
      base_url: "http://127.0.0.1:8000",
      enabled: true,
      has_api_key: true,
    });
    expect(createProviderBody.provider.api_key).toBeUndefined();

    const updateProviderResponse = await app.request("/studio/providers/local", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Local Provider Updated",
        base_url: "http://127.0.0.1:9000",
        enabled: false,
      }),
    });
    const updateProviderBody = await updateProviderResponse.json();
    expect(updateProviderResponse.status).toBe(200);
    expect(updateProviderBody.provider).toMatchObject({
      id: "local",
      name: "Local Provider Updated",
      base_url: "http://127.0.0.1:9000",
      enabled: false,
      has_api_key: true,
    });

    const deleteProviderResponse = await app.request("/studio/providers/local", {
      method: "DELETE",
    });
    const deleteProviderBody = await deleteProviderResponse.json();
    expect(deleteProviderResponse.status).toBe(200);
    expect(deleteProviderBody).toEqual({ success: true });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/studio/settings",
          status: 200,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/settings",
          status: 200,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/studio/providers",
          status: 200,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/providers",
          status: 200,
        }),
        expect.objectContaining({
          method: "PUT",
          path: "/studio/providers/local",
          status: 200,
        }),
        expect.objectContaining({
          method: "DELETE",
          path: "/studio/providers/local",
          status: 200,
        }),
      ]),
    );
    expect(rows.every((row) => row.success === 1)).toBe(true);
  });

  test("studio operational routes expose storage contracts and validate model file actions", async () => {
    const modelsDir = process.env.LOCAL_STUDIO_MODELS_DIR;
    if (!modelsDir) throw new Error("LOCAL_STUDIO_MODELS_DIR is required for tests");
    const modelPath = join(modelsDir, "studio-route-model");
    const targetRoot = join(modelsDir, "archive");
    const movedModelPath = join(targetRoot, "studio-route-model");
    mkdirSync(modelPath, { recursive: true });
    writeFileSync(
      join(modelPath, "config.json"),
      JSON.stringify({
        architectures: ["RouteTestForCausalLM"],
        max_position_embeddings: 4096,
      }),
      "utf8",
    );
    writeFileSync(join(modelPath, "model.safetensors"), "test", "utf8");
    const app = await createTestApp();

    const diagnosticsResponse = await app.request("/studio/diagnostics");
    const diagnosticsBody = await diagnosticsResponse.json();
    expect(diagnosticsResponse.status).toBe(200);
    expect(diagnosticsBody).toMatchObject({
      app_version: expect.any(String),
      platform: expect.any(String),
      arch: expect.any(String),
      release: expect.any(String),
      cpu_cores: expect.any(Number),
      config: {
        host: "127.0.0.1",
        port: 18080,
        inference_port: 65534,
        api_key_configured: false,
        models_dir: modelsDir,
        data_dir: tempDir,
        db_path: join(tempDir, "controller.db"),
      },
    });
    expect(Array.isArray(diagnosticsBody.gpus)).toBe(true);
    expect(Array.isArray(diagnosticsBody.disks)).toBe(true);

    const storageResponse = await app.request("/studio/storage");
    const storageBody = await storageResponse.json();
    expect(storageResponse.status).toBe(200);
    expect(storageBody).toMatchObject({
      models_dir: modelsDir,
      model_count: 1,
      model_bytes: 4,
      disk: { path: modelsDir },
    });

    const recommendationsResponse = await app.request("/studio/recommendations");
    const recommendationsBody = await recommendationsResponse.json();
    expect(recommendationsResponse.status).toBe(200);
    expect(Array.isArray(recommendationsBody.recommendations)).toBe(true);
    expect(typeof recommendationsBody.max_vram_gb).toBe("number");

    const providerModelsResponse = await app.request("/studio/provider-models");
    const providerModelsBody = await providerModelsResponse.json();
    expect(providerModelsResponse.status).toBe(200);
    expect(providerModelsBody).toEqual({ providers: [] });

    const missingDeletePathResponse = await app.request("/studio/models/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const missingDeletePathBody = await missingDeletePathResponse.json();
    expect(missingDeletePathResponse.status).toBe(400);
    expect(missingDeletePathBody).toEqual({ detail: "path is required" });

    const outsideDeletePathResponse = await app.request("/studio/models/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: tempDir }),
    });
    const outsideDeletePathBody = await outsideDeletePathResponse.json();
    expect(outsideDeletePathResponse.status).toBe(400);
    expect(outsideDeletePathBody).toEqual({
      detail: "path must be inside models_dir",
    });

    const missingMovePathResponse = await app.request("/studio/models/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const missingMovePathBody = await missingMovePathResponse.json();
    expect(missingMovePathResponse.status).toBe(400);
    expect(missingMovePathBody).toEqual({
      detail: "source_path and target_root are required",
    });

    const moveResponse = await app.request("/studio/models/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_path: modelPath, target_root: targetRoot }),
    });
    const moveBody = await moveResponse.json();
    expect(moveResponse.status).toBe(200);
    expect(moveBody).toEqual({ success: true, target: movedModelPath });

    const deleteResponse = await app.request("/studio/models/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: movedModelPath }),
    });
    const deleteBody = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteBody).toEqual({ success: true });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/studio/diagnostics",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/studio/storage",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/studio/recommendations",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/studio/provider-models",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/models/delete",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/models/delete",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/models/move",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/models/move",
          status: 200,
          success: 1,
        }),
      ]),
    );
  }, 15_000);

  test("audio routes reject invalid requests with structured observable errors", async () => {
    const app = await createTestApp();

    const invalidMultipartResponse = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "x" }),
    });
    const invalidMultipartBody = await invalidMultipartResponse.json();
    expect(invalidMultipartResponse.status).toBe(400);
    expect(invalidMultipartBody).toEqual({
      code: "invalid_multipart",
      error: "Request body must be multipart/form-data",
    });

    const missingFileForm = new FormData();
    missingFileForm.set("model", "missing-stt-model");
    const missingFileResponse = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: missingFileForm,
    });
    const missingFileBody = await missingFileResponse.json();
    expect(missingFileResponse.status).toBe(400);
    expect(missingFileBody).toEqual({
      code: "file_missing",
      error: "Multipart field 'file' is required",
    });

    const missingInputResponse = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "missing-tts-model" }),
    });
    const missingInputBody = await missingInputResponse.json();
    expect(missingInputResponse.status).toBe(400);
    expect(missingInputBody).toEqual({
      code: "input_missing",
      error: "input is required and cannot be empty",
    });

    const unsupportedFormatResponse = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "Say hello",
        model: "missing-tts-model",
        response_format: "mp3",
      }),
    });
    const unsupportedFormatBody = await unsupportedFormatResponse.json();
    expect(unsupportedFormatResponse.status).toBe(400);
    expect(unsupportedFormatBody).toEqual({
      code: "unsupported_response_format",
      error: "Only response_format='wav' is supported",
    });

    const missingVoiceResponse = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "Say hello",
        model: "chatterbox-turbo",
        voice: "voice_00000000000000000000000000000000",
      }),
    });
    const missingVoiceBody = await missingVoiceResponse.json();
    expect(missingVoiceResponse.status).toBe(404);
    expect(missingVoiceBody).toEqual({
      code: "voice_not_found",
      error: "Voice profile not found",
    });

    const missingModelResponse = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "Say hello" }),
    });
    const missingModelBody = await missingModelResponse.json();
    expect(missingModelResponse.status).toBe(400);
    expect(missingModelBody).toEqual({
      code: "model_missing",
      error: "No TTS model provided. Set model field or LOCAL_STUDIO_TTS_MODEL.",
    });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/v1/audio/transcriptions",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/audio/speech",
          status: 400,
          success: 0,
        }),
      ]),
    );
  });
});
