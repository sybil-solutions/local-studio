import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Schema } from "effect";
import {
  LITTER_BRIDGE_CAPABILITIES,
  LitterBridgeAgentTurnResultSchema,
  LitterBridgeCapabilitiesManifestSchema,
  LitterBridgeControllerActionRequestSchema,
  LitterBridgeControllerActionSchema,
  LitterBridgeControllerSnapshotSchema,
  LitterBridgeSessionListPageSchema,
  LitterBridgeSessionListRequestSchema,
  LitterBridgeSessionPageSchema,
  LitterBridgeSessionReadRequestSchema,
  LitterBridgeSessionTransferEnvelopeSchema,
  LitterBridgeSessionTransferResultSchema,
} from "./litter-bridge";

const timestamp = "2026-07-20T12:30:45.000Z";
const hash = "a".repeat(64);
const signature = "s".repeat(86);

const requestAuth = (capability: "models.control" | "sessions.write") => ({
  device: {
    deviceId: "device-1",
    keyId: "device-key-1",
    algorithm: "ed25519" as const,
  },
  requestId: "request-1",
  issuedAt: timestamp,
  expiresAt: "2026-07-20T12:31:45.000Z",
  nonce: "nonce_1234567890abcdef",
  bodyHash: hash,
  signature,
  capability,
  idempotencyKey: "idempotency-1",
});

const session = {
  kind: "external_session" as const,
  authority: "litter" as const,
  installationId: "litter-installation-1",
  sessionId: "session-1",
};

const metadata = {
  title: "Controller session",
  cwd: "/tmp/project",
  createdAt: timestamp,
  updatedAt: timestamp,
  modelId: "GLM-5.2",
  providerId: "openai-compatible",
};

const cursor = {
  type: "session_transfer_cursor" as const,
  token: "cursor-token-1",
  revision: 4,
  afterSequence: 1,
  hasMore: false,
};

const transfer = {
  type: "session_transfer" as const,
  protocolVersion: 1 as const,
  transferId: "transfer-1",
  auth: requestAuth("sessions.write"),
  direction: "litter_to_local_studio" as const,
  mode: "delta" as const,
  session,
  origin: {
    application: "litter" as const,
    installationId: "litter-installation-1",
    deviceId: "device-1",
    exportedAt: timestamp,
  },
  metadata,
  revision: 4,
  baseRevision: 3,
  expectedRevision: 3,
  messages: [
    {
      messageId: "message-1",
      parentMessageId: null,
      sequence: 1,
      role: "user" as const,
      createdAt: timestamp,
      editedAt: null,
      parts: [{ type: "text" as const, text: "Run the model" }],
      contentHash: hash,
    },
  ],
  tools: [
    {
      toolCallId: "tool-call-1",
      messageId: "message-1",
      name: "controller_status",
      state: "completed" as const,
      argumentsJson: "{}",
      argumentsHash: hash,
      resultJson: '{"running":true}',
      resultHash: hash,
      startedAt: timestamp,
      completedAt: timestamp,
    },
  ],
  attachments: [
    {
      attachmentId: "attachment-1",
      messageId: "message-1",
      fileName: "controller.json",
      mediaType: "application/json",
      byteLength: 512,
      contentHash: hash,
      blobId: "blob-1",
      availability: "available" as const,
    },
  ],
  contentHashes: {
    algorithm: "sha256" as const,
    session: hash,
    messages: [{ id: "message-1", sha256: hash }],
    tools: [{ id: "tool-call-1", sha256: hash }],
    attachments: [{ id: "attachment-1", sha256: hash }],
  },
  cursor,
  conflictPolicy: "fork" as const,
};

