import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type EnvSnapshot = Record<string, string | undefined>;

const ENV_KEYS = [
  "VLLM_STUDIO_DATA_DIR",
  "VLLM_STUDIO_DB_PATH",
  "VLLM_STUDIO_MODELS_DIR",
  "VLLM_STUDIO_HOST",
  "VLLM_STUDIO_PORT",
  "VLLM_STUDIO_INFERENCE_PORT",
  "VLLM_STUDIO_MOCK_INFERENCE",
  "VLLM_STUDIO_MOCK_MODEL_ID",
  "VLLM_STUDIO_API_KEY",
  "VLLM_STUDIO_RUNTIME_SKIP_DOCKER",
  "VLLM_STUDIO_RUNTIME_SKIP_SYSTEM",
] as const;

let envSnapshot: EnvSnapshot;
let tempDir: string;

type ControllerRequestRow = {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  success: number;
  error_class: string | null;
  error_message: string | null;
  user_agent: string | null;
};

beforeEach(() => {
  envSnapshot = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  tempDir = mkdtempSync(join(tmpdir(), "vllm-studio-controller-test-"));
  Object.assign(process.env, {
    VLLM_STUDIO_DATA_DIR: tempDir,
    VLLM_STUDIO_DB_PATH: join(tempDir, "controller.db"),
    VLLM_STUDIO_MODELS_DIR: join(tempDir, "models"),
    VLLM_STUDIO_HOST: "127.0.0.1",
    VLLM_STUDIO_PORT: "18080",
    VLLM_STUDIO_INFERENCE_PORT: "65534",
    VLLM_STUDIO_MOCK_INFERENCE: "true",
    VLLM_STUDIO_MOCK_MODEL_ID: "mock-model",
    VLLM_STUDIO_RUNTIME_SKIP_DOCKER: "1",
    VLLM_STUDIO_RUNTIME_SKIP_SYSTEM: "1",
  });
  delete process.env.VLLM_STUDIO_API_KEY;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempDir, { recursive: true, force: true });
});

async function createTestApp() {
  const [{ createAppContext }, { createApp }] = await Promise.all([
    import("../../../controller/src/app-context"),
    import("../../../controller/src/http/app"),
  ]);
  const context = createAppContext();
  return createApp(context);
}

function readControllerRequestRows(): ControllerRequestRow[] {
  const dbPath = process.env.VLLM_STUDIO_DB_PATH;
  if (!dbPath) throw new Error("VLLM_STUDIO_DB_PATH is required for tests");
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .query<ControllerRequestRow, []>(
        `SELECT method, path, status, duration_ms, success, error_class, error_message, user_agent
         FROM controller_requests
         ORDER BY id ASC`,
      )
      .all();
  } finally {
    db.close();
  }
}

