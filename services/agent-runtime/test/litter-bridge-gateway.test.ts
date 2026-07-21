import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Schema } from "effect";
import { LitterBridgeControllerActionRequestSchema } from "../../../shared/agent/litter-bridge";
import {
  canonicalLitterBridgeJson,
  createLitterBridgeGateway,
  litterBridgeBodyHash,
  litterBridgeMessageHashPreimage,
  litterBridgeSessionHashPreimage,
  litterBridgeSha256Utf8,
  litterBridgeSignaturePreimage,
  litterBridgeToolHashPreimage,
  verifyLitterBridgeRequest,
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
  unsigned: Record<string, unknown> = {
    type: "controller_snapshot_request",
    protocolVersion: 1,
    controllerId: CONTROLLER_ID,
  },
  authOverrides: Record<string, unknown> = {},
) => {
  const bodyHash = litterBridgeBodyHash(unsigned);
  const auth = {
    device: { deviceId: publicHex, keyId: publicHex, algorithm: "ed25519" },
    requestId: "request-1",
    issuedAt: "2026-07-20T18:29:50.000Z",
    expiresAt: "2026-07-20T18:30:20.000Z",
    nonce: "nonce-0123456789",
    bodyHash,
    signature: "",
    capability:
      unsigned.type === "session_read_request" || unsigned.type === "session_list_request"
        ? "sessions.read"
        : "stats.read",
    ...authOverrides,
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
      ...(typeof auth.idempotencyKey === "string"
        ? { idempotencyKey: auth.idempotencyKey }
        : {}),
      bodyHash,
    }),
    privateKey,
  ).toString("base64url");
  return { ...unsigned, auth };
};

const controllerFetch =
  (failedRoute?: string, expectedAuthorization: string | null = null) =>
  async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).get("authorization"), expectedAuthorization);
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

const encodeCwdForPi = (cwd: string): string =>
  `--${path.resolve(cwd).replace(/^\//, "").replace(/\/+/g, "-")}--`;

const createSessionFixture = (
  sessionId = "019f7ca0-1f06-78a3-b4f2-58b6672994af",
  events?: Record<string, unknown>[],
) => {
  const directory = mkdtempSync(path.join(tmpdir(), "local-studio-litter-session-"));
  const project = path.join(directory, "project");
  const sessionRoot = path.join(directory, "sessions");
  const sessionDirectory = path.join(sessionRoot, encodeCwdForPi(project));
  mkdirSync(project, { recursive: true });
  mkdirSync(sessionDirectory, { recursive: true });
  const entries = events ?? [
    {
      type: "model_change",
      id: "model-1",
      parentId: null,
      timestamp: "2026-07-20T18:29:01.000Z",
      provider: "provider-a",
      modelId: "model-a",
    },
    {
      type: "thinking_level_change",
      id: "thinking-1",
      parentId: "model-1",
      timestamp: "2026-07-20T18:29:02.000Z",
      thinkingLevel: "high",
    },
    {
      type: "message",
      id: "user-1",
      parentId: "thinking-1",
      timestamp: "2026-07-20T18:29:03.000Z",
      message: { role: "user", content: [{ type: "text", text: "Run the model" }] },
    },
    {
      type: "message",
      id: "assistant-1",
      parentId: "user-1",
      timestamp: "2026-07-20T18:29:04.000Z",
      message: {
        role: "assistant",
        provider: "provider-a",
        model: "model-a",
        content: [
          { type: "thinking", thinking: "Checking" },
          { type: "text", text: "Done" },
        ],
      },
    },
  ];
  const header = {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-07-20T18:29:00.000Z",
    cwd: project,
  };
  const filepath = path.join(sessionDirectory, `2026-07-20T18-29-00_${sessionId}.jsonl`);
  writeFileSync(
    filepath,
    `${[header, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );
  return {
    directory,
    project,
    sessionRoot,
    sessionDirectory,
    sessionId,
    filepath,
    header,
    entries,
  };
};

const sessionReadRequest = (
  privateKey: KeyObject,
  publicHex: string,
  input: {
    sessionId?: string;
    installationId?: string;
    authority?: "local-studio" | "litter";
    cursor?: Record<string, unknown> | null;
    limit?: number;
    request?: string;
    authOverrides?: Record<string, unknown>;
  } = {},
) => {
  const suffix = input.request ?? "1";
  return signedRequest(
    privateKey,
    publicHex,
    {
      type: "session_read_request",
      protocolVersion: 1,
      session:
        input.cursor === undefined
          ? {
              kind: "external_session",
              authority: input.authority ?? "local-studio",
              installationId: input.installationId ?? CONTROLLER_ID,
              sessionId: input.sessionId ?? "019f7ca0-1f06-78a3-b4f2-58b6672994af",
            }
          : null,
      cursor: input.cursor ?? null,
      limit: input.limit ?? 200,
    },
    {
      requestId: `session-request-${suffix}`,
      nonce: `session-nonce-${suffix.padStart(16, "0")}`,
      ...input.authOverrides,
    },
  );
};

const sessionListRequest = (
  privateKey: KeyObject,
  publicHex: string,
  input: {
    cursor?: Record<string, unknown> | null;
    limit?: number;
    request?: string;
    authOverrides?: Record<string, unknown>;
  } = {},
) => {
  const suffix = input.request ?? "1";
  return signedRequest(
    privateKey,
    publicHex,
    {
      type: "session_list_request",
      protocolVersion: 1,
      cursor: input.cursor ?? null,
      limit: input.limit ?? 200,
    },
    {
      requestId: `session-list-request-${suffix}`,
      nonce: `session-list-nonce-${suffix.padStart(16, "0")}`,
      ...input.authOverrides,
    },
  );
};

const writeListedSession = (
  fixture: ReturnType<typeof createSessionFixture>,
  sessionId: string,
  updatedAt: string,
  filenamePrefix = updatedAt.replaceAll(":", "-"),
) => {
  const filepath = path.join(fixture.sessionDirectory, `${filenamePrefix}_${sessionId}.jsonl`);
  writeFileSync(
    filepath,
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: updatedAt,
      cwd: fixture.project,
    })}\n${JSON.stringify({
      type: "message",
      id: `user-${sessionId}`,
      parentId: null,
      timestamp: updatedAt,
      message: { role: "user", content: `Prompt ${sessionId}` },
    })}\n`,
  );
  const time = new Date(updatedAt);
  utimesSync(filepath, time, time);
  return filepath;
};

