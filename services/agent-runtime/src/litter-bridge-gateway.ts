import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { Schema } from "effect";
import {
  LITTER_BRIDGE_PROTOCOL_VERSION,
  LitterBridgeControllerSnapshotRequestSchema,
  LitterBridgeControllerSnapshotSchema,
  LitterBridgeErrorResultSchema,
  type LitterBridgeControllerSnapshot,
  type LitterBridgeControllerSnapshotRequest,
  type LitterBridgeError,
  type LitterBridgeErrorCode,
  type LitterBridgeErrorResult,
  type LitterBridgeFreshness,
} from "../../../shared/agent/litter-bridge";
import { readJsonRequestWithinLimit } from "../../../shared/agent/agent-turn-body";
import { resolveDataDir } from "./data-dir";
import { getApiSettings } from "./settings-service";
import { piRuntimeManager } from "./pi-runtime";

const BODY_LIMIT_BYTES = 1_000_000;
const RESPONSE_LIMIT_BYTES = 1_000_000;
const REQUEST_MAX_LIFETIME_MS = 60_000;
const REQUEST_MAX_FUTURE_SKEW_MS = 30_000;
const REPLAY_STORE_LIMIT = 10_000;
const SECRET_HEADER = "x-local-studio-litter-bridge-secret";
const ROUTE_PATH = "/api/litter-bridge/v1";
const SIGNATURE_DOMAIN = Buffer.from("litter-bridge-request-v1", "ascii");
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