describe("controller route contracts", () => {
  test("status route reports no active runtime on an isolated test port", async () => {
    const app = await createTestApp();
    const response = await app.request("/status");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      running: false,
      process: null,
      inference_port: 65534,
      launching: null,
    });
  });

  test("mock inference exposes an OpenAI-compatible model list without a live backend", async () => {
    const app = await createTestApp();
    const response = await app.request("/v1/models");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.object).toBe("list");
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "mock-model",
        object: "model",
        owned_by: "vllm-studio",
        active: true,
      }),
    ]);
  });

  test("model catalog routes expose recipe-backed model details and discovery metadata", async () => {
    const modelsDir = process.env.VLLM_STUDIO_MODELS_DIR;
    if (!modelsDir) throw new Error("VLLM_STUDIO_MODELS_DIR is required for tests");
    const modelPath = join(modelsDir, "catalog-route-model");
    mkdirSync(modelPath, { recursive: true });
    writeFileSync(
      join(modelPath, "config.json"),
      JSON.stringify({
        architectures: ["CatalogRouteForCausalLM"],
        max_position_embeddings: 8192,
      }),
      "utf8",
    );
    writeFileSync(join(modelPath, "model.safetensors"), "weights", "utf8");
    const app = await createTestApp();

    const createRecipeResponse = await app.request("/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "catalog-route-recipe",
        name: "Catalog Route Recipe",
        model_path: modelPath,
        backend: "vllm",
        served_model_name: "catalog-route-served",
        max_model_len: 8192,
      }),
    });
    const createRecipeBody = await createRecipeResponse.json();
    expect(createRecipeResponse.status).toBe(200);
    expect(createRecipeBody).toEqual({ success: true, id: "catalog-route-recipe" });

    const modelsResponse = await app.request("/v1/models");
    const modelsBody = await modelsResponse.json();
    expect(modelsResponse.status).toBe(200);
    expect(modelsBody).toMatchObject({ object: "list" });
    expect(modelsBody.data).toEqual([
      expect.objectContaining({
        id: "catalog-route-served",
        object: "model",
        owned_by: "vllm-studio",
        active: false,
        max_model_len: 8192,
      }),
    ]);

    const modelResponse = await app.request("/v1/models/catalog-route-served");
    const modelBody = await modelResponse.json();
    expect(modelResponse.status).toBe(200);
    expect(modelBody).toMatchObject({
      id: "catalog-route-served",
      object: "model",
      owned_by: "vllm-studio",
      active: false,
      max_model_len: 8192,
    });

    const missingModelResponse = await app.request("/v1/models/missing-model");
    const missingModelBody = await missingModelResponse.json();
    expect(missingModelResponse.status).toBe(404);
    expect(missingModelBody).toEqual({ detail: "Model not found" });

    const studioModelsResponse = await app.request("/v1/studio/models");
    const studioModelsBody = await studioModelsResponse.json();
    expect(studioModelsResponse.status).toBe(200);
    expect(studioModelsBody).toMatchObject({
      configured_models_dir: modelsDir,
    });
    expect(studioModelsBody.roots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: modelsDir,
          exists: true,
          sources: ["config", "recipe_parent"],
          recipe_ids: ["catalog-route-recipe"],
        }),
      ]),
    );
    expect(studioModelsBody.models).toEqual([
      expect.objectContaining({
        name: "catalog-route-model",
        path: modelPath,
        size_bytes: 7,
        architecture: "CatalogRouteForCausalLM",
        context_length: 8192,
        recipe_ids: ["catalog-route-recipe"],
        has_recipe: true,
      }),
    ]);

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/recipes",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/models",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/models/catalog-route-served",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/models/missing-model",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/studio/models",
          status: 200,
          success: 1,
        }),
      ]),
    );
  });

  test("invalid controller proxy targets fail before any upstream request is made", async () => {
    const app = await createTestApp();
    const response = await app.request(
      "/controllers/route/status?target=file:///etc/passwd",
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.detail).toBe("target must be an http(s) controller URL");
  });

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
    expect(compatBody.platform).toEqual(
      expect.objectContaining({ kind: expect.any(String) }),
    );
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
      models_dir: process.env.VLLM_STUDIO_MODELS_DIR,
      data_dir: tempDir,
      db_path: join(tempDir, "controller.db"),
    });
    expect(configBody.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Controller", status: "running" }),
        expect.objectContaining({ name: "vLLM/SGLang", status: "stopped" }),
        expect.objectContaining({ name: "Prometheus" }),
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
    expect(configBody.runtime).toEqual(expect.any(Object));

    const specResponse = await app.request("/api/spec");
    const specBody = await specResponse.json();
    expect(specResponse.status).toBe(200);
    expect(specBody).toMatchObject({
      openapi: "3.1.0",
      info: { title: "vLLM Studio API" },
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
        expect.objectContaining({ method: "GET", path: "/gpus", status: 200, success: 1 }),
        expect.objectContaining({ method: "GET", path: "/compat", status: 200, success: 1 }),
        expect.objectContaining({ method: "GET", path: "/config", status: 200, success: 1 }),
        expect.objectContaining({ method: "GET", path: "/api/spec", status: 200, success: 1 }),
        expect.objectContaining({ method: "GET", path: "/api/docs", status: 200, success: 1 }),
      ]),
    );
  }, 15_000);

  test("studio settings and provider CRUD routes persist observable contracts", async () => {
    const app = await createTestApp();

    const settingsResponse = await app.request("/studio/settings");
    const settingsBody = await settingsResponse.json();
    expect(settingsResponse.status).toBe(200);
    expect(settingsBody.effective.models_dir).toBe(process.env.VLLM_STUDIO_MODELS_DIR);

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
        expect.objectContaining({ method: "GET", path: "/studio/settings", status: 200 }),
        expect.objectContaining({ method: "POST", path: "/studio/settings", status: 200 }),
        expect.objectContaining({ method: "GET", path: "/studio/providers", status: 200 }),
        expect.objectContaining({ method: "POST", path: "/studio/providers", status: 200 }),
        expect.objectContaining({ method: "PUT", path: "/studio/providers/local", status: 200 }),
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
    const modelsDir = process.env.VLLM_STUDIO_MODELS_DIR;
    if (!modelsDir) throw new Error("VLLM_STUDIO_MODELS_DIR is required for tests");
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
    expect(outsideDeletePathBody).toEqual({ detail: "path must be inside models_dir" });

    const missingMovePathResponse = await app.request("/studio/models/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const missingMovePathBody = await missingMovePathResponse.json();
    expect(missingMovePathResponse.status).toBe(400);
    expect(missingMovePathBody).toEqual({ detail: "source_path and target_root are required" });

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

  test("recipe CRUD routes persist success and not-found observability", async () => {
    const app = await createTestApp();
    const recipePayload = {
      id: "route-test-recipe",
      name: "Route Test Recipe",
      model_path: join(tempDir, "models", "route-test-model"),
      backend: "vllm",
      served_model_name: "route-test-model",
      tensor_parallel_size: 2,
      max_model_len: 8192,
      gpu_memory_utilization: 0.75,
      unknown_runtime_flag: "--example",
    };

    const createResponse = await app.request("/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recipePayload),
    });
    const createBody = await createResponse.json();
    expect(createResponse.status).toBe(200);
    expect(createBody).toEqual({ success: true, id: "route-test-recipe" });

    const listResponse = await app.request("/recipes");
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listBody).toEqual([
      expect.objectContaining({
        id: "route-test-recipe",
        name: "Route Test Recipe",
        backend: "vllm",
        served_model_name: "route-test-model",
        tensor_parallel_size: 2,
        max_model_len: 8192,
        status: "stopped",
        extra_args: { unknown_runtime_flag: "--example" },
      }),
    ]);

    const getResponse = await app.request("/recipes/route-test-recipe");
    const getBody = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getBody).toMatchObject({
      id: "route-test-recipe",
      name: "Route Test Recipe",
      gpu_memory_utilization: 0.75,
    });

    const updateResponse = await app.request("/recipes/route-test-recipe", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...recipePayload,
        name: "Updated Route Test Recipe",
        max_num_seqs: 16,
      }),
    });
    const updateBody = await updateResponse.json();
    expect(updateResponse.status).toBe(200);
    expect(updateBody).toEqual({ success: true, id: "route-test-recipe" });

    const updatedResponse = await app.request("/recipes/route-test-recipe");
    const updatedBody = await updatedResponse.json();
    expect(updatedResponse.status).toBe(200);
    expect(updatedBody).toMatchObject({
      id: "route-test-recipe",
      name: "Updated Route Test Recipe",
      max_num_seqs: 16,
    });

    const deleteResponse = await app.request("/recipes/route-test-recipe", {
      method: "DELETE",
    });
    const deleteBody = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteBody).toEqual({ success: true });

    const missingResponse = await app.request("/recipes/route-test-recipe");
    const missingBody = await missingResponse.json();
    expect(missingResponse.status).toBe(404);
    expect(missingBody).toEqual({ detail: "Recipe not found" });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "POST", path: "/recipes", status: 200, success: 1 }),
        expect.objectContaining({ method: "GET", path: "/recipes", status: 200, success: 1 }),
        expect.objectContaining({
          method: "GET",
          path: "/recipes/route-test-recipe",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "PUT",
          path: "/recipes/route-test-recipe",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "DELETE",
          path: "/recipes/route-test-recipe",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/recipes/route-test-recipe",
          status: 404,
          success: 0,
        }),
      ]),
    );
  });

  test("runtime and download validation routes persist observable outcomes", async () => {
    const app = await createTestApp();

    const downloadsResponse = await app.request("/studio/downloads");
    const downloadsBody = await downloadsResponse.json();
    expect(downloadsResponse.status).toBe(200);
    expect(downloadsBody).toEqual({ downloads: [] });

    const missingDownloadResponse = await app.request("/studio/downloads/missing-download");
    const missingDownloadBody = await missingDownloadResponse.json();
    expect(missingDownloadResponse.status).toBe(404);
    expect(missingDownloadBody).toEqual({ detail: "Download not found" });

    const invalidDownloadResponse = await app.request("/studio/downloads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: "main" }),
    });
    const invalidDownloadBody = await invalidDownloadResponse.json();
    expect(invalidDownloadResponse.status).toBe(400);
    expect(invalidDownloadBody).toEqual({ detail: "model_id is required" });

    const runtimeTargetsResponse = await app.request("/runtime/targets");
    const runtimeTargetsBody = await runtimeTargetsResponse.json();
    expect(runtimeTargetsResponse.status).toBe(200);
    expect(Array.isArray(runtimeTargetsBody.targets)).toBe(true);

    const missingTargetResponse = await app.request("/runtime/targets/missing-target");
    const missingTargetBody = await missingTargetResponse.json();
    expect(missingTargetResponse.status).toBe(404);
    expect(missingTargetBody).toEqual({ detail: "Runtime target not found" });

    const invalidRuntimeJobResponse = await app.request("/runtime/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "update" }),
    });
    const invalidRuntimeJobBody = await invalidRuntimeJobResponse.json();
    expect(invalidRuntimeJobResponse.status).toBe(400);
    expect(invalidRuntimeJobBody).toEqual({ detail: "backend is required" });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/studio/downloads", status: 200 }),
        expect.objectContaining({
          method: "GET",
          path: "/studio/downloads/missing-download",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/downloads",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({ method: "GET", path: "/runtime/targets", status: 200 }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/targets/missing-target",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/jobs",
          status: 400,
          success: 0,
        }),
      ]),
    );
  });

  test("monitoring and log routes persist operational observability", async () => {
    const logsDir = join(tempDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(join(logsDir, "vllm_route-test.log"), "first line\nsecond line\n", "utf8");
    const app = await createTestApp();

    const prometheusResponse = await app.request("/metrics");
    const prometheusText = await prometheusResponse.text();
    expect(prometheusResponse.status).toBe(200);
    expect(prometheusResponse.headers.get("content-type")).toContain("text/plain");
    expect(prometheusText).toContain("vllm_studio");

    const currentMetricsResponse = await app.request("/v1/metrics/vllm");
    const currentMetricsBody = await currentMetricsResponse.json();
    expect(currentMetricsResponse.status).toBe(200);
    expect(currentMetricsBody).toMatchObject({
      model_id: null,
      model_path: null,
      served_model_name: null,
    });

    const peakMetricsResponse = await app.request("/peak-metrics");
    const peakMetricsBody = await peakMetricsResponse.json();
    expect(peakMetricsResponse.status).toBe(200);
    expect(peakMetricsBody).toEqual({ metrics: [] });

    const missingPeakResponse = await app.request("/peak-metrics?model_id=missing-model");
    const missingPeakBody = await missingPeakResponse.json();
    expect(missingPeakResponse.status).toBe(200);
    expect(missingPeakBody).toEqual({ error: "No metrics for this model" });

    const lifetimeResponse = await app.request("/lifetime-metrics");
    const lifetimeBody = await lifetimeResponse.json();
    expect(lifetimeResponse.status).toBe(200);
    expect(lifetimeBody).toMatchObject({
      tokens_total: 0,
      requests_total: 0,
      energy_wh: 0,
      current_power_watts: 0,
    });

    const logsResponse = await app.request("/logs");
    const logsBody = await logsResponse.json();
    expect(logsResponse.status).toBe(200);
    expect(logsBody.sessions).toEqual([
      expect.objectContaining({
        id: "route-test",
        recipe_id: "route-test",
        model: "route-test",
        status: "stopped",
      }),
    ]);

    const logResponse = await app.request("/logs/route-test?limit=1");
    const logBody = await logResponse.json();
    expect(logResponse.status).toBe(200);
    expect(logBody).toEqual({
      id: "route-test",
      logs: ["second line"],
      content: "second line",
    });

    const missingLogResponse = await app.request("/logs/missing-log");
    const missingLogBody = await missingLogResponse.json();
    expect(missingLogResponse.status).toBe(404);
    expect(missingLogBody).toEqual({ detail: "Log not found" });

    const controllerDeleteResponse = await app.request("/logs/controller", {
      method: "DELETE",
    });
    const controllerDeleteBody = await controllerDeleteResponse.json();
    expect(controllerDeleteResponse.status).toBe(400);
    expect(controllerDeleteBody).toEqual({ detail: "controller logs cannot be deleted via API" });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "GET", path: "/metrics", status: 200, success: 1 }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/metrics/vllm",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({ method: "GET", path: "/peak-metrics", status: 200, success: 1 }),
        expect.objectContaining({
          method: "GET",
          path: "/lifetime-metrics",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({ method: "GET", path: "/logs", status: 200, success: 1 }),
        expect.objectContaining({
          method: "GET",
          path: "/logs/route-test",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/logs/missing-log",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "DELETE",
          path: "/logs/controller",
          status: 400,
          success: 0,
        }),
      ]),
    );
  });

  test("proxy tokenization routes preserve fallbacks and observability without a live model", async () => {
    const app = await createTestApp();

    const tokenizeResponse = await app.request("/v1/tokenize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-model", prompt: "hello world" }),
    });
    const tokenizeBody = await tokenizeResponse.json();
    expect(tokenizeResponse.status).toBe(200);
    expect(tokenizeBody).toEqual({ error: "No model running", num_tokens: 0 });

    const detokenizeResponse = await app.request("/v1/detokenize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-model", tokens: [1, 2, 3] }),
    });
    const detokenizeBody = await detokenizeResponse.json();
    expect(detokenizeResponse.status).toBe(200);
    expect(detokenizeBody).toEqual({ error: "No model running", text: "" });

    const countTokensResponse = await app.request("/v1/count-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-model", text: "hello world" }),
    });
    const countTokensBody = await countTokensResponse.json();
    expect(countTokensResponse.status).toBe(200);
    expect(countTokensBody).toEqual({ error: "No model running", num_tokens: 0 });

    const chatTokenizeResponse = await app.request("/v1/tokenize-chat-completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "mock-model",
        messages: [{ role: "user", content: "hello world" }],
      }),
    });
    const chatTokenizeBody = await chatTokenizeResponse.json();
    expect(chatTokenizeResponse.status).toBe(200);
    expect(chatTokenizeBody).toEqual({ error: "No model running", input_tokens: 0 });

    const titleResponse = await app.request("/api/title", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: "Name this thread" }),
    });
    const titleBody = await titleResponse.json();
    expect(titleResponse.status).toBe(200);
    expect(titleBody).toEqual({ title: "New Chat" });

    const invalidChatResponse = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const invalidChatBody = await invalidChatResponse.json();
    expect(invalidChatResponse.status).toBe(400);
    expect(invalidChatBody).toEqual({ detail: "Invalid JSON body" });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/v1/tokenize",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/detokenize",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/count-tokens",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/tokenize-chat-completions",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({ method: "POST", path: "/api/title", status: 200, success: 1 }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/chat/completions",
          status: 400,
          success: 0,
        }),
      ]),
    );
  });

  test("audio routes reject invalid requests with structured observable errors", async () => {
    const app = await createTestApp();

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

    const missingModelResponse = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "Say hello" }),
    });
    const missingModelBody = await missingModelResponse.json();
    expect(missingModelResponse.status).toBe(400);
    expect(missingModelBody).toEqual({
      code: "model_missing",
      error: "No TTS model provided. Set model field or VLLM_STUDIO_TTS_MODEL.",
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

  test("usage includes persisted controller route observability", async () => {
    const app = await createTestApp();

    await app.request("/status");
    await app.request("/v1/models");
    await app.request("/controllers/route/status?target=file:///etc/passwd");
    await app.request("/vram-calculator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context_length: 0 }),
    });

    const response = await app.request("/usage");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.controller.totals).toMatchObject({
      total_requests: 4,
      successful_requests: 2,
      failed_requests: 2,
      success_rate: 50,
    });
    expect(body.controller.latency.avg_ms).toBeGreaterThanOrEqual(0);
    expect(body.controller.latency.max_ms).toBeGreaterThanOrEqual(0);
    expect(body.controller.recent_activity).toMatchObject({
      last_hour_requests: 4,
      last_24h_requests: 4,
      last_24h_failed_requests: 2,
    });
    expect(body.controller.by_path).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/status",
          requests: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/models",
          requests: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/controllers/route/status",
          requests: 1,
          failed: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/vram-calculator",
          requests: 1,
          failed: 1,
        }),
      ]),
    );
    expect(body.controller.by_status).toEqual(
      expect.arrayContaining([
        { status: 200, requests: 2 },
        { status: 400, requests: 2 },
      ]),
    );
    expect(body.controller.recent_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/vram-calculator", status: 400 }),
        expect.objectContaining({
          path: "/controllers/route/status",
          status: 400,
        }),
      ]),
    );
  });

  test("controller observability persists normalized raw rows for every route action", async () => {
    const app = await createTestApp();

    await app.request("/status?ignored=1", {
      headers: { "user-agent": "controller-integration-test/1.0" },
    });
    await app.request("/missing-route");
    await app.request("/vram-calculator", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "controller-integration-test/1.0",
      },
      body: JSON.stringify({ context_length: 0 }),
    });

    const rows = readControllerRequestRows();

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      method: "GET",
      path: "/status",
      status: 200,
      success: 1,
      error_class: null,
      error_message: null,
      user_agent: "controller-integration-test/1.0",
    });
    expect(rows[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(rows[1]).toMatchObject({
      method: "GET",
      path: "/missing-route",
      status: 404,
      success: 0,
      error_class: null,
      error_message: null,
    });
    expect(rows[2]).toMatchObject({
      method: "POST",
      path: "/vram-calculator",
      status: 400,
      success: 0,
      error_class: null,
      error_message: null,
      user_agent: "controller-integration-test/1.0",
    });
  });
});