const fixtureGateway = (
  fixture: ReturnType<typeof createSessionFixture>,
  options: Record<string, unknown> = {},
) =>
  createLitterBridgeGateway({
    secret: SECRET,
    controllerId: CONTROLLER_ID,
    dataDir: fixture.directory,
    now: () => new Date(NOW),
    projects: () => [{ path: fixture.project, exists: true }],
    sessionRoots: [fixture.sessionRoot],
    ...options,
  });

test("canonical JSON sorts recursively and rejects fractions", () => {
  assert.equal(
    canonicalLitterBridgeJson({ z: [3, { b: true, a: null }], a: "x" }),
    '{"a":"x","z":[3,{"a":null,"b":true}]}',
  );
  assert.throws(() => canonicalLitterBridgeJson({ value: 1.5 }));
});

test("session hash preimages are explicit canonical UTF-8 vectors", () => {
  const descriptor = {
    messageId: "message-1",
    parentMessageId: null,
    sequence: 1,
    role: "user" as const,
    createdAt: "2026-07-20T18:29:03.000Z",
    editedAt: null,
    parts: [{ type: "text" as const, text: "Run the model" }],
  };
  const preimage = litterBridgeMessageHashPreimage(descriptor);
  assert.equal(
    preimage,
    '["litter-bridge-message-v1",{"createdAt":"2026-07-20T18:29:03.000Z","editedAt":null,"messageId":"message-1","parentMessageId":null,"parts":[{"text":"Run the model","type":"text"}],"role":"user","sequence":1}]',
  );
  assert.equal(
    litterBridgeSha256Utf8(preimage),
    "457574c68b62994f9d79b9bc34d3f5835908af259d382ae6e502b9887ed59ff7",
  );
});

