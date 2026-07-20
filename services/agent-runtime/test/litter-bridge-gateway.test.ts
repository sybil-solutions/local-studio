import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalLitterBridgeJson,
  createLitterBridgeGateway,
  litterBridgeBodyHash,
  litterBridgeSignaturePreimage,
} from "../src/litter-bridge-gateway";

const NOW = new Date("2026-07-20T18:30:00.000Z");
const SECRET = "test-secret-that-is-at-least-thirty-two-bytes-long";
const CONTROLLER_ID = "controller-test";

const keyMaterial = (): { privateKey: KeyObject; publicHex: string } => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, publicHex: spki.subarray(spki.length - 32).toString("hex") };
};

const signedRequest = (
  privateKey: KeyObject,
  publicHex: string,
  overrides: Record<string, unknown> = {},
) => {
  const unsigned = {
    type: "controller_snapshot_request",
    protocolVersion: 1,
    controllerId: CONTROLLER_ID,
    ...overrides,
  };
  const bodyHash = litterBridgeBodyHash(unsigned);
  const auth = {
    device: { deviceId: publicHex, keyId: publicHex, algorithm: "ed25519" },
    requestId: "request-1",
    issuedAt: "2026-07-20T18:29:50.000Z",
    expiresAt: "2026-07-20T18:30:20.000Z",
    nonce: "nonce-0123456789",
    bodyHash,
    signature: "",
    capability: "stats.read",
  };
  auth.signature = sign(
    null,
    litterBridgeSignaturePreimage({
      deviceId: publicHex,
      keyId: publicHex,
      requestId: auth.requestId,
      issuedAt: auth.issuedAt,
      expiresAt: auth.expiresAt,
      nonce: auth.nonce,
      capability: auth.capability,
      bodyHash,
    }),
    privateKey,
  ).toString("base64url");
  return { ...unsigned, auth };
};

const controllerFetch =
  (failedRoute?: string) =>
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    if (url.pathname === failedRoute) return Response.json({ error: "down" }, { status: 503 });
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    if (url.pathname === "/status") {
      return Response.json({
        running: true,
        process: { served_model_name: "model-a" },
        inference_port: 8000,
        launching: null,
      });
    }
    if (url.pathname === "/gpus") {
      return Response.json({
        count: 1,
        gpus: [
          {
            id: "gpu-a",
            index: 0,
            name: "Test GPU",
            memory_total_mb: 1024,
            memory_used_mb: 256,
            memory_free_mb: 768,
            utilization_pct: 25,
            temp_c: 50,
            power_draw: 75,
          },
        ],
      });
    }
    if (url.pathname === "/v1/metrics/vllm") {
      return Response.json({
        running_requests: 2,
        pending_requests: 1,
        prompt_throughput: 100,
        generation_throughput: 40,
        avg_ttft_ms: 25,
        kv_cache_usage: 0.5,
      });
    }
    return Response.json({ error: "missing" }, { status: 404 });
  };

const gatewayRequest = (body: unknown, secret = SECRET): Request =>
  new Request("http://127.0.0.1:8081/api/litter-bridge/v1", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-local-studio-litter-bridge-secret": secret,
    },
    body: JSON.stringify(body),
  });

test("canonical JSON sorts recursively and rejects fractions", () => {
  assert.equal(
    canonicalLitterBridgeJson({ z: [3, { b: true, a: null }], a: "x" }),
    '{"a":"x","z":[3,{"a":null,"b":true}]}',
  );
  assert.throws(() => canonicalLitterBridgeJson({ value: 1.5 }));
});

test("valid signed read returns a strict complete snapshot and replay is rejected", async () => {
  const keys = keyMaterial();
  const gateway = createLitterBridgeGateway({
    secret: SECRET,
    controllerId: CONTROLLER_ID,
    displayName: "Test Studio",
    controllerUrl: "http://127.0.0.1:8080",
    now: () => new Date(NOW),
    fetch: controllerFetch(),
    runtimeStats: () => ({
      runningSessionCount: 3,
      activeTurnCount: 1,
      persistedSessionCount: 12,
      eventSequence: 44,
    }),
  });
  const body = signedRequest(keys.privateKey, keys.publicHex);
  const response = await gateway.handle(gatewayRequest(body));
  assert.equal(response.status, 200);
  const snapshot = (await response.json()) as Record<string, any>;
  assert.equal(snapshot.type, "controller_snapshot");
  assert.equal(snapshot.state, "healthy");
  assert.equal(snapshot.sections.status.value.activeModelIds[0], "model-a");
  assert.equal(snapshot.sections.gpus.value.devices[0].memoryTotalBytes, 1024 * 1024 * 1024);
  assert.equal(snapshot.sections.metrics.value.cacheUsagePercent, 50);
  assert.equal(snapshot.sections.agentRuntime.value.persistedSessionCount, 12);
  const replay = await gateway.handle(gatewayRequest(body));
  assert.equal(replay.status, 409);
  assert.equal(((await replay.json()) as Record<string, any>).error.code, "replay_detected");
});

test("gateway secret and signed body integrity fail closed", async () => {
  const keys = keyMaterial();
  const gateway = createLitterBridgeGateway({
    secret: SECRET,
    controllerId: CONTROLLER_ID,
    controllerUrl: "http://127.0.0.1:8080",
    now: () => new Date(NOW),
    fetch: controllerFetch(),
  });
  const body = signedRequest(keys.privateKey, keys.publicHex);
  const wrongSecret = await gateway.handle(gatewayRequest(body, "wrong-secret"));
  assert.equal(wrongSecret.status, 401);
  const tampered = { ...body, controllerId: "controller-other" };
  const integrity = await gateway.handle(gatewayRequest(tampered));
  assert.equal(integrity.status, 401);
  assert.equal(((await integrity.json()) as Record<string, any>).error.code, "integrity_failed");
});

test("independent controller failures produce an explicit degraded partial snapshot", async () => {
  const keys = keyMaterial();
  const gateway = createLitterBridgeGateway({
    secret: SECRET,
    controllerId: CONTROLLER_ID,
    controllerUrl: "http://127.0.0.1:8080",
    now: () => new Date(NOW),
    fetch: controllerFetch("/v1/metrics/vllm"),
  });
  const response = await gateway.handle(
    gatewayRequest(signedRequest(keys.privateKey, keys.publicHex)),
  );
  assert.equal(response.status, 200);
  const snapshot = (await response.json()) as Record<string, any>;
  assert.equal(snapshot.state, "degraded");
  assert.equal(snapshot.sections.health.value.reachable, true);
  assert.equal(snapshot.sections.metrics.value, null);
  assert.equal(snapshot.sections.metrics.error.code, "section_unavailable");
});

test("published handoff metadata is private and removed only by its owner", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "local-studio-litter-gateway-"));
  const gateway = createLitterBridgeGateway({
    secret: SECRET,
    controllerId: CONTROLLER_ID,
    dataDir: directory,
    now: () => new Date(NOW),
  });
  gateway.publishMetadata(54321);
  const filepath = path.join(directory, "litter-bridge.json");
  const metadata = JSON.parse(readFileSync(filepath, "utf8")) as Record<string, unknown>;
  assert.equal(metadata.url, "http://127.0.0.1:54321/api/litter-bridge/v1");
  assert.equal(statSync(filepath).mode & 0o777, 0o600);
  gateway.dispose();
  assert.throws(() => statSync(filepath));
});
