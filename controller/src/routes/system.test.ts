// CRITICAL
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { registerSystemRoutes } from "./system";
import type { AppContext } from "../types/context";
import type { Config } from "../config/env";

describe("System Routes", () => {
  let app: Hono;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Mock fetch to avoid real network requests in tests
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network unavailable")) as unknown as typeof fetch;

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
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      eventManager: {
        subscribe: vi.fn(),
        broadcast: vi.fn(),
      },
      launchState: {
        launching: null,
        setLaunching: vi.fn(),
        clearLaunching: vi.fn(),
      },
      metrics: {
        requestsTotal: { inc: vi.fn() },
        requestDuration: { observe: vi.fn() },
      },
      metricsRegistry: {
        metrics: vi.fn().mockReturnValue(""),
      },
      processManager: {
        findInferenceProcess: vi.fn().mockResolvedValue(null),
        launchModel: vi.fn(),
        evictModel: vi.fn(),
      },
      stores: {
        recipeStore: {
          list: vi.fn().mockReturnValue([]),
          get: vi.fn(),
          save: vi.fn(),
          delete: vi.fn(),
        },
        chatStore: {
          listSessions: vi.fn().mockReturnValue([]),
          getSession: vi.fn(),
          createSession: vi.fn(),
          deleteSession: vi.fn(),
        },
        peakMetricsStore: {
          get: vi.fn(),
          update: vi.fn(),
          list: vi.fn().mockReturnValue([]),
        },
        lifetimeMetricsStore: {
          getAll: vi.fn().mockReturnValue({}),
          addTokens: vi.fn(),
          addPromptTokens: vi.fn(),
          addCompletionTokens: vi.fn(),
          addRequests: vi.fn(),
        },
        mcpStore: {
          list: vi.fn().mockReturnValue([]),
          get: vi.fn(),
          save: vi.fn(),
          delete: vi.fn(),
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