test("signed sessions.read exports the exact canonical identity and deterministic hashes", async () => {
  const fixture = createSessionFixture();
  const keys = keyMaterial();
  const gateway = fixtureGateway(fixture);
  const response = await gateway.handle(
    gatewayRequest(sessionReadRequest(keys.privateKey, keys.publicHex)),
  );
  assert.equal(response.status, 200);
  const page = (await response.json()) as Record<string, any>;
  assert.deepEqual(page.canonicalSession, {
    kind: "external_session",
    authority: "local-studio",
    installationId: CONTROLLER_ID,
    sessionId: fixture.sessionId,
  });
  assert.equal(page.metadata.cwd, realpathSync(fixture.project));
  assert.equal(page.metadata.modelId, "model-a");
  assert.equal(page.metadata.providerId, "provider-a");
  assert.deepEqual(
    page.messages.map((message: Record<string, unknown>) => [message.sequence, message.role]),
    [
      [1, "user"],
      [2, "assistant"],
    ],
  );
  assert.deepEqual(page.messages[1].parts, [
    { type: "reasoning", text: "Checking" },
    { type: "text", text: "Done" },
  ]);
  for (const message of page.messages) {
    const { contentHash, ...descriptor } = message;
    assert.equal(contentHash, litterBridgeSha256Utf8(litterBridgeMessageHashPreimage(descriptor)));
  }
  assert.deepEqual(
    page.contentHashes.messages,
    page.messages.map((message: Record<string, string>) => ({
      id: message.messageId,
      sha256: message.contentHash,
    })),
  );
  const { session: sessionHash, ...orderedHashes } = page.contentHashes;
  assert.equal(
    sessionHash,
    litterBridgeSha256Utf8(
      litterBridgeSessionHashPreimage({
        canonicalSession: page.canonicalSession,
        metadata: page.metadata,
        revision: page.revision,
        messages: orderedHashes.messages,
        tools: orderedHashes.tools,
        attachments: orderedHashes.attachments,
      }),
    ),
  );
  assert.equal(page.cursor, null);
});

test("signed sessions.read discovery is trusted, deterministic, paginated, and replay-safe", async () => {
  const fixture = createSessionFixture("session-b");
  const keys = keyMaterial();
  const tiedTime = "2026-07-20T18:30:00.000Z";
  utimesSync(fixture.filepath, new Date(tiedTime), new Date(tiedTime));
  writeListedSession(fixture, "session-a", tiedTime);
  writeListedSession(fixture, "session-c", "2026-07-20T18:31:00.000Z");
  writeListedSession(fixture, "session-ambiguous", "2026-07-20T18:32:00.000Z", "first");
  writeListedSession(fixture, "session-ambiguous", "2026-07-20T18:32:00.000Z", "second");
  const gateway = fixtureGateway(fixture, {
    activeSessionIds: () => new Set(["session-c"]),
    archivedSessionIds: () => new Set(["session-a"]),
  });
  const firstRequest = sessionListRequest(keys.privateKey, keys.publicHex, {
    limit: 2,
    request: "discovery-first",
  });
  const first = await gateway.handle(gatewayRequest(firstRequest));
  assert.equal(first.status, 200);
  const firstPage = (await first.json()) as Record<string, any>;
  assert.equal(firstPage.type, "session_list_page");
  assert.equal(firstPage.controllerId, CONTROLLER_ID);
  assert.deepEqual(
    firstPage.sessions.map((entry: Record<string, any>) => entry.session.sessionId),
    ["session-c", "session-a"],
  );
  assert.deepEqual(firstPage.sessions[0].session, {
    kind: "external_session",
    authority: "local-studio",
    installationId: CONTROLLER_ID,
    sessionId: "session-c",
  });
  assert.equal(firstPage.sessions[0].active, true);
  assert.equal(firstPage.sessions[1].archived, true);
  assert.equal(firstPage.cursor.hasMore, true);
  assert.equal(firstPage.cursor.revision, firstPage.revision);

  const second = await gateway.handle(
    gatewayRequest(
      sessionListRequest(keys.privateKey, keys.publicHex, {
        cursor: firstPage.cursor,
        limit: 2,
        request: "discovery-second",
      }),
    ),
  );
  assert.equal(second.status, 200);
  const secondPage = (await second.json()) as Record<string, any>;
  assert.deepEqual(
    secondPage.sessions.map((entry: Record<string, any>) => entry.session.sessionId),
    ["session-b"],
  );
  assert.equal(secondPage.cursor, null);
  assert.equal(secondPage.revision, firstPage.revision);

  const replay = await gateway.handle(gatewayRequest(firstRequest));
  assert.equal(replay.status, 409);
  assert.equal(((await replay.json()) as Record<string, any>).error.code, "replay_detected");
});

