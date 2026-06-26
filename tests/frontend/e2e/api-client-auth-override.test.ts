import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { createApiClient } from "@/lib/api/create-api-client";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.LOCAL_STUDIO_API_KEY;
const originalDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
const dataDirs: string[] = [];

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.LOCAL_STUDIO_API_KEY;
  } else {
    process.env.LOCAL_STUDIO_API_KEY = originalApiKey;
  }
  if (originalDataDir === undefined) {
    delete process.env.LOCAL_STUDIO_DATA_DIR;
  } else {
    process.env.LOCAL_STUDIO_DATA_DIR = originalDataDir;
  }
  for (const dir of dataDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function installStatusFetch(assertHeaders: (headers: Headers) => void): void {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    assertHeaders(new Headers(init?.headers));
    return new Response(
      JSON.stringify({
        running: true,
        process: null,
        inference_port: 8000,
        launching: null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
}

test("explicit empty API key override suppresses stored-key authorization fallback", async () => {
  process.env.LOCAL_STUDIO_API_KEY = "stored-controller-secret";
  installStatusFetch((headers) => {
    assert.equal(headers.get("X-Backend-Url"), "https://typed-controller.example");
    assert.equal(headers.get("X-Backend-Strict"), "1");
    assert.equal(headers.get("X-Backend-Suppress-Auth"), "1");
    assert.equal(headers.has("Authorization"), false);
  });

  const api = createApiClient({
    baseUrl: "/api/proxy",
    useProxy: true,
    backendUrlOverride: "https://typed-controller.example",
    apiKeyOverride: "",
  });

  await api.getStatus({ timeout: 1_000, retries: 0 });
});

test("proxy suppress-auth header prevents saved settings key from reaching override backend", async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "local-studio-proxy-auth-"));
  dataDirs.push(dataDir);
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  writeFileSync(
    path.join(dataDir, "api-settings.json"),
    JSON.stringify({
      backendUrl: "https://saved-controller.example",
      apiKey: "saved-controller-secret",
      voiceUrl: "",
      voiceModel: "whisper-large-v3-turbo",
    }),
    "utf-8",
  );

  let upstreamHeaders: Headers | null = null;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    upstreamHeaders = new Headers(init?.headers);
    return new Response(
      JSON.stringify({
        running: true,
        process: null,
        inference_port: 8000,
        launching: null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const { GET } = await import("@/app/api/proxy/[...path]/route");
  const request = new Request("http://localhost/api/proxy/status?api_key=query-secret", {
    headers: {
      "X-Backend-Url": "https://typed-controller.example",
      "X-Backend-Strict": "1",
      "X-Backend-Suppress-Auth": "1",
    },
  }) as Request & { cookies: { get: () => undefined } };
  request.cookies = { get: () => undefined };
  const response = await GET(
    request as never,
    { params: Promise.resolve({ path: ["status"] }) },
  );

  assert.equal(response.status, 200);
  assert.equal(upstreamHeaders?.has("Authorization"), false);
  assert.equal(upstreamHeaders?.has("X-Backend-Suppress-Auth"), false);
});

test("omitted API key override still uses the active stored key", async () => {
  process.env.LOCAL_STUDIO_API_KEY = "stored-controller-secret";
  installStatusFetch((headers) => {
    assert.equal(headers.get("Authorization"), "Bearer stored-controller-secret");
  });

  const api = createApiClient({
    baseUrl: "/api/proxy",
    useProxy: true,
    backendUrlOverride: "https://active-controller.example",
  });

  await api.getStatus({ timeout: 1_000, retries: 0 });
});