type JsonRecord = Record<string, unknown>;
type FetchImplementation = typeof fetch;
type RuntimeStats = {
  runningSessionCount: number;
  activeTurnCount: number;
  persistedSessionCount: number | null;
  eventSequence: number | null;
};
type GatewayOptions = {
  secret?: string;
  controllerId?: string;
  dataDir?: string;
  displayName?: string;
  controllerUrl?: string;
  now?: () => Date;
  fetch?: FetchImplementation;
  runtimeStats?: () => RuntimeStats;
};
type GatewayMetadata = {
  protocolVersion: 1;
  url: string;
  secretHeader: typeof SECRET_HEADER;
  secret: string;
  controllerId: string;
  pid: number;
  issuedAt: string;
};
type Section<T> = {
  value: T | null;
  error: LitterBridgeError | null;
  freshness: LitterBridgeFreshness;
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safeInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const nonNegativeNumber = (value: unknown): number | null => {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
};

const boundedString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 512
    ? value
    : null;

const writePrivateJson = (filepath: string, value: unknown): void => {
  const temporary = `${filepath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, filepath);
  chmodSync(filepath, 0o600);
};

const controllerIdFile = (dataDir: string): string => path.join(dataDir, "litter-controller-id");
const metadataFile = (dataDir: string): string => path.join(dataDir, "litter-bridge.json");

const loadControllerId = (dataDir: string): string => {
  const filepath = controllerIdFile(dataDir);
  if (existsSync(filepath)) {
    try {
      const existing = readFileSync(filepath, "utf8").trim();
      if (boundedString(existing)) return existing;
    } catch {}
  }
  const created = randomUUID();
  const temporary = `${filepath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  writeFileSync(temporary, `${created}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, filepath);
  chmodSync(filepath, 0o600);
  return created;
};

const safeSecretEqual = (expected: string, provided: string): boolean => {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(provided, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};

export const canonicalLitterBridgeJson = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Canonical JSON only permits safe integers");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalLitterBridgeJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalLitterBridgeJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported canonical JSON value");
};

export const litterBridgeBodyHash = (value: unknown): string =>
  createHash("sha256").update(canonicalLitterBridgeJson(value), "utf8").digest("hex");

const appendLengthPrefixed = (target: Buffer[], value: string): void => {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > 0xffff_ffff) throw new Error("Signature field exceeds u32 length");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  target.push(length, bytes);
};

export const litterBridgeSignaturePreimage = (fields: {
  deviceId: string;
  keyId: string;
  requestId: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  capability: string;
  idempotencyKey?: string | null;
  bodyHash: string;
}): Buffer => {
  const parts = [SIGNATURE_DOMAIN];
  for (const field of [
    fields.deviceId,
    fields.keyId,
    fields.requestId,
    fields.issuedAt,
    fields.expiresAt,
    fields.nonce,
    fields.capability,
    fields.idempotencyKey ?? "",
    fields.bodyHash,
  ]) {
    appendLengthPrefixed(parts, field);
  }
  return Buffer.concat(parts);
};

const errorResult = (
  code: LitterBridgeErrorCode,
  message: string,
  requestId: string,
  retriable = false,
): LitterBridgeErrorResult =>
  Schema.decodeUnknownSync(LitterBridgeErrorResultSchema)({
    type: "error",
    protocolVersion: LITTER_BRIDGE_PROTOCOL_VERSION,
    requestId,
    error: { code, message, retriable, requestId, details: null },
  });

const requestIdFrom = (value: unknown): string => {
  if (!isRecord(value) || !isRecord(value.auth)) return randomUUID();
  return boundedString(value.auth.requestId) ?? randomUUID();
};

const jsonError = (
  code: LitterBridgeErrorCode,
  message: string,
  requestId: string,
  status: number,
  retriable = false,
): Response => Response.json(errorResult(code, message, requestId, retriable), { status });

const unsignedRequest = (request: LitterBridgeControllerSnapshotRequest): JsonRecord => ({
  type: request.type,
  protocolVersion: request.protocolVersion,
  controllerId: request.controllerId,
});

const verifyRequest = (
  request: LitterBridgeControllerSnapshotRequest,
  now: Date,
): { ok: true; replayKey: string; expiresAt: number } | { ok: false; response: Response } => {
  const { auth } = request;
  const requestId = auth.requestId;
  if (auth.device.deviceId !== auth.device.keyId || !/^[a-f0-9]{64}$/.test(auth.device.deviceId)) {
    return {
      ok: false,
      response: jsonError("unauthorized", "Device identity is invalid", requestId, 401),
    };
  }
  const issuedAt = Date.parse(auth.issuedAt);
  const expiresAt = Date.parse(auth.expiresAt);
  const nowMs = now.getTime();
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > REQUEST_MAX_LIFETIME_MS ||
    issuedAt > nowMs + REQUEST_MAX_FUTURE_SKEW_MS ||
    expiresAt <= nowMs
  ) {
    return {
      ok: false,
      response: jsonError("expired_request", "Request timestamp window is invalid", requestId, 401),
    };
  }
  const bodyHash = litterBridgeBodyHash(unsignedRequest(request));
  if (bodyHash !== auth.bodyHash) {
    return {
      ok: false,
      response: jsonError("integrity_failed", "Request body hash is invalid", requestId, 401),
    };
  }
  try {
    const signature = Buffer.from(auth.signature, "base64url");
    if (signature.length !== 64 || signature.toString("base64url") !== auth.signature) {
      throw new Error("Invalid signature encoding");
    }
    const rawKey = Buffer.from(auth.device.deviceId, "hex");
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
      format: "der",
      type: "spki",
    });
    const preimage = litterBridgeSignaturePreimage({
      deviceId: auth.device.deviceId,
      keyId: auth.device.keyId,
      requestId,
      issuedAt: auth.issuedAt,
      expiresAt: auth.expiresAt,
      nonce: auth.nonce,
      capability: auth.capability,
      bodyHash: auth.bodyHash,
    });
    if (!verifySignature(null, preimage, publicKey, signature)) {
      throw new Error("Signature mismatch");
    }
  } catch {
    return {
      ok: false,
      response: jsonError("unauthorized", "Request signature is invalid", requestId, 401),
    };
  }
  return {
    ok: true,
    replayKey: `${auth.device.deviceId}:${requestId}:${auth.nonce}`,
    expiresAt,
  };
};

const resolveControllerBase = (input: string): URL => {
  const url = new URL(input);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Controller settings are invalid");
  }
  return new URL(`${url.protocol}//${url.host}/`);
};

const readBoundedResponse = async (response: Response): Promise<unknown> => {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RESPONSE_LIMIT_BYTES) {
    throw new Error("Controller response is too large");
  }
  if (!response.body) throw new Error("Controller response is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > RESPONSE_LIMIT_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Controller response is too large");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
};

const fetchControllerJson = async (
  implementation: FetchImplementation,
  base: URL,
  route: string,
  timeoutMs: number,
): Promise<unknown> => {
  const response = await implementation(new URL(route, base), {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Controller redirect rejected");
  }
  if (!response.ok) throw new Error(`Controller returned HTTP ${response.status}`);
  return readBoundedResponse(response);
};

const freshness = (observedAt: string | null, maxAgeMs: number): LitterBridgeFreshness => ({
  observedAt,
  ageMs: observedAt ? 0 : null,
  maxAgeMs,
  stale: false,
  sourceRevision: null,
});

const failedSection = <T>(
  requestId: string,
  code: "controller_unavailable" | "section_unavailable" | "agent_runtime_unavailable",
  message: string,
  maxAgeMs: number,
): Section<T> => ({
  value: null,
  error: { code, message, retriable: true, requestId, details: null },
  freshness: freshness(null, maxAgeMs),
});

const fulfilledSection = <T>(value: T, observedAt: string, maxAgeMs: number): Section<T> => ({
  value,
  error: null,
  freshness: freshness(observedAt, maxAgeMs),
});

const defaultRuntimeStats = (): RuntimeStats => {
  const sessions = piRuntimeManager.listSessions();
  return {
    runningSessionCount: sessions.filter(({ session }) => session.status.running).length,
    activeTurnCount: sessions.filter(({ session }) => session.status.active).length,
    persistedSessionCount: null,
    eventSequence:
      sessions.length === 0
        ? null
        : Math.max(...sessions.map(({ session }) => session.status.eventSeq)),
  };
};

const normalizeStatus = (value: unknown) => {
  if (!isRecord(value) || typeof value.running !== "boolean") {
    throw new Error("Controller status shape is invalid");
  }
  const processValue = isRecord(value.process) ? value.process : null;
  const model =
    boundedString(processValue?.served_model_name) ?? boundedString(processValue?.model_path);
  const inferencePort = safeInteger(value.inference_port);
  if (inferencePort === null || inferencePort === 0 || inferencePort > 65_535) {
    throw new Error("Controller inference port is invalid");
  }
  return {
    running: value.running,
    inferencePort,
    launchingRecipeId: value.launching === null ? null : boundedString(value.launching),
    activeLaunchId: null,
    activeModelIds: model ? [model] : [],
  };
};

const megabytesToBytes = (value: unknown): number | null => {
  const megabytes = nonNegativeNumber(value);
  if (megabytes === null) return null;
  const bytes = Math.round(megabytes * 1024 * 1024);
  return Number.isSafeInteger(bytes) ? bytes : null;
};

const normalizeGpus = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value.gpus) || value.gpus.length > 128) {
    throw new Error("Controller GPU shape is invalid");
  }
  const devices = value.gpus.map((entry, position) => {
    if (!isRecord(entry)) throw new Error("Controller GPU entry is invalid");
    const index = safeInteger(entry.index) ?? position;
    const name = boundedString(entry.name);
    const total = megabytesToBytes(entry.memory_total_mb);
    if (!name || total === null) throw new Error("Controller GPU entry is invalid");
    const id =
      boundedString(entry.id) ??
      boundedString(entry.uuid) ??
      boundedString(entry.pci_bus_id) ??
      `gpu-${index}`;
    const memoryAvailable = entry.memory_usage_available !== false;
    const utilizationAvailable = entry.utilization_available !== false;
    const temperatureAvailable = entry.temperature_available !== false;
    const powerAvailable = entry.power_available !== false;
    return {
      id,
      index,
      name,
      memoryTotalBytes: total,
      memoryUsedBytes: memoryAvailable ? megabytesToBytes(entry.memory_used_mb) : null,
      memoryFreeBytes: memoryAvailable ? megabytesToBytes(entry.memory_free_mb) : null,
      utilizationPercent: utilizationAvailable ? nonNegativeNumber(entry.utilization_pct) : null,
      temperatureCelsius: temperatureAvailable ? finiteNumber(entry.temp_c) : null,
      powerWatts: powerAvailable ? nonNegativeNumber(entry.power_draw) : null,
    };
  });
  for (const device of devices) {
    if (device.utilizationPercent !== null && device.utilizationPercent > 100) {
      throw new Error("Controller GPU utilization is invalid");
    }
  }
  return { count: devices.length, devices };
};

