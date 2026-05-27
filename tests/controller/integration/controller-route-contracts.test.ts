import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
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