describe("Litter bridge contracts", () => {
  test("accepts only the versioned capability vocabulary", () => {
    const manifest = Schema.decodeUnknownSync(LitterBridgeCapabilitiesManifestSchema)({
      type: "capabilities",
      protocolVersion: 1,
      bridgeId: "bridge-1",
      controllerId: "controller-1",
      issuedAt: timestamp,
      capabilities: [...LITTER_BRIDGE_CAPABILITIES],
    });
    assert.deepEqual(manifest.capabilities, LITTER_BRIDGE_CAPABILITIES);
    assert.throws(() =>
      Schema.decodeUnknownSync(LitterBridgeCapabilitiesManifestSchema)({
        type: "capabilities",
        protocolVersion: 2,
        bridgeId: "bridge-1",
        controllerId: "controller-1",
        issuedAt: timestamp,
        capabilities: ["shell.execute"],
      }),
    );
  });

  test("rejects arbitrary controller targets and command fields", () => {
    assert.throws(() =>
      Schema.decodeUnknownSync(LitterBridgeControllerActionSchema)({
        type: "start_recipe",
        recipeId: "recipe-1",
        url: "https://example.invalid",
        method: "POST",
        body: { recipe: "recipe-1" },
        env: { TOKEN: "secret" },
        shell: "rm",
      }),
    );
    assert.throws(() =>
      Schema.decodeUnknownSync(LitterBridgeControllerActionRequestSchema)({
        type: "controller_action_request",
        protocolVersion: 1,
        auth: requestAuth("models.control"),
        controllerId: "controller-1",
        expectedRevision: 7,
        action: {
          type: "evict_model",
          modelId: "model-1",
          args: ["--force"],
          env: { TOKEN: "secret" },
          shell: "rm",
        },
      }),
    );
  });

  test("accepts a degraded snapshot with independent section results", () => {
    const freshness = {
      observedAt: timestamp,
      ageMs: 450,
      maxAgeMs: 1_000,
      stale: false,
      sourceRevision: 9,
    };
    const unavailable = {
      value: null,
      error: {
        code: "section_unavailable" as const,
        message: "Metrics timed out",
        retriable: true,
        requestId: null,
        details: {
          field: null,
          section: "metrics" as const,
          expectedRevision: null,
          currentRevision: 9,
          retryAfterMs: 1_000,
          limitBytes: null,
        },
      },
      freshness: {
        observedAt: null,
        ageMs: null,
        maxAgeMs: 1_000,
        stale: true,
        sourceRevision: null,
      },
    };
    const snapshot = Schema.decodeUnknownSync(LitterBridgeControllerSnapshotSchema)({
      type: "controller_snapshot",
      protocolVersion: 1,
      snapshotId: "snapshot-1",
      controllerId: "controller-1",
      displayName: "RTX workstation",
      generatedAt: timestamp,
      revision: 9,
      state: "degraded",
      capabilities: ["stats.read", "models.control"],
      sections: {
        health: {
          value: {
            state: "ok",
            reachable: true,
            checkedAt: timestamp,
            latencyMs: 12.5,
            controllerVersion: "2.1.0",
          },
          error: null,
          freshness,
        },
        status: { value: null, error: null, freshness },
        gpus: {
          value: { count: 0, devices: [] },
          error: null,
          freshness,
        },
        metrics: unavailable,
        agentRuntime: {
          value: {
            state: "degraded",
            reachable: true,
            runningSessionCount: 1,
            activeTurnCount: 1,
            persistedSessionCount: null,
            eventSequence: 12,
          },
          error: null,
          freshness,
        },
      },
    });
    assert.equal(snapshot.sections.metrics.value, null);
    assert.equal(snapshot.sections.health.value?.reachable, true);
    assert.equal(snapshot.state, "degraded");
  });

  test("validates transfer integrity descriptors and closed envelopes", () => {
    const decoded = Schema.decodeUnknownSync(LitterBridgeSessionTransferEnvelopeSchema)(transfer);
    assert.equal(decoded.contentHashes.algorithm, "sha256");
    assert.equal(decoded.messages[0]?.contentHash, hash);
    assert.throws(() =>
      Schema.decodeUnknownSync(LitterBridgeSessionTransferEnvelopeSchema)({
        ...transfer,
        contentHashes: { ...transfer.contentHashes, session: "not-a-sha256" },
      }),
    );
    assert.throws(() =>
      Schema.decodeUnknownSync(LitterBridgeSessionTransferEnvelopeSchema)({
        ...transfer,
        command: "arbitrary-shell-command",
      }),
    );
  });

  test("requires an unambiguous session read target", () => {
    const auth = {
      device: {
        deviceId: "device-1",
        keyId: "device-key-1",
        algorithm: "ed25519" as const,
      },
      requestId: "request-read-1",
      issuedAt: timestamp,
      expiresAt: "2026-07-20T12:31:45.000Z",
      nonce: "nonce_read_1234567890",
      bodyHash: hash,
      signature,
      capability: "sessions.read" as const,
    };
    const firstPage = Schema.decodeUnknownSync(LitterBridgeSessionReadRequestSchema)({
      type: "session_read_request",
      protocolVersion: 1,
      auth,
      session,
      cursor: null,
      limit: 50,
    });
    const continuation = Schema.decodeUnknownSync(LitterBridgeSessionReadRequestSchema)({
      type: "session_read_request",
      protocolVersion: 1,
      auth,
      session: null,
      cursor,
      limit: 50,
    });
    assert.equal(firstPage.session?.sessionId, "session-1");
    assert.equal(continuation.cursor?.token, "cursor-token-1");
    assert.throws(() =>
      Schema.decodeUnknownSync(LitterBridgeSessionReadRequestSchema)({
        type: "session_read_request",
        protocolVersion: 1,
        auth,
        session: null,
        cursor: null,
        limit: 50,
      }),
    );
  });

  test("validates strict paginated session discovery", () => {
    const auth = {
      device: {
        deviceId: "device-1",
        keyId: "device-key-1",
        algorithm: "ed25519" as const,
      },
      requestId: "request-list-1",
      issuedAt: timestamp,
      expiresAt: "2026-07-20T12:31:45.000Z",
      nonce: "nonce_list_1234567890",
      bodyHash: hash,
      signature,
      capability: "sessions.read" as const,
    };
    const listCursor = {
      type: "session_list_cursor" as const,
      token: "list-cursor-token-1",
      revision: 8,
      hasMore: true,
    };
    const firstPage = Schema.decodeUnknownSync(LitterBridgeSessionListRequestSchema)({
      type: "session_list_request",
      protocolVersion: 1,
      auth,
      cursor: null,
      limit: 50,
    });
    const continuation = Schema.decodeUnknownSync(LitterBridgeSessionListRequestSchema)({
      type: "session_list_request",
      protocolVersion: 1,
      auth,
      cursor: listCursor,
      limit: 50,
    });
    assert.equal(firstPage.cursor, null);
    assert.equal(continuation.cursor?.token, "list-cursor-token-1");
    assert.throws(() =>
      Schema.decodeUnknownSync(LitterBridgeSessionListRequestSchema)({
        type: "session_list_request",
        protocolVersion: 1,
        auth,
        cursor: { ...listCursor, hasMore: false },
        limit: 50,
      }),
    );
    assert.throws(() =>
      Schema.decodeUnknownSync(LitterBridgeSessionListRequestSchema)({
        type: "session_list_request",
        protocolVersion: 1,
        auth,
        cursor: null,
        limit: 50,
        cwd: "/untrusted",
      }),
    );

    const page = Schema.decodeUnknownSync(LitterBridgeSessionListPageSchema)({
      type: "session_list_page",
      protocolVersion: 1,
      requestId: "request-list-1",
      controllerId: "controller-1",
      revision: 8,
      sessions: [
        {
          session: {
            kind: "external_session",
            authority: "local-studio",
            installationId: "controller-1",
            sessionId: "session-1",
          },
          metadata,
          revision: 4,
          archived: false,
          active: true,
        },
      ],
      cursor: listCursor,
    });
    assert.equal(page.sessions[0]?.active, true);
    assert.throws(() =>
      Schema.decodeUnknownSync(LitterBridgeSessionListPageSchema)({
        ...page,
        cursor: { ...listCursor, revision: 7 },
      }),
    );
  });

  test("keeps session pages auth-free", () => {
    const page = {
      type: "session_page" as const,
      protocolVersion: 1 as const,
      requestId: "request-read-1",
      pageId: "page-1",
      canonicalSession: { ...session, authority: "local-studio" as const },
      origin: transfer.origin,
      metadata,
      revision: 4,
      messages: transfer.messages,
      tools: transfer.tools,
      attachments: transfer.attachments,
      contentHashes: transfer.contentHashes,
      cursor: null,
    };
    const decoded = Schema.decodeUnknownSync(LitterBridgeSessionPageSchema)(page);
    assert.equal(decoded.type, "session_page");
    assert.throws(() =>
      Schema.decodeUnknownSync(LitterBridgeSessionPageSchema)({
        ...page,
        auth: requestAuth("sessions.write"),
      }),
    );
  });

  test("distinguishes acknowledgement, conflict, and fork outcomes", () => {
    const ack = Schema.decodeUnknownSync(LitterBridgeSessionTransferResultSchema)({
      type: "ack",
      protocolVersion: 1,
      requestId: "request-1",
      transferId: "transfer-1",
      canonicalSession: { ...session, authority: "local-studio" },
      acceptedRevision: 4,
      appliedMessages: 1,
      appliedTools: 1,
      appliedAttachments: 1,
      contentHash: hash,
      cursor: null,
      acknowledgedAt: timestamp,
    });
    const conflict = Schema.decodeUnknownSync(LitterBridgeSessionTransferResultSchema)({
      type: "conflict",
      protocolVersion: 1,
      requestId: "request-1",
      operation: "session_transfer",
      expectedRevision: 3,
      currentRevision: 4,
      resolution: "fork_required",
      canonicalSession: { ...session, authority: "local-studio" },
      cursor,
      error: {
        code: "revision_conflict",
        message: "Session changed after export",
        retriable: true,
        requestId: "request-1",
        details: {
          field: null,
          section: null,
          expectedRevision: 3,
          currentRevision: 4,
          retryAfterMs: null,
          limitBytes: null,
        },
      },
    });
    const fork = Schema.decodeUnknownSync(LitterBridgeSessionTransferResultSchema)({
      type: "fork",
      protocolVersion: 1,
      requestId: "request-1",
      transferId: "transfer-1",
      sourceSession: session,
      canonicalSession: {
        ...session,
        authority: "local-studio",
        sessionId: "session-fork-1",
      },
      sourceRevision: 4,
      acceptedRevision: 1,
      reason: "revision_conflict",
      cursor: null,
      acknowledgedAt: timestamp,
    });
    assert.equal(ack.type, "ack");
    assert.equal(conflict.type, "conflict");
    assert.equal(fork.type, "fork");
  });

  test("keeps prompt dispatch acknowledgements explicit and strict", () => {
    const acknowledgement = Schema.decodeUnknownSync(LitterBridgeAgentTurnResultSchema)({
      type: "agent_turn_ack",
      protocolVersion: 1,
      requestId: "request-turn-1",
      idempotencyKey: "idempotency-turn-1",
      dispatchId: "dispatch-turn-1",
      canonicalSession: { ...session, authority: "local-studio" },
      messageId: "message-turn-1",
      contentHash: hash,
      baseRevision: 4,
      piSessionId: "session-1",
      modelId: "GLM-5.2",
      outcome: "accepted",
      acceptedAt: timestamp,
    });
    assert.equal(acknowledgement.type, "agent_turn_ack");
    assert.throws(() =>
      Schema.decodeUnknownSync(LitterBridgeAgentTurnResultSchema)({
        ...acknowledgement,
        durable: true,
      }),
    );
  });
});
