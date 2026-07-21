import { describe, expect, test } from "bun:test";
import {
  buildForwardHeaders,
  buildResponseHeaders,
  buildUpstreamUrl,
  createProxyApp,
  type ProxyModeConfig,
} from "./proxy-mode";

const baseConfig: ProxyModeConfig = {
  host: "127.0.0.1",
  port: 8080,
  upstream_url: "http://gpu-box:8080",
  cors_origins: [],
};

describe("buildUpstreamUrl", () => {
  test("forwards path and query to the upstream origin", () => {
    const target = buildUpstreamUrl(
      "http://gpu-box:8080",
      "http://127.0.0.1:8080/v1/chat/completions?stream=true",
    );
    expect(target.toString()).toBe("http://gpu-box:8080/v1/chat/completions?stream=true");
  });

  test("preserves an upstream base path", () => {
    const target = buildUpstreamUrl("http://gpu-box:8080/base/", "http://localhost:8080/status");
    expect(target.toString()).toBe("http://gpu-box:8080/base/status");
  });
});

describe("buildForwardHeaders", () => {
  test("strips inbound auth and framing headers and injects the upstream key", () => {
    const headers = buildForwardHeaders(
      new Headers({
        authorization: "Bearer local-key",
        "x-api-key": "local-key",
        "content-length": "42",
        "transfer-encoding": "chunked",
        "content-type": "application/json",
        accept: "text/event-stream",
      }),
      "upstream-key",
    );
    expect(headers.get("authorization")).toBe("Bearer upstream-key");
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("transfer-encoding")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("text/event-stream");
  });

  test("sends no auth when no upstream key is configured", () => {
    const headers = buildForwardHeaders(new Headers({ authorization: "Bearer local" }), undefined);
    expect(headers.get("authorization")).toBeNull();
  });
});

describe("buildResponseHeaders", () => {
  test("drops stale encoding and hop-by-hop headers, keeps SSE headers", () => {
    const headers = buildResponseHeaders(
      new Headers({
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "content-encoding": "gzip",
        "content-length": "100",
        connection: "keep-alive",
      }),
    );
    expect(headers.get("content-type")).toBe("text/event-stream");
    expect(headers.get("cache-control")).toBe("no-cache");
    expect(headers.get("content-encoding")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("connection")).toBeNull();
  });
});

describe("createProxyApp auth gate", () => {
  test("rejects unauthenticated requests when an api key is set", async () => {
    const app = createProxyApp({ ...baseConfig, api_key: "secret" });
    const response = await app.request("http://127.0.0.1:8080/status");
    expect(response.status).toBe(401);
  });

  test("keeps /proxy/health public", async () => {
    const app = createProxyApp({
      ...baseConfig,
      api_key: "secret",
      // Unroutable upstream: the health probe reports it unreachable instead of failing.
      upstream_url: "http://127.0.0.1:1",
    });
    const response = await app.request("http://127.0.0.1:8080/proxy/health");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { mode: string; upstream_health: string };
    expect(body.mode).toBe("proxy");
    expect(body.upstream_health).toBe("unreachable");
  });
});