const normalizeCachePercentage = (value: unknown): number | null => {
  const parsed = nonNegativeNumber(value);
  if (parsed === null) return null;
  const percentage = parsed <= 1 ? parsed * 100 : parsed;
  return percentage <= 100 ? percentage : null;
};

const normalizeMetrics = (value: unknown) => {
  if (!isRecord(value)) throw new Error("Controller metrics shape is invalid");
  return {
    requestsActive: safeInteger(value.running_requests),
    requestsQueued: safeInteger(value.pending_requests),
    promptTokensPerSecond: nonNegativeNumber(value.prompt_throughput),
    generationTokensPerSecond: nonNegativeNumber(value.generation_throughput),
    timeToFirstTokenMs: nonNegativeNumber(value.avg_ttft_ms),
    cacheUsagePercent: normalizeCachePercentage(value.kv_cache_usage),
  };
};

export function createLitterBridgeGateway(options: GatewayOptions = {}) {
  const dataDir = options.dataDir ?? resolveDataDir();
  const secret =
    options.secret ??
    process.env.LOCAL_STUDIO_LITTER_BRIDGE_SECRET?.trim() ??
    randomBytes(32).toString("base64url");
  if (secret.length < 32 || secret.length > 512) throw new Error("Invalid Litter bridge secret");
  const controllerId = options.controllerId ?? loadControllerId(dataDir);
  const displayName = options.displayName ?? `Local Studio on ${hostname()}`;
  const now = options.now ?? (() => new Date());
  const implementation = options.fetch ?? globalThis.fetch;
  const runtimeStats = options.runtimeStats ?? defaultRuntimeStats;
  const replay = new Map<string, number>();
  let revision = 0;
  let lastControlHash = "";
  let published: GatewayMetadata | null = null;

  const pruneReplay = (nowMs: number): void => {
    for (const [key, expiresAt] of replay) {
      if (expiresAt <= nowMs) replay.delete(key);
    }
    while (replay.size > REPLAY_STORE_LIMIT) {
      const oldest = replay.keys().next().value;
      if (oldest === undefined) break;
      replay.delete(oldest);
    }
  };

  const buildSnapshot = async (
    request: LitterBridgeControllerSnapshotRequest,
  ): Promise<LitterBridgeControllerSnapshot> => {
    const backendUrl = options.controllerUrl ?? (await getApiSettings()).backendUrl;
    const base = resolveControllerBase(backendUrl);
    const requestId = request.auth.requestId;
    const healthPromise = (async () => {
      const startedAt = performance.now();
      try {
        const result = await fetchControllerJson(implementation, base, "/health", 1_500);
        if (!isRecord(result) || result.status !== "ok") {
          throw new Error("Controller health shape is invalid");
        }
        const observedAt = now().toISOString();
        return fulfilledSection(
          {
            state: "ok" as const,
            reachable: true,
            checkedAt: observedAt,
            latencyMs: Math.max(0, performance.now() - startedAt),
            controllerVersion: null,
          },
          observedAt,
          5_000,
        );
      } catch {
        return failedSection(
          requestId,
          "controller_unavailable",
          "Controller health is unavailable",
          5_000,
        );
      }
    })();
    const statusPromise = (async () => {
      try {
        const value = normalizeStatus(
          await fetchControllerJson(implementation, base, "/status", 2_000),
        );
        const observedAt = now().toISOString();
        return fulfilledSection(value, observedAt, 5_000);
      } catch {
        return failedSection(
          requestId,
          "section_unavailable",
          "Controller status is unavailable",
          5_000,
        );
      }
    })();
    const gpusPromise = (async () => {
      try {
        const value = normalizeGpus(
          await fetchControllerJson(implementation, base, "/gpus", 2_500),
        );
        const observedAt = now().toISOString();
        return fulfilledSection(value, observedAt, 10_000);
      } catch {
        return failedSection(
          requestId,
          "section_unavailable",
          "Controller GPU data is unavailable",
          10_000,
        );
      }
    })();
    const metricsPromise = (async () => {
      try {
        const value = normalizeMetrics(
          await fetchControllerJson(implementation, base, "/v1/metrics/vllm", 2_500),
        );
        const observedAt = now().toISOString();
        return fulfilledSection(value, observedAt, 5_000);
      } catch {
        return failedSection(
          requestId,
          "section_unavailable",
          "Controller metrics are unavailable",
          5_000,
        );
      }
    })();
    const runtimePromise = Promise.resolve().then(() => {
      try {
        const stats = runtimeStats();
        const observedAt = now().toISOString();
        return fulfilledSection(
          {
            state: "ok" as const,
            reachable: true,
            ...stats,
          },
          observedAt,
          5_000,
        );
      } catch {
        return failedSection(
          requestId,
          "agent_runtime_unavailable",
          "Agent runtime statistics are unavailable",
          5_000,
        );
      }
    });
    const [health, status, gpus, metrics, agentRuntime] = await Promise.all([
      healthPromise,
      statusPromise,
      gpusPromise,
      metricsPromise,
      runtimePromise,
    ]);
    const controlHash = litterBridgeBodyHash(status.value);
    if (controlHash !== lastControlHash) {
      revision = Math.min(Number.MAX_SAFE_INTEGER, revision + 1);
      lastControlHash = controlHash;
    }
    const failures = [health, status, gpus, metrics, agentRuntime].filter(
      (section) => section.error !== null,
    ).length;
    const state =
      health.value === null && status.value === null
        ? "unavailable"
        : failures > 0
          ? "degraded"
          : "healthy";
    return Schema.decodeUnknownSync(LitterBridgeControllerSnapshotSchema)({
      type: "controller_snapshot",
      protocolVersion: LITTER_BRIDGE_PROTOCOL_VERSION,
      snapshotId: randomUUID(),
      controllerId,
      displayName,
      generatedAt: now().toISOString(),
      revision,
      state,
      capabilities: ["stats.read"],
      sections: { health, status, gpus, metrics, agentRuntime },
    });
  };

  const handle = async (request: Request): Promise<Response> => {
    const providedSecret = request.headers.get(SECRET_HEADER) ?? "";
    if (!safeSecretEqual(secret, providedSecret)) {
      return jsonError("unauthorized", "Gateway authentication failed", randomUUID(), 401);
    }
    const body = await readJsonRequestWithinLimit(request, BODY_LIMIT_BYTES);
    if (!body.ok) {
      const code = body.status === 413 ? "payload_too_large" : "invalid_request";
      return jsonError(code, "Gateway request body is invalid", randomUUID(), body.status);
    }
    const requestId = requestIdFrom(body.value);
    let parsed: LitterBridgeControllerSnapshotRequest;
    try {
      parsed = Schema.decodeUnknownSync(LitterBridgeControllerSnapshotRequestSchema)(body.value);
    } catch {
      const suppliedVersion = isRecord(body.value) ? body.value.protocolVersion : null;
      const code =
        suppliedVersion !== null && suppliedVersion !== LITTER_BRIDGE_PROTOCOL_VERSION
          ? "unsupported_version"
          : "invalid_request";
      return jsonError(code, "Gateway request is invalid", requestId, 400);
    }
    const verified = verifyRequest(parsed, now());
    if (!verified.ok) return verified.response;
    if (parsed.controllerId !== controllerId) {
      return jsonError("not_found", "Controller identity was not found", requestId, 404);
    }
    const nowMs = now().getTime();
    pruneReplay(nowMs);
    if (replay.has(verified.replayKey)) {
      return jsonError("replay_detected", "Request was already processed", requestId, 409);
    }
    replay.set(verified.replayKey, verified.expiresAt);
    try {
      return Response.json(await buildSnapshot(parsed));
    } catch {
      return jsonError(
        "controller_unavailable",
        "Controller settings are unavailable",
        requestId,
        503,
        true,
      );
    }
  };

  const publishMetadata = (port: number): void => {
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
      throw new Error("Invalid Litter bridge port");
    }
    published = {
      protocolVersion: LITTER_BRIDGE_PROTOCOL_VERSION,
      url: `http://127.0.0.1:${port}${ROUTE_PATH}`,
      secretHeader: SECRET_HEADER,
      secret,
      controllerId,
      pid: process.pid,
      issuedAt: now().toISOString(),
    };
    writePrivateJson(metadataFile(dataDir), published);
  };

  const dispose = (): void => {
    if (!published) return;
    const filepath = metadataFile(dataDir);
    try {
      const current = JSON.parse(readFileSync(filepath, "utf8")) as Partial<GatewayMetadata>;
      if (current.pid === published.pid && current.secret === published.secret) {
        rmSync(filepath);
      }
    } catch {}
    published = null;
  };

  return { handle, publishMetadata, dispose, controllerId, secret };
}