test("session discovery cursors reject tampering and cross-device use and are single-use", async () => {
  const fixture = createSessionFixture("session-a");
  writeListedSession(fixture, "session-b", "2026-07-20T18:31:00.000Z");
  const owner = keyMaterial();
  const otherDevice = keyMaterial();
  let clock = NOW.getTime();
  const gateway = fixtureGateway(fixture, {
    now: () => new Date(clock),
    sessionCursorTtlMs: 1_000,
  });
  const first = await gateway.handle(
    gatewayRequest(
      sessionListRequest(owner.privateKey, owner.publicHex, {
        limit: 1,
        request: "list-cursor-first",
      }),
    ),
  );
  assert.equal(first.status, 200);
  const firstPage = (await first.json()) as Record<string, any>;
  assert.ok(firstPage.cursor);

  const tampered = await gateway.handle(
    gatewayRequest(
      sessionListRequest(owner.privateKey, owner.publicHex, {
        cursor: { ...firstPage.cursor, revision: firstPage.cursor.revision + 1 },
        request: "list-cursor-tampered",
      }),
    ),
  );
  assert.equal(tampered.status, 400);

  const crossDevice = await gateway.handle(
    gatewayRequest(
      sessionListRequest(otherDevice.privateKey, otherDevice.publicHex, {
        cursor: firstPage.cursor,
        request: "list-cursor-cross-device",
      }),
    ),
  );
  assert.equal(crossDevice.status, 403);

  const continuation = await gateway.handle(
    gatewayRequest(
      sessionListRequest(owner.privateKey, owner.publicHex, {
        cursor: firstPage.cursor,
        request: "list-cursor-owner",
      }),
    ),
  );
  assert.equal(continuation.status, 200);

  const reused = await gateway.handle(
    gatewayRequest(
      sessionListRequest(owner.privateKey, owner.publicHex, {
        cursor: firstPage.cursor,
        request: "list-cursor-reused",
      }),
    ),
  );
  assert.equal(reused.status, 400);

  const expiring = await gateway.handle(
    gatewayRequest(
      sessionListRequest(owner.privateKey, owner.publicHex, {
        limit: 1,
        request: "list-cursor-expiring",
      }),
    ),
  );
  const expiringPage = (await expiring.json()) as Record<string, any>;
  clock += 2_000;
  const expired = await gateway.handle(
    gatewayRequest(
      sessionListRequest(owner.privateKey, owner.publicHex, {
        cursor: expiringPage.cursor,
        request: "list-cursor-expired",
      }),
    ),
  );
  assert.equal(expired.status, 400);
});

test("session discovery fails closed when the trusted inventory exceeds its bound", async () => {
  const fixture = createSessionFixture("session-a");
  writeListedSession(fixture, "session-b", "2026-07-20T18:31:00.000Z");
  const keys = keyMaterial();
  const response = await fixtureGateway(fixture, { sessionInventoryLimit: 1 }).handle(
    gatewayRequest(sessionListRequest(keys.privateKey, keys.publicHex, { request: "list-bound" })),
  );
  assert.equal(response.status, 413);
  assert.equal(((await response.json()) as Record<string, any>).error.code, "payload_too_large");
});

test("tool references, results, and descriptor hashes retain Pi order", async () => {
  const fixture = createSessionFixture("tool-session-1", [
    {
      type: "message",
      id: "user-1",
      parentId: null,
      timestamp: "2026-07-20T18:29:01.000Z",
      message: { role: "user", content: "Check status" },
    },
    {
      type: "message",
      id: "assistant-1",
      parentId: "user-1",
      timestamp: "2026-07-20T18:29:02.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Inspecting" },
          { type: "toolCall", id: "call-1", name: "status", arguments: { z: 2, a: 1 } },
        ],
      },
    },
    {
      type: "message",
      id: "tool-1",
      parentId: "assistant-1",
      timestamp: "2026-07-20T18:29:03.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "status",
        content: [{ type: "text", text: "healthy" }],
        isError: false,
      },
    },
  ]);
  const keys = keyMaterial();
  const response = await fixtureGateway(fixture).handle(
    gatewayRequest(
      sessionReadRequest(keys.privateKey, keys.publicHex, {
        sessionId: fixture.sessionId,
        request: "tools",
      }),
    ),
  );
  assert.equal(response.status, 200);
  const page = (await response.json()) as Record<string, any>;
  assert.deepEqual(
    page.messages.map((message: Record<string, unknown>) => message.role),
    ["user", "assistant", "tool"],
  );
  assert.deepEqual(page.messages[1].parts, [
    { type: "reasoning", text: "Inspecting" },
    { type: "tool_ref", toolCallId: "call-1" },
  ]);
  assert.equal(page.tools[0].argumentsJson, '{"a":1,"z":2}');
  assert.equal(page.tools.length, 1);
  assert.equal(page.tools[0].state, "completed");
  assert.equal(
    page.tools[0].resultJson,
    '{"content":[{"text":"healthy","type":"text"}],"isError":false}',
  );
  assert.deepEqual(
    page.contentHashes.tools.map((entry: Record<string, string>) => entry.id),
    ["call-1"],
  );
  page.tools.forEach((tool: Record<string, unknown>, index: number) => {
    assert.equal(
      page.contentHashes.tools[index].sha256,
      litterBridgeSha256Utf8(litterBridgeToolHashPreimage(tool as any)),
    );
  });
});

