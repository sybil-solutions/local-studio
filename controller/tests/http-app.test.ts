import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Effect } from "effect";
import { type AppContext, AppContextService } from "../src/app-context";
import { createControllerRuntime, type ControllerRuntime } from "../src/core/effect-runtime";
import { primaryLogPathFor } from "../src/core/log-files";
import { createApp } from "../src/http/app";
import { DownloadTargetConflict } from "../src/modules/engines/downloads/download-target-reservations";
import { parseRecipe } from "../src/modules/models/recipes/recipe-serializer";

const apiKey = "controller-contract-key";
const allowedOrigin = "https://allowed.example";
const environmentKeys = [
  "HOME",
  "PI_CODING_AGENT_DIR",
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_MODELS_DIR",
  "LOCAL_STUDIO_API_KEY",
  "LOCAL_STUDIO_CORS_ORIGINS",
  "LOCAL_STUDIO_DISABLE_METRICS",
  "PATH",
] as const;

type EnvironmentKey = (typeof environmentKeys)[number];
type OpenApiDocument = { paths: Record<string, Record<string, unknown>> };

const previousEnvironment = new Map<EnvironmentKey, string | undefined>();
let temporaryDirectory = "";
let runtime: ControllerRuntime;
let context: AppContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "local-studio-http-test-"));
  for (const key of environmentKeys) previousEnvironment.set(key, process.env[key]);
  process.env["HOME"] = join(temporaryDirectory, "home");
  process.env["PI_CODING_AGENT_DIR"] = join(temporaryDirectory, "pi");
  process.env["LOCAL_STUDIO_DATA_DIR"] = join(temporaryDirectory, "data");
  process.env["LOCAL_STUDIO_MODELS_DIR"] = join(temporaryDirectory, "models");
  process.env["LOCAL_STUDIO_API_KEY"] = apiKey;
  process.env["LOCAL_STUDIO_CORS_ORIGINS"] = allowedOrigin;
  process.env["LOCAL_STUDIO_DISABLE_METRICS"] = "true";
  const binaryDirectory = join(temporaryDirectory, "bin");
  const dockerPath = join(binaryDirectory, "docker");
  mkdirSync(binaryDirectory, { recursive: true });
  writeFileSync(
    dockerPath,
    "#!/bin/sh\nprintf 'Error response from daemon: No such container\\n' >&2\nexit 1\n",
  );
  chmodSync(dockerPath, 0o755);
  process.env["PATH"] = `${binaryDirectory}${delimiter}${process.env["PATH"] ?? ""}`;
  runtime = createControllerRuntime();
  context = await runtime.runPromise(AppContextService);
  app = createApp(context, runtime);
});

afterAll(async () => {
  await runtime.dispose();
  for (const key of environmentKeys) {
    const value = previousEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("controller HTTP application", () => {
  test("keeps health public and protects the rest of the API", async () => {
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const unauthorized = await app.request("/api/spec");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe(
      'Bearer realm="local-studio-controller"',
    );
    expect(await unauthorized.json()).toEqual({ detail: "Unauthorized" });
  });

  test("applies the configured CORS allowlist", async () => {
    const allowed = await app.request("/health", { headers: { origin: allowedOrigin } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(allowedOrigin);

    const rejected = await app.request("/health", {
      headers: { origin: "https://rejected.example" },
    });
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("serves API documentation and a stable JSON 404", async () => {
    const headers = { "x-api-key": apiKey };
    const docs = await app.request("/api/docs", { headers });
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");

    const missing = await app.request("/missing", { headers });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ detail: "Not Found" });
  });

  test("maps download target ownership conflicts to HTTP 409", async () => {
    const originalStart = context.downloadManager.start.bind(context.downloadManager);
    context.downloadManager.start = () =>
      Effect.fail(new DownloadTargetConflict("active-download", "/models/shared"));
    try {
      const response = await app.request("/studio/downloads", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ model_id: "org/model", hf_token: "secret-token" }),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        detail: 'Download target "/models/shared" is reserved by active download active-download',
      });
    } finally {
      context.downloadManager.start = originalStart;
    }
  });

  test("documents every registered product operation exactly once", async () => {
    const response = await app.request("/api/spec", { headers: { "x-api-key": apiKey } });
    expect(response.status).toBe(200);
    const document = (await response.json()) as OpenApiDocument;
    const registeredOperations = new Set(
      app.routes
        .filter(
          ({ method, path }) => method !== "ALL" && path !== "/api/spec" && path !== "/api/docs",
        )
        .map(
          ({ method, path }) => `${method.toLowerCase()} ${path.replaceAll(/:([^/]+)/g, "{$1}")}`,
        ),
    );
    const documentedOperations = new Set(
      Object.entries(document.paths).flatMap(([path, methods]) =>
        Object.keys(methods).map((method) => `${method} ${path}`),
      ),
    );
    expect([...documentedOperations].sort()).toEqual([...registeredOperations].sort());
  });

  test("falls back to persisted logs when a Docker container no longer exists", async () => {
    const sessionId = "stale-docker-session";
    await runtime.runPromise(
      context.stores.recipeStore.save(
        parseRecipe({
          id: sessionId,
          name: "Stale Docker Session",
          model_path: "/models/stale",
          backend: "vllm",
          runtime: { kind: "docker", ref: "example.invalid/local-studio" },
          extra_args: { "docker-container": sessionId },
        }),
      ),
    );
    writeFileSync(primaryLogPathFor(context.config.data_dir, sessionId), "persisted log line\n");

    const response = await app.request(`/logs/${sessionId}`, {
      headers: { "x-api-key": apiKey },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: sessionId,
      logs: ["persisted log line"],
      content: "persisted log line",
    });

    const abortController = new AbortController();
    const stream = await app.request(`/logs/${sessionId}/stream?tail=1`, {
      headers: { "x-api-key": apiKey },
      signal: abortController.signal,
    });
    const chunk = await stream.body?.getReader().read();
    abortController.abort();
    expect(new TextDecoder().decode(chunk?.value)).toContain("persisted log line");
  });
});
