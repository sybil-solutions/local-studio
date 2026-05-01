// CRITICAL
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { getApiSettings } from "@/lib/api-settings";

vi.mock("@/lib/api-settings", () => ({
  getApiSettings: vi.fn(),
}));

const getApiSettingsMock = vi.mocked(getApiSettings);
const ALLOWLIST_ENV_KEY = "VLLM_STUDIO_PROXY_OVERRIDE_ALLOWLIST";

describe("GET /api/proxy/[...path]", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env[ALLOWLIST_ENV_KEY];
    getApiSettingsMock.mockResolvedValue({
      backendUrl: "https://api.example.test",
      apiKey: "test-key",
      voiceUrl: "",
      voiceModel: "whisper-large-v3-turbo",
    });
  });

  afterEach(() => {
    delete process.env[ALLOWLIST_ENV_KEY];
  });

  it("falls back to configured backend when cookie override returns plain-text 404", async () => {
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("not found", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ running: false, process: null, inference_port: 8000 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", upstreamFetch);

    const request = new NextRequest("http://localhost/api/proxy/status", {
      method: "GET",
      headers: {
        Cookie: "vllmstudio_backend_url=https%3A%2F%2Foverride.example.com%3A8080",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ path: ["status"] }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-backend-override-invalid")).toBe("1");
    expect(response.headers.get("set-cookie")).toContain("vllmstudio_backend_url=");
    const payload = await response.json();
    expect(payload.running).toBe(false);

    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(upstreamFetch.mock.calls[0]?.[0]).toBe("https://override.example.com:8080/status");
    expect(upstreamFetch.mock.calls[1]?.[0]).toBe("https://api.example.test/status");
  });

  it("falls back to configured backend when override request throws a network error", async () => {
    const upstreamFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", upstreamFetch);

    const request = new NextRequest("http://localhost/api/proxy/health", {
      method: "GET",
      headers: {
        Cookie: "vllmstudio_backend_url=https%3A%2F%2Foverride.example.com%3A8080",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ path: ["health"] }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-backend-override-invalid")).toBe("1");
    expect(response.headers.get("set-cookie")).toContain("vllmstudio_backend_url=");
    const payload = await response.json();
    expect(payload.status).toBe("ok");

    expect(upstreamFetch).toHaveBeenCalledTimes(2);
    expect(upstreamFetch.mock.calls[0]?.[0]).toBe("https://override.example.com:8080/health");
    expect(upstreamFetch.mock.calls[1]?.[0]).toBe("https://api.example.test/health");
  });

  it("blocks private network override URLs provided via header when not allowlisted", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);

    const request = new NextRequest("http://localhost/api/proxy/status", {
      method: "GET",
      headers: {
        "X-Backend-Url": "http://10.0.0.10:8080",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ path: ["status"] }) });

    expect(response.status).toBe(403);
    expect(response.headers.get("x-backend-override-invalid")).toBe("1");
    expect(response.headers.get("set-cookie")).toContain("vllmstudio_backend_url=");
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("ignores blocked private cookie override and uses configured backend", async () => {
    const upstreamFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const request = new NextRequest("http://localhost/api/proxy/health", {
      method: "GET",
      headers: {
        Cookie: "vllmstudio_backend_url=http%3A%2F%2F10.0.0.10%3A8080",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ path: ["health"] }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-backend-override-invalid")).toBe("1");
    expect(response.headers.get("set-cookie")).toContain("vllmstudio_backend_url=");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(upstreamFetch.mock.calls[0]?.[0]).toBe("https://api.example.test/health");
  });

  it("allows private network override URLs when allowlisted", async () => {
    process.env[ALLOWLIST_ENV_KEY] = "http://10.0.0.10:8080";

    const upstreamFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ running: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const request = new NextRequest("http://localhost/api/proxy/status", {
      method: "GET",
      headers: {
        "X-Backend-Url": "http://10.0.0.10:8080",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ path: ["status"] }) });

    expect(response.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(upstreamFetch.mock.calls[0]?.[0]).toBe("http://10.0.0.10:8080/status");
  });

  it("uses override when it succeeds and does not fallback", async () => {
    const upstreamFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ running: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const request = new NextRequest("http://localhost/api/proxy/status", {
      method: "GET",
      headers: {
        "X-Backend-Url": "https://override.example.com",
      },
    });

    const response = await GET(request, { params: Promise.resolve({ path: ["status"] }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-backend-override-invalid")).toBeNull();
    const payload = await response.json();
    expect(payload.running).toBe(true);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(upstreamFetch).toHaveBeenCalledWith(
      "https://override.example.com/status",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
