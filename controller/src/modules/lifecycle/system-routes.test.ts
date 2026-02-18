// CRITICAL
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { Hono } from "hono";
import { registerSystemRoutes } from "./system-routes";
import type { AppContext } from "../../types/context";
import type { Config } from "../../config/env";

describe("System Routes", () => {
  let app: Hono;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Mock fetch to avoid real network requests in tests
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Network unavailable"))
    ) as unknown as typeof fetch;

    app = new Hono();

    // Create minimal mock context
    const mockConfig: Config = {
      host: "0.0.0.0",
      port: 8080,
      inference_port: 8000,

      data_dir: "./data",
      db_path: ":memory:",
      models_dir: "/models",
    };

    const mockContext = {
      config: mockConfig,
      logger: {
        info: mock(() => undefined),
        warn: mock(() => undefined),
        error: mock(() => undefined),
        debug: mock(() => undefined),
      },
      eventManager: {
        subscribe: mock(() => undefined),
        broadcast: mock(() => undefined),
      },
      launchState: {
        launching: null,
        setLaunching: mock(() => undefined),
        clearLaunching: mock(() => undefined),
      },
      metrics: {
        requestsTotal: { inc: mock(() => undefined) },
        requestDuration: { observe: mock(() => undefined) },
      },
      metricsRegistry: {
        metrics: mock(() => ""),
      },
      processManager: {
        findInferenceProcess: mock(() => Promise.resolve(null)),
        launchModel: mock(() => undefined),
        evictModel: mock(() => undefined),
      },
      stores: {
        recipeStore: {
          list: mock(() => []),
          get: mock(() => undefined),
          save: mock(() => undefined),
          delete: mock(() => undefined),
        },
        chatStore: {
          listSessions: mock(() => []),
          getSession: mock(() => undefined),
          createSession: mock(() => undefined),
          deleteSession: mock(() => undefined),
        },
        peakMetricsStore: {
          get: mock(() => undefined),
          update: mock(() => undefined),
          list: mock(() => []),
        },
        lifetimeMetricsStore: {
          getAll: mock(() => ({})),
          addTokens: mock(() => undefined),
          addPromptTokens: mock(() => undefined),
          addCompletionTokens: mock(() => undefined),
          addRequests: mock(() => undefined),
        },
        mcpStore: {
          list: mock(() => []),
          get: mock(() => undefined),
          save: mock(() => undefined),
          delete: mock(() => undefined),
        },
      },
    } as unknown as AppContext;

    registerSystemRoutes(app, mockContext);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("GET /health", () => {
    it("returns health status", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveProperty("status");
      expect(json).toHaveProperty("inference_ready");
    });
  });

  describe("GET /gpus", () => {
    it("returns GPU information", async () => {
      const res = await app.request("/gpus");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(Array.isArray(json.gpus)).toBe(true);
    });
  });

  describe("GET /compat", () => {
    it("returns a compatibility report", async () => {
      const res = await app.request("/compat");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveProperty("platform");
      expect(json).toHaveProperty("gpu_monitoring");
      expect(Array.isArray(json.checks)).toBe(true);
    });
  });

  describe("GET /config", () => {
    it("returns system configuration", async () => {
      const res = await app.request("/config");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toHaveProperty("config");
      expect(json.config).toHaveProperty("port");
      expect(json.config).toHaveProperty("inference_port");
      expect(json).toHaveProperty("services");
      expect(json).toHaveProperty("environment");
    });
  });
});
