import { afterEach, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { delay } from "../../src/core/async";

type EnvSnapshot = Record<string, string | undefined>;

const ENV_KEYS = [
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_DB_PATH",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_HOST",
  "LOCAL_STUDIO_PORT",
  "LOCAL_STUDIO_INFERENCE_PORT",
  "LOCAL_STUDIO_MOCK_INFERENCE",
  "LOCAL_STUDIO_MOCK_MODEL_ID",
  "LOCAL_STUDIO_API_KEY",
  "LOCAL_STUDIO_RUNTIME_SKIP_DOCKER",
  "LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM",
  "LOCAL_STUDIO_LLAMA_BIN",
  "LOCAL_STUDIO_SGLANG_PYTHON",
  "LOCAL_STUDIO_MLX_PYTHON",
  "PI_CODING_AGENT_DIR",
] as const;

let envSnapshot: EnvSnapshot;
export let tempDir: string;

export type ControllerRequestRow = {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  success: number;
  error_class: string | null;
  error_message: string | null;
  user_agent: string | null;
};

export type ControllerFunctionCallRow = {
  function_name: string;
  duration_ms: number;
  success: number;
  error_class: string | null;
  error_message: string | null;
};

export function registerControllerTestLifecycle() {
  beforeEach(() => {
    envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    tempDir = mkdtempSync(join(tmpdir(), "local-studio-controller-test-"));
    Object.assign(process.env, {
      LOCAL_STUDIO_DATA_DIR: tempDir,
      LOCAL_STUDIO_DB_PATH: join(tempDir, "controller.db"),
      LOCAL_STUDIO_MODELS_DIR: join(tempDir, "models"),
      LOCAL_STUDIO_HOST: "127.0.0.1",
      LOCAL_STUDIO_PORT: "18080",
      LOCAL_STUDIO_INFERENCE_PORT: "65534",
      LOCAL_STUDIO_MOCK_INFERENCE: "true",
      LOCAL_STUDIO_MOCK_MODEL_ID: "mock-model",
      LOCAL_STUDIO_RUNTIME_SKIP_DOCKER: "1",
      LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM: "1",
      PI_CODING_AGENT_DIR: join(tempDir, "pi-agent"),
    });
    delete process.env.LOCAL_STUDIO_API_KEY;
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      const value = envSnapshot[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await delay(50);
    rmSync(tempDir, { recursive: true, force: true });
  });
}

export async function createTestApp() {
  const { app } = await createTestHarness();
  return app;
}

export async function createTestHarness() {
  const [{ createAppContext }, { createApp }] = await Promise.all([
    import("../../src/app-context"),
    import("../../src/http/app"),
  ]);
  const context = createAppContext();
  return { app: createApp(context), context };
}

export function readControllerRequestRows(): ControllerRequestRow[] {
  const dbPath = process.env.LOCAL_STUDIO_DB_PATH;
  if (!dbPath) throw new Error("LOCAL_STUDIO_DB_PATH is required for tests");
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

export function readControllerFunctionCallRows(): ControllerFunctionCallRow[] {
  const dbPath = process.env.LOCAL_STUDIO_DB_PATH;
  if (!dbPath) throw new Error("LOCAL_STUDIO_DB_PATH is required for tests");
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .query<ControllerFunctionCallRow, []>(
        `SELECT function_name, duration_ms, success, error_class, error_message
         FROM controller_function_calls
         ORDER BY id ASC`,
      )
      .all();
  } finally {
    db.close();
  }
}

export async function collectSseJson(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}