test("valid signed read returns a strict complete snapshot and replay is rejected", async () => {
  const keys = keyMaterial();
  const gateway = createLitterBridgeGateway({
    secret: SECRET,
    controllerId: CONTROLLER_ID,
    displayName: "Test Studio",
    controllerUrl: "http://127.0.0.1:8080",
    controllerApiKey: "controller-secret",
    now: () => new Date(NOW),
    fetch: controllerFetch(undefined, "Bearer controller-secret"),
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
  assert.deepEqual(snapshot.capabilities, ["stats.read"]);
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

test("mutation signature verification binds idempotency without enabling dispatch", async () => {
  const keys = keyMaterial();
  const body = signedRequest(
    keys.privateKey,
    keys.publicHex,
    {
      type: "controller_action_request",
      protocolVersion: 1,
      controllerId: CONTROLLER_ID,
      expectedRevision: 1,
      action: { type: "evict_model", modelId: "model-a" },
    },
    {
      capability: "models.control",
      idempotencyKey: "idempotency-1",
      requestId: "mutation-request-1",
      nonce: "mutation-nonce-0001",
    },
  );
  const parsed = Schema.decodeUnknownSync(LitterBridgeControllerActionRequestSchema)(body);
  assert.equal(verifyLitterBridgeRequest(parsed, NOW).ok, true);

  const changed = verifyLitterBridgeRequest(
    { ...parsed, auth: { ...parsed.auth, idempotencyKey: "idempotency-2" } },
    NOW,
  );
  assert.equal(changed.ok, false);
  if (changed.ok) assert.fail("Changed idempotency key unexpectedly verified");
  assert.equal(changed.response.status, 401);
  assert.equal(((await changed.response.json()) as Record<string, any>).error.code, "unauthorized");

  const { idempotencyKey: _idempotencyKey, ...authWithoutIdempotency } = parsed.auth;
  const omitted = verifyLitterBridgeRequest(
    { ...parsed, auth: authWithoutIdempotency } as typeof parsed,
    NOW,
  );
  assert.equal(omitted.ok, false);
  if (omitted.ok) assert.fail("Missing idempotency key unexpectedly verified");
  assert.equal(omitted.response.status, 401);
  assert.equal(((await omitted.response.json()) as Record<string, any>).error.code, "unauthorized");

  const gateway = createLitterBridgeGateway({
    secret: SECRET,
    controllerId: CONTROLLER_ID,
    now: () => new Date(NOW),
  });
  const unsupported = await gateway.handle(gatewayRequest(body));
  assert.equal(unsupported.status, 400);
  assert.equal(((await unsupported.json()) as Record<string, any>).error.code, "invalid_request");
});

test("sessions.read rejects cross-controller identity, missing IDs, ambiguity, and extras", async () => {
  const fixture = createSessionFixture();
  const keys = keyMaterial();
  const secondRoot = path.join(fixture.directory, "sessions-duplicate");
  const secondDirectory = path.join(secondRoot, encodeCwdForPi(fixture.project));
  mkdirSync(secondDirectory, { recursive: true });
  writeFileSync(
    path.join(secondDirectory, `duplicate_${fixture.sessionId}.jsonl`),
    readFileSync(fixture.filepath),
  );
  const gateway = fixtureGateway(fixture, { sessionRoots: [fixture.sessionRoot, secondRoot] });
  const wrongController = await gateway.handle(
    gatewayRequest(
      sessionReadRequest(keys.privateKey, keys.publicHex, {
        installationId: "controller-other",
        request: "wrong-controller",
      }),
    ),
  );
  assert.equal(wrongController.status, 404);
  const missing = await gateway.handle(
    gatewayRequest(
      sessionReadRequest(keys.privateKey, keys.publicHex, {
        sessionId: "missing-session",
        request: "missing",
      }),
    ),
  );
  assert.equal(missing.status, 404);
  const ambiguous = await gateway.handle(
    gatewayRequest(
      sessionReadRequest(keys.privateKey, keys.publicHex, {
        sessionId: fixture.sessionId,
        request: "ambiguous",
      }),
    ),
  );
  assert.equal(ambiguous.status, 404);
  const strictBody = {
    ...sessionReadRequest(keys.privateKey, keys.publicHex, { request: "extra" }),
    unexpected: true,
  };
  const strict = await gateway.handle(gatewayRequest(strictBody));
  assert.equal(strict.status, 400);
  assert.equal(((await strict.json()) as Record<string, any>).error.code, "invalid_request");
});

test("opaque cursors reject tampering, cross-device use, and expiry", async () => {
  const fixture = createSessionFixture();
  const firstKeys = keyMaterial();
  const secondKeys = keyMaterial();
  let clock = NOW.getTime();
  const gateway = fixtureGateway(fixture, {
    now: () => new Date(clock),
    sessionCursorTtlMs: 1_000,
  });
  const first = await gateway.handle(
    gatewayRequest(
      sessionReadRequest(firstKeys.privateKey, firstKeys.publicHex, {
        limit: 1,
        request: "cursor-first",
      }),
    ),
  );
  assert.equal(first.status, 200);
  const firstPage = (await first.json()) as Record<string, any>;
  assert.equal(firstPage.messages.length, 1);
  assert.equal(typeof firstPage.cursor.token, "string");
  assert.equal(firstPage.cursor.token.includes(fixture.filepath), false);
  const tamperedCursor = { ...firstPage.cursor, afterSequence: firstPage.cursor.afterSequence + 1 };
  const tampered = await gateway.handle(
    gatewayRequest(
      sessionReadRequest(firstKeys.privateKey, firstKeys.publicHex, {
        cursor: tamperedCursor,
        request: "cursor-tampered",
      }),
    ),
  );
  assert.equal(tampered.status, 400);
  const crossDevice = await gateway.handle(
    gatewayRequest(
      sessionReadRequest(secondKeys.privateKey, secondKeys.publicHex, {
        cursor: firstPage.cursor,
        request: "cursor-device",
      }),
    ),
  );
  assert.equal(crossDevice.status, 403);
  clock += 2_000;
  const expired = await gateway.handle(
    gatewayRequest(
      sessionReadRequest(firstKeys.privateKey, firstKeys.publicHex, {
        cursor: firstPage.cursor,
        request: "cursor-expired",
      }),
    ),
  );
  assert.equal(expired.status, 400);
  assert.equal(((await expired.json()) as Record<string, any>).error.code, "invalid_request");
});

test("session pages stay below the fixed response cap and continue by opaque byte state", async () => {
  const largeText = "x".repeat(600_000);
  const fixture = createSessionFixture("large-session-1", [
    {
      type: "message",
      id: "large-user",
      parentId: null,
      timestamp: "2026-07-20T18:29:01.000Z",
      message: { role: "user", content: largeText },
    },
    {
      type: "message",
      id: "large-assistant",
      parentId: "large-user",
      timestamp: "2026-07-20T18:29:02.000Z",
      message: { role: "assistant", content: largeText },
    },
  ]);
  const keys = keyMaterial();
  const gateway = fixtureGateway(fixture);
  const first = await gateway.handle(
    gatewayRequest(
      sessionReadRequest(keys.privateKey, keys.publicHex, {
        sessionId: fixture.sessionId,
        request: "large-first",
      }),
    ),
  );
  assert.equal(first.status, 200);
  const firstBytes = Buffer.from(await first.arrayBuffer());
  assert.ok(firstBytes.byteLength <= 1_000_000);
  const firstPage = JSON.parse(firstBytes.toString("utf8")) as Record<string, any>;
  assert.equal(firstPage.messages.length, 1);
  assert.ok(firstPage.cursor);
  const second = await gateway.handle(
    gatewayRequest(
      sessionReadRequest(keys.privateKey, keys.publicHex, {
        cursor: firstPage.cursor,
        request: "large-second",
      }),
    ),
  );
  assert.equal(second.status, 200);
  const secondBytes = Buffer.from(await second.arrayBuffer());
  assert.ok(secondBytes.byteLength <= 1_000_000);
  const secondPage = JSON.parse(secondBytes.toString("utf8")) as Record<string, any>;
  assert.equal(secondPage.messages[0].sequence, 2);
  assert.equal(secondPage.cursor, null);
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
