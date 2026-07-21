import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  openSync,
  opendirSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";
import { Schema } from "effect";
import {
  LITTER_BRIDGE_PROTOCOL_VERSION,
  LitterBridgeControllerSnapshotRequestSchema,
  LitterBridgeControllerSnapshotSchema,
  LitterBridgeErrorResultSchema,
  LitterBridgeSessionListPageSchema,
  LitterBridgeSessionListRequestSchema,
  LitterBridgeSessionPageSchema,
  LitterBridgeSessionReadRequestSchema,
  type LitterBridgeAttachmentDescriptor,
  type LitterBridgeControllerSnapshot,
  type LitterBridgeControllerSnapshotRequest,
  type LitterBridgeError,
  type LitterBridgeErrorCode,
  type LitterBridgeErrorResult,
  type LitterBridgeExternalSessionIdentity,
  type LitterBridgeFreshness,
  type LitterBridgeHashReference,
  type LitterBridgeMessageDescriptor,
  type LitterBridgeMessagePart,
  type LitterBridgeRequest,
  type LitterBridgeSessionDescriptor,
  type LitterBridgeSessionListCursor,
  type LitterBridgeSessionListPage,
  type LitterBridgeSessionListRequest,
  type LitterBridgeSessionMetadata,
  type LitterBridgeSessionPage,
  type LitterBridgeSessionReadRequest,
  type LitterBridgeToolDescriptor,
  type LitterBridgeTransferCursor,
} from "../../../shared/agent/litter-bridge";
import { readJsonRequestWithinLimit } from "../../../shared/agent/agent-turn-body";
import { cleanSessionTitle } from "../../../shared/agent/session-title";
import { resolveDataDir } from "./data-dir";
import { listProjectsFromStore, type ProjectEntry } from "./projects-store";
import { getApiSettings } from "./settings-service";
import { piRuntimeManager } from "./pi-runtime";
import { listArchivedSessionMetadata } from "./session-metadata-store";

const BODY_LIMIT_BYTES = 1_000_000;
const RESPONSE_LIMIT_BYTES = 1_000_000;
const REQUEST_MAX_LIFETIME_MS = 60_000;
const REQUEST_MAX_FUTURE_SKEW_MS = 30_000;
const REPLAY_STORE_LIMIT = 10_000;
const CURSOR_STORE_LIMIT = 256;
const CURSOR_STATE_ITEM_LIMIT = 100_000;
const CURSOR_TTL_MS = 5 * 60_000;
const SESSION_LINE_LIMIT_BYTES = 1_000_000;
const SESSION_READ_CHUNK_BYTES = 64 * 1024;
const SESSION_HEADER_LIMIT_BYTES = 64 * 1024;
const SESSION_METADATA_SCAN_BYTES = 1_000_000;
const SESSION_METADATA_SCAN_LINES = 400;
const SESSION_LINEAGE_LIMIT = 50_000;
const SESSION_TOOL_LIMIT = 10_000;
const SESSION_PAGE_ITEM_LIMIT = 200;
const SESSION_INVENTORY_LIMIT = 10_000;
const PI_SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
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
type TrustedProject = Pick<ProjectEntry, "path" | "exists">;
type LiveProject = { cwd: string; variants: string[] };
type GatewayOptions = {
  secret?: string;
  controllerId?: string;
  dataDir?: string;
  displayName?: string;
  controllerUrl?: string;
  controllerApiKey?: string;
  now?: () => Date;
  fetch?: FetchImplementation;
  runtimeStats?: () => RuntimeStats;
  projects?: () => TrustedProject[];
  sessionRoots?: string[];
  sessionCursorTtlMs?: number;
  sessionInventoryLimit?: number;
  activeSessionIds?: () => ReadonlySet<string>;
  archivedSessionIds?: () => ReadonlySet<string>;
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
type SignedGatewayRequest =
  | LitterBridgeControllerSnapshotRequest
  | LitterBridgeSessionListRequest
  | LitterBridgeSessionReadRequest;
type SessionFileFingerprint = {
  value: string;
  revision: number;
  size: number;
  createdAt: string;
  updatedAt: string;
};
type ResolvedSessionFile = SessionFileFingerprint & {
  filepath: string;
  cwd: string;
  sessionId: string;
  header: JsonRecord;
  headerEnd: number;
};
type ToolOwner = {
  toolCallId: string;
  messageId: string;
  name: string;
  argumentsJson: string;
  argumentsHash: string;
  startedAt: string;
  completed: boolean;
};
type SessionTranslationState = {
  lineage: Map<string, string | null>;
  seenEntryIds: Set<string>;
  toolOwners: Map<string, ToolOwner>;
  sequence: number;
};
type SessionCursorState = {
  controllerId: string;
  deviceId: string;
  sessionId: string;
  filepath: string;
  cwd: string;
  fingerprint: string;
  revision: number;
  offset: number;
  afterSequence: number;
  expiresAt: number;
  metadata: LitterBridgeSessionMetadata;
  translation: SessionTranslationState;
};
type SessionListCursorState = {
  controllerId: string;
  deviceId: string;
  revision: number;
  inventoryHash: string;
  offset: number;
  expiresAt: number;
};
type SessionInventory = {
  sessions: LitterBridgeSessionDescriptor[];
  revision: number;
  hash: string;
};
type SessionLine = {
  bytes: Buffer;
  start: number;
  end: number;
  oversizedInert: boolean;
};
type SessionArtifacts = {
  message: LitterBridgeMessageDescriptor | null;
  tools: LitterBridgeToolDescriptor[];
  attachments: LitterBridgeAttachmentDescriptor[];
  entryId: string | null;
  parentMessageId: string | null;
  safeOmission: boolean;
  toolOwnerUpdates: Array<[string, ToolOwner]>;
};
type ContentTranslation = {
  parts: LitterBridgeMessagePart[];
  attachments: LitterBridgeAttachmentDescriptor[];
  tools: LitterBridgeToolDescriptor[];
  toolOwnerUpdates: Array<[string, ToolOwner]>;
  normalized: unknown[];
};

class SessionReadError extends Error {
  constructor(
    readonly code: LitterBridgeErrorCode,
    message: string,
    readonly status: number,
    readonly retriable = false,
  ) {
    super(message);
  }
}

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

export const litterBridgeSha256Utf8 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const litterBridgeMessageHashPreimage = (
  descriptor: Omit<LitterBridgeMessageDescriptor, "contentHash">,
): string => canonicalLitterBridgeJson(["litter-bridge-message-v1", descriptor]);

export const litterBridgeToolHashPreimage = (descriptor: LitterBridgeToolDescriptor): string =>
  canonicalLitterBridgeJson(["litter-bridge-tool-v1", descriptor]);

export const litterBridgeSessionHashPreimage = (input: {
  canonicalSession: LitterBridgeExternalSessionIdentity;
  metadata: LitterBridgeSessionMetadata;
  revision: number;
  messages: readonly LitterBridgeHashReference[];
  tools: readonly LitterBridgeHashReference[];
  attachments: readonly LitterBridgeHashReference[];
}): string => canonicalLitterBridgeJson(["litter-bridge-session-v1", input]);

const stableJson = (value: unknown, ancestors = new Set<object>()): string => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new SessionReadError("integrity_failed", "Session JSON is invalid", 422);
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || value === undefined) {
    throw new SessionReadError("integrity_failed", "Session JSON is invalid", 422);
  }
  if (ancestors.has(value)) {
    throw new SessionReadError("integrity_failed", "Session JSON is invalid", 422);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => stableJson(entry, ancestors)).join(",")}]`;
    }
    const record = value as JsonRecord;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key], ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
};

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

const unsignedRequest = (request: LitterBridgeRequest): JsonRecord => {
  const { auth: _auth, ...unsigned } = request;
  return unsigned;
};

export const verifyLitterBridgeRequest = (
  request: LitterBridgeRequest,
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
      idempotencyKey: "idempotencyKey" in auth ? auth.idempotencyKey : null,
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
  apiKey: string,
): Promise<unknown> => {
  const headers = new Headers({ Accept: "application/json" });
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  const response = await implementation(new URL(route, base), {
    method: "GET",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Controller redirect rejected");
  }
  if (!response.ok) throw new Error(`Controller returned HTTP ${response.status}`);
  return readBoundedResponse(response);
};

const freshness = (
  observedAt: string | null,
  maxAgeMs: number,
  stale = observedAt === null,
): LitterBridgeFreshness => ({
  observedAt,
  ageMs: observedAt ? 0 : null,
  maxAgeMs,
  stale,
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

const strictTimestamp = (value: unknown): string | null => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return null;
  }
  return value;
};

const timestampFrom = (event: JsonRecord, message?: JsonRecord): string => {
  const entryTimestamp = strictTimestamp(event.timestamp);
  if (entryTimestamp) return entryTimestamp;
  const messageTimestamp = message?.timestamp;
  if (
    typeof messageTimestamp === "number" &&
    Number.isSafeInteger(messageTimestamp) &&
    messageTimestamp >= 0
  ) {
    return new Date(messageTimestamp).toISOString();
  }
  throw new SessionReadError("integrity_failed", "Session timestamp is invalid", 422);
};

const identifierFrom = (value: unknown, prefix: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new SessionReadError("integrity_failed", "Session identifier is invalid", 422);
  }
  if (value.trim() === value && Buffer.byteLength(value, "utf8") <= 512) return value;
  return `${prefix}-${litterBridgeSha256Utf8(value).slice(0, 48)}`;
};

const optionalIdentifier = (value: unknown): string | null =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  Buffer.byteLength(value, "utf8") <= 512
    ? value
    : null;

const shortText = (value: string): string => {
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const next = Buffer.byteLength(character, "utf8");
    if (bytes + next > 4_096) break;
    output += character;
    bytes += next;
  }
  return output;
};

const sessionFileFingerprint = (filepath: string): SessionFileFingerprint => {
  const stats = statSync(filepath, { bigint: true });
  if (!stats.isFile() || stats.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SessionReadError("integrity_failed", "Session file is invalid", 422);
  }
  const value = litterBridgeSha256Utf8(
    [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].map(String).join(":"),
  );
  return {
    value,
    revision: Number.parseInt(value.slice(0, 13), 16),
    size: Number(stats.size),
    createdAt: new Date(Number(stats.birthtimeMs)).toISOString(),
    updatedAt: new Date(Number(stats.mtimeMs)).toISOString(),
  };
};

const encodeCwdForPi = (cwd: string): string => {
  const normalized = path.resolve(cwd).replace(/\\+/g, "/");
  return `--${normalized.replace(/^\//, "").replace(/\/+/g, "-")}--`;
};

const liveProjects = (projects: TrustedProject[]): LiveProject[] => {
  const byCwd = new Map<string, LiveProject>();
  for (const project of projects) {
    if (!project.exists || typeof project.path !== "string" || !project.path.trim()) continue;
    try {
      const lexical = path.resolve(project.path);
      const canonical = realpathSync.native(lexical);
      if (!statSync(canonical).isDirectory()) continue;
      const existing = byCwd.get(canonical);
      const variants = [...new Set([...(existing?.variants ?? []), lexical, canonical])];
      byCwd.set(canonical, { cwd: canonical, variants });
    } catch {}
  }
  return [...byCwd.values()].sort((left, right) => left.cwd.localeCompare(right.cwd));
};

const sessionRootPaths = (dataDir: string, configured?: string[]): string[] => {
  const roots =
    configured ??
    [
      process.env.PI_CODING_AGENT_DIR
        ? path.join(process.env.PI_CODING_AGENT_DIR, "sessions")
        : null,
      path.join(dataDir, "pi-agent", "sessions"),
      path.join(homedir(), ".pi", "agent", "sessions"),
    ].filter((value): value is string => Boolean(value));
  return [...new Set(roots.map((root) => path.resolve(root)))];
};

const readSessionLine = (
  fd: number,
  size: number,
  start: number,
  byteLimit = SESSION_LINE_LIMIT_BYTES,
): SessionLine | null => {
  if (start >= size) return null;
  const chunks: Buffer[] = [];
  let position = start;
  let total = 0;
  while (position < size) {
    const length = Math.min(SESSION_READ_CHUNK_BYTES, size - position);
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = readSync(fd, buffer, 0, length, position);
    if (bytesRead <= 0) break;
    const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
    const take = newline >= 0 ? newline : bytesRead;
    total += take;
    if (total > byteLimit) {
      throw new SessionReadError(
        "payload_too_large",
        "Session entry exceeds the transfer limit",
        413,
      );
    }
    if (take > 0) chunks.push(buffer.subarray(0, take));
    position += newline >= 0 ? newline + 1 : bytesRead;
    if (newline >= 0) {
      return {
        bytes: chunks.length === 1 ? Buffer.from(chunks[0]) : Buffer.concat(chunks, total),
        start,
        end: position,
        oversizedInert: false,
      };
    }
  }
  if (position !== size) {
    throw new SessionReadError("integrity_failed", "Session file could not be read", 422);
  }
  return {
    bytes: chunks.length === 1 ? Buffer.from(chunks[0]) : Buffer.concat(chunks, total),
    start,
    end: position,
    oversizedInert: false,
  };
};

const parseSessionLine = (line: SessionLine): JsonRecord | null => {
  const source = line.bytes.toString("utf8").trim();
  if (!source) return null;
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!isRecord(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new SessionReadError("integrity_failed", "Session JSON is invalid", 422);
  }
};

const readSessionHeader = (
  filepath: string,
  expectedSessionId: string | null,
  project: LiveProject,
): { header: JsonRecord; headerEnd: number } | null => {
  const fingerprint = sessionFileFingerprint(filepath);
  const fd = openSync(filepath, "r");
  try {
    const line = readSessionLine(fd, fingerprint.size, 0, SESSION_HEADER_LIMIT_BYTES);
    if (!line) return null;
    const header = parseSessionLine(line);
    if (
      !header ||
      header.type !== "session" ||
      typeof header.id !== "string" ||
      !PI_SESSION_ID_PATTERN.test(header.id) ||
      (expectedSessionId !== null && header.id !== expectedSessionId)
    ) {
      return null;
    }
    const version = header.version === undefined ? 1 : safeInteger(header.version);
    if (version === null || version < 1 || version > 3) {
      throw new SessionReadError("section_unavailable", "Session version is unsupported", 422);
    }
    if (typeof header.cwd !== "string") {
      throw new SessionReadError("integrity_failed", "Session project identity is invalid", 422);
    }
    const headerCwd = path.resolve(header.cwd);
    let canonicalHeaderCwd = headerCwd;
    try {
      canonicalHeaderCwd = realpathSync.native(headerCwd);
    } catch {}
    if (!project.variants.includes(headerCwd) && canonicalHeaderCwd !== project.cwd) {
      throw new SessionReadError("integrity_failed", "Session project identity is invalid", 422);
    }
    return { header, headerEnd: line.end };
  } finally {
    closeSync(fd);
  }
};

const resolveSessionFile = (
  sessionId: string,
  projects: TrustedProject[],
  roots: string[],
): ResolvedSessionFile => {
  if (!PI_SESSION_ID_PATTERN.test(sessionId)) {
    throw new SessionReadError("not_found", "Session identity was not found", 404);
  }
  const matches = new Map<string, ResolvedSessionFile>();
  for (const project of liveProjects(projects)) {
    const directories = new Set<string>();
    for (const root of roots) {
      for (const variant of project.variants) {
        directories.add(path.join(root, encodeCwdForPi(variant)));
      }
    }
    for (const directory of directories) {
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(`_${sessionId}.jsonl`)) continue;
        const candidate = path.join(directory, entry.name);
        const headerResult = readSessionHeader(candidate, sessionId, project);
        if (!headerResult) continue;
        const filepath = realpathSync.native(candidate);
        const fingerprint = sessionFileFingerprint(filepath);
        const existing = matches.get(filepath);
        if (existing && existing.cwd !== project.cwd) {
          throw new SessionReadError(
            "not_found",
            "Session identity was not found or was ambiguous",
            404,
          );
        }
        matches.set(filepath, {
          ...fingerprint,
          filepath,
          cwd: project.cwd,
          sessionId,
          header: headerResult.header,
          headerEnd: headerResult.headerEnd,
        });
        if (matches.size > 1) {
          throw new SessionReadError(
            "not_found",
            "Session identity was not found or was ambiguous",
            404,
          );
        }
      }
    }
  }
  const resolved = matches.values().next().value;
  if (!resolved) throw new SessionReadError("not_found", "Session identity was not found", 404);
  return resolved;
};

const firstText = (content: unknown): string | null => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      return part.text;
    }
  }
  return null;
};

const readSessionMetadata = (resolved: ResolvedSessionFile): LitterBridgeSessionMetadata => {
  if (Buffer.byteLength(resolved.cwd, "utf8") > 512 || resolved.cwd.trim() !== resolved.cwd) {
    throw new SessionReadError("section_unavailable", "Session project path is unsupported", 422);
  }
  let title: string | null = null;
  let namedTitle: string | null = null;
  let modelId = optionalIdentifier(resolved.header.modelId ?? resolved.header.model);
  let providerId = optionalIdentifier(resolved.header.provider);
  let offset = resolved.headerEnd;
  let scannedLines = 0;
  const scanEnd = Math.min(resolved.size, resolved.headerEnd + SESSION_METADATA_SCAN_BYTES);
  const fd = openSync(resolved.filepath, "r");
  try {
    while (offset < scanEnd && scannedLines < SESSION_METADATA_SCAN_LINES) {
      const line = readSessionLine(fd, resolved.size, offset);
      if (!line || line.end > scanEnd) break;
      offset = line.end;
      scannedLines += 1;
      const event = parseSessionLine(line);
      if (!event) continue;
      if (event.type === "session_info") {
        const name = typeof event.name === "string" ? shortText(cleanSessionTitle(event.name)) : "";
        if (name) namedTitle = name;
      }
      if (event.type === "model_change") {
        modelId = optionalIdentifier(event.modelId ?? event.model) ?? modelId;
        providerId = optionalIdentifier(event.provider) ?? providerId;
      }
      if ((event.type === "message" || event.type === "message_end") && isRecord(event.message)) {
        const message = event.message;
        if (message.role === "user" && !title) {
          const text = firstText(message.content);
          const cleaned = cleanSessionTitle(text?.slice(0, 120));
          if (cleaned) title = cleaned;
        }
        if (message.role === "assistant") {
          modelId = optionalIdentifier(message.model) ?? modelId;
          providerId = optionalIdentifier(message.provider) ?? providerId;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof SessionReadError) || error.code !== "payload_too_large") throw error;
  } finally {
    closeSync(fd);
  }
  return {
    title: namedTitle ?? title,
    cwd: resolved.cwd,
    createdAt: strictTimestamp(resolved.header.timestamp) ?? resolved.createdAt,
    updatedAt: resolved.updatedAt,
    modelId,
    providerId,
  };
};

const enumerateSessionInventory = (input: {
  controllerId: string;
  projects: TrustedProject[];
  roots: string[];
  inventoryLimit: number;
  activeSessionIds: ReadonlySet<string>;
  archivedSessionIds: ReadonlySet<string>;
}): SessionInventory => {
  const matches = new Map<string, Map<string, ResolvedSessionFile>>();
  const scannedFiles = new Set<string>();
  const scannedContexts = new Set<string>();
  const scannedDirectories = new Set<string>();
  for (const project of liveProjects(input.projects)) {
    for (const root of input.roots) {
      for (const variant of project.variants) {
        const directory = path.join(root, encodeCwdForPi(variant));
        let canonicalDirectory: string;
        try {
          canonicalDirectory = realpathSync.native(directory);
          if (!statSync(canonicalDirectory).isDirectory()) continue;
        } catch {
          continue;
        }
        const directoryContext = `${project.cwd}\0${canonicalDirectory}`;
        if (scannedDirectories.has(directoryContext)) continue;
        scannedDirectories.add(directoryContext);
        let handle;
        try {
          handle = opendirSync(canonicalDirectory);
        } catch {
          continue;
        }
        try {
          for (let entry = handle.readSync(); entry; entry = handle.readSync()) {
            if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
            const candidate = path.join(canonicalDirectory, entry.name);
            let filepath: string;
            try {
              filepath = realpathSync.native(candidate);
              const relative = path.relative(canonicalDirectory, filepath);
              if (
                relative === ".." ||
                relative.startsWith(`..${path.sep}`) ||
                path.isAbsolute(relative)
              ) {
                continue;
              }
            } catch {
              continue;
            }
            if (!scannedFiles.has(filepath)) {
              scannedFiles.add(filepath);
              if (scannedFiles.size > input.inventoryLimit) {
                throw new SessionReadError(
                  "payload_too_large",
                  "Session inventory exceeds the discovery limit",
                  413,
                );
              }
            }
            const contextKey = `${project.cwd}\0${filepath}`;
            if (scannedContexts.has(contextKey)) continue;
            scannedContexts.add(contextKey);
            try {
              const headerResult = readSessionHeader(filepath, null, project);
              if (!headerResult || typeof headerResult.header.id !== "string") continue;
              const sessionId = headerResult.header.id;
              const fingerprint = sessionFileFingerprint(filepath);
              const candidates = matches.get(sessionId) ?? new Map<string, ResolvedSessionFile>();
              candidates.set(filepath, {
                ...fingerprint,
                filepath,
                cwd: project.cwd,
                sessionId,
                header: headerResult.header,
                headerEnd: headerResult.headerEnd,
              });
              matches.set(sessionId, candidates);
            } catch (error) {
              if (error instanceof SessionReadError && error.code === "payload_too_large")
                throw error;
            }
          }
        } finally {
          handle.closeSync();
        }
      }
    }
  }
  const sessions: LitterBridgeSessionDescriptor[] = [];
  for (const [sessionId, candidates] of matches) {
    if (candidates.size !== 1) continue;
    const resolved = candidates.values().next().value;
    if (!resolved) continue;
    try {
      sessions.push({
        session: {
          kind: "external_session",
          authority: "local-studio",
          installationId: input.controllerId,
          sessionId,
        },
        metadata: readSessionMetadata(resolved),
        revision: resolved.revision,
        archived: input.archivedSessionIds.has(sessionId),
        active: input.activeSessionIds.has(sessionId),
      });
    } catch {}
  }
  sessions.sort((left, right) => {
    const byUpdated = right.metadata.updatedAt.localeCompare(left.metadata.updatedAt);
    return byUpdated || left.session.sessionId.localeCompare(right.session.sessionId);
  });
  const hash = litterBridgeSha256Utf8(
    canonicalLitterBridgeJson(["litter-bridge-session-list-v1", sessions]),
  );
  return {
    sessions,
    revision: Number.parseInt(hash.slice(0, 13), 16),
    hash,
  };
};

const sessionListCursorDescriptor = (
  token: string,
  revision: number,
): LitterBridgeSessionListCursor => ({
  type: "session_list_cursor",
  token,
  revision,
  hasMore: true,
});

const buildSessionListPage = (input: {
  requestId: string;
  controllerId: string;
  revision: number;
  sessions: LitterBridgeSessionDescriptor[];
  cursor: LitterBridgeSessionListCursor | null;
}): LitterBridgeSessionListPage =>
  Schema.decodeUnknownSync(LitterBridgeSessionListPageSchema)({
    type: "session_list_page",
    protocolVersion: LITTER_BRIDGE_PROTOCOL_VERSION,
    requestId: input.requestId,
    controllerId: input.controllerId,
    revision: input.revision,
    sessions: input.sessions,
    cursor: input.cursor,
  });

const pageSessionInventory = (input: {
  request: LitterBridgeSessionListRequest;
  controllerId: string;
  inventory: SessionInventory;
  offset: number;
}): {
  page: LitterBridgeSessionListPage;
  json: string;
  nextOffset: number | null;
  token: string | null;
} => {
  if (input.offset < 0 || input.offset > input.inventory.sessions.length) {
    throw new SessionReadError("integrity_failed", "Session list cursor offset is invalid", 422);
  }
  let end = Math.min(input.offset + input.request.limit, input.inventory.sessions.length);
  const placeholderToken = "A".repeat(43);
  while (true) {
    const hasMore = end < input.inventory.sessions.length;
    const candidate = buildSessionListPage({
      requestId: input.request.auth.requestId,
      controllerId: input.controllerId,
      revision: input.inventory.revision,
      sessions: input.inventory.sessions.slice(input.offset, end),
      cursor: hasMore
        ? sessionListCursorDescriptor(placeholderToken, input.inventory.revision)
        : null,
    });
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") <= RESPONSE_LIMIT_BYTES) {
      if (end === input.offset && hasMore) {
        throw new SessionReadError(
          "payload_too_large",
          "Session list entry exceeds the discovery limit",
          413,
        );
      }
      break;
    }
    if (end === input.offset) {
      throw new SessionReadError(
        "payload_too_large",
        "Session list page exceeds the discovery limit",
        413,
      );
    }
    end -= 1;
  }
  const token =
    end < input.inventory.sessions.length ? randomBytes(32).toString("base64url") : null;
  const page = buildSessionListPage({
    requestId: input.request.auth.requestId,
    controllerId: input.controllerId,
    revision: input.inventory.revision,
    sessions: input.inventory.sessions.slice(input.offset, end),
    cursor: token ? sessionListCursorDescriptor(token, input.inventory.revision) : null,
  });
  const json = JSON.stringify(page);
  if (Buffer.byteLength(json, "utf8") > RESPONSE_LIMIT_BYTES) {
    throw new SessionReadError(
      "payload_too_large",
      "Session list page exceeds the discovery limit",
      413,
    );
  }
  return { page, json, nextOffset: token ? end : null, token };
};

const boundedJsonText = (value: unknown): string => {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new SessionReadError("integrity_failed", "Tool JSON is invalid", 422);
    }
  }
  if (parsed === undefined) parsed = {};
  const json = stableJson(parsed);
  if (Buffer.byteLength(json, "utf8") > BODY_LIMIT_BYTES) {
    throw new SessionReadError("payload_too_large", "Tool JSON exceeds the transfer limit", 413);
  }
  return json;
};

const decodedBase64 = (value: unknown): Buffer => {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new SessionReadError("integrity_failed", "Session attachment is invalid", 422);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new SessionReadError("integrity_failed", "Session attachment is invalid", 422);
  }
  return bytes;
};

const attachmentFromPart = (
  part: JsonRecord,
  messageId: string,
  index: number,
): { descriptor: LitterBridgeAttachmentDescriptor; normalized: JsonRecord } => {
  const mediaType = boundedString(part.mimeType ?? part.mediaType);
  if (!mediaType || Buffer.byteLength(mediaType, "utf8") > 512) {
    throw new SessionReadError("integrity_failed", "Session attachment type is invalid", 422);
  }
  const bytes = decodedBase64(part.data);
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const extension =
    mediaType
      .split("/")[1]
      ?.replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 16) || "bin";
  const attachmentId = `attachment-${litterBridgeSha256Utf8(`${messageId}:${index}:${contentHash}`).slice(0, 48)}`;
  const descriptor: LitterBridgeAttachmentDescriptor = {
    attachmentId,
    messageId,
    fileName: `attachment-${index + 1}.${extension}`,
    mediaType,
    byteLength: bytes.byteLength,
    contentHash,
    blobId: null,
    availability: "metadata_only",
  };
  return {
    descriptor,
    normalized: {
      type: "attachment_ref",
      attachmentId,
      mediaType,
      byteLength: bytes.byteLength,
      contentHash,
      availability: "metadata_only",
    },
  };
};

const translateContent = (
  content: unknown,
  messageId: string,
  role: "system" | "user" | "assistant" | "tool",
  createdAt: string,
  translation: SessionTranslationState,
  messageReasoning: unknown,
): ContentTranslation => {
  const parts: LitterBridgeMessagePart[] = [];
  const attachments: LitterBridgeAttachmentDescriptor[] = [];
  const tools: LitterBridgeToolDescriptor[] = [];
  const toolOwnerUpdates: Array<[string, ToolOwner]> = [];
  const normalized: unknown[] = [];
  if (typeof messageReasoning === "string" && messageReasoning) {
    parts.push({ type: "reasoning", text: messageReasoning });
    normalized.push({ type: "reasoning", text: messageReasoning });
  } else if (messageReasoning !== undefined && messageReasoning !== null) {
    throw new SessionReadError("section_unavailable", "Session reasoning is unsupported", 422);
  }
  const entries = typeof content === "string" ? [{ type: "text", text: content }] : content;
  if (!Array.isArray(entries)) {
    throw new SessionReadError(
      "section_unavailable",
      "Session message content is unsupported",
      422,
    );
  }
  const pendingToolIds = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const part = entries[index];
    if (!isRecord(part) || typeof part.type !== "string") {
      throw new SessionReadError("section_unavailable", "Session message part is unsupported", 422);
    }
    if (part.type === "text") {
      if (typeof part.reasoning_content === "string" && part.reasoning_content) {
        parts.push({ type: "reasoning", text: part.reasoning_content });
        normalized.push({ type: "reasoning", text: part.reasoning_content });
      } else if (part.reasoning_content !== undefined && part.reasoning_content !== null) {
        throw new SessionReadError("section_unavailable", "Session reasoning is unsupported", 422);
      }
      if (typeof part.text !== "string") {
        throw new SessionReadError("integrity_failed", "Session text is invalid", 422);
      }
      parts.push({ type: "text", text: part.text });
      normalized.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "thinking" || part.type === "reasoning") {
      const text = [part.thinking, part.reasoning, part.text].find(
        (value): value is string => typeof value === "string",
      );
      if (text === undefined) {
        throw new SessionReadError("integrity_failed", "Session reasoning is invalid", 422);
      }
      parts.push({ type: "reasoning", text });
      normalized.push({ type: "reasoning", text });
      continue;
    }
    if (part.type === "image") {
      const attachment = attachmentFromPart(part, messageId, index);
      attachments.push(attachment.descriptor);
      parts.push({ type: "attachment_ref", attachmentId: attachment.descriptor.attachmentId });
      normalized.push(attachment.normalized);
      continue;
    }
    if (part.type === "toolCall") {
      if (role !== "assistant") {
        throw new SessionReadError(
          "section_unavailable",
          "Session tool reference is unsupported",
          422,
        );
      }
      if (typeof part.id !== "string" || !part.id) {
        throw new SessionReadError("integrity_failed", "Session tool identity is invalid", 422);
      }
      if (translation.toolOwners.has(part.id) || pendingToolIds.has(part.id)) {
        throw new SessionReadError("integrity_failed", "Session tool identity is duplicated", 422);
      }
      pendingToolIds.add(part.id);
      const toolCallId = identifierFrom(part.id, "tool");
      const name = identifierFrom(part.name, "tool-name");
      const argumentsJson = boundedJsonText(part.arguments);
      const argumentsHash = litterBridgeSha256Utf8(argumentsJson);
      const owner: ToolOwner = {
        toolCallId,
        messageId,
        name,
        argumentsJson,
        argumentsHash,
        startedAt: createdAt,
        completed: false,
      };
      toolOwnerUpdates.push([part.id, owner]);
      parts.push({ type: "tool_ref", toolCallId });
      normalized.push({ type: "tool_ref", toolCallId, name, argumentsJson });
      tools.push({
        toolCallId,
        messageId,
        name,
        state: "requested",
        argumentsJson,
        argumentsHash,
        resultJson: null,
        resultHash: null,
        startedAt: createdAt,
        completedAt: null,
      });
      continue;
    }
    throw new SessionReadError("section_unavailable", "Session message part is unsupported", 422);
  }
  return { parts, attachments, tools, toolOwnerUpdates, normalized };
};

const messageDescriptor = (input: {
  messageId: string;
  parentMessageId: string | null;
  sequence: number;
  role: "system" | "user" | "assistant" | "tool";
  createdAt: string;
  parts: LitterBridgeMessagePart[];
}): LitterBridgeMessageDescriptor => {
  const descriptor = {
    ...input,
    editedAt: null,
  } satisfies Omit<LitterBridgeMessageDescriptor, "contentHash">;
  return {
    ...descriptor,
    contentHash: litterBridgeSha256Utf8(litterBridgeMessageHashPreimage(descriptor)),
  };
};

const eventIdentity = (
  event: JsonRecord,
  translation: SessionTranslationState,
): { entryId: string; parentMessageId: string | null } => {
  if (typeof event.id !== "string" || !event.id || translation.seenEntryIds.has(event.id)) {
    throw new SessionReadError("integrity_failed", "Session entry identity is invalid", 422);
  }
  let parentMessageId: string | null;
  if (event.parentId === null) {
    parentMessageId = null;
  } else if (typeof event.parentId === "string" && translation.seenEntryIds.has(event.parentId)) {
    parentMessageId = translation.lineage.get(event.parentId) ?? null;
  } else {
    throw new SessionReadError("integrity_failed", "Session entry lineage is invalid", 422);
  }
  return { entryId: event.id, parentMessageId };
};

const translateSessionEvent = (
  event: JsonRecord,
  translation: SessionTranslationState,
): SessionArtifacts => {
  const { entryId, parentMessageId } = eventIdentity(event, translation);
  if (
    event.type === "model_change" ||
    event.type === "thinking_level_change" ||
    event.type === "custom" ||
    event.type === "label" ||
    event.type === "session_info"
  ) {
    return {
      message: null,
      tools: [],
      attachments: [],
      entryId,
      parentMessageId,
      safeOmission: true,
      toolOwnerUpdates: [],
    };
  }
  if (event.type !== "message" && event.type !== "message_end") {
    throw new SessionReadError("section_unavailable", "Session entry type is unsupported", 422);
  }
  if (!isRecord(event.message) || typeof event.message.role !== "string") {
    throw new SessionReadError("integrity_failed", "Session message is invalid", 422);
  }
  const sourceMessage = event.message;
  const createdAt = timestampFrom(event, sourceMessage);
  const wireMessageId = identifierFrom(entryId, "message");
  if (sourceMessage.role === "toolResult" || sourceMessage.role === "tool") {
    if (typeof sourceMessage.toolCallId !== "string" || !sourceMessage.toolCallId) {
      throw new SessionReadError("integrity_failed", "Session tool result is invalid", 422);
    }
    const owner = translation.toolOwners.get(sourceMessage.toolCallId);
    if (!owner || owner.completed) {
      throw new SessionReadError("integrity_failed", "Session tool lineage is invalid", 422);
    }
    if (
      sourceMessage.toolName !== undefined &&
      identifierFrom(sourceMessage.toolName, "tool-name") !== owner.name
    ) {
      throw new SessionReadError("integrity_failed", "Session tool name is inconsistent", 422);
    }
    if (typeof sourceMessage.isError !== "boolean") {
      throw new SessionReadError("integrity_failed", "Session tool result state is invalid", 422);
    }
    const content = translateContent(
      sourceMessage.content,
      wireMessageId,
      "tool",
      createdAt,
      translation,
      sourceMessage.reasoning_content,
    );
    const resultJson = boundedJsonText({
      content: content.normalized,
      isError: sourceMessage.isError,
    });
    const completedOwner = { ...owner, completed: true };
    const descriptor: LitterBridgeToolDescriptor = {
      toolCallId: owner.toolCallId,
      messageId: owner.messageId,
      name: owner.name,
      state: sourceMessage.isError ? "failed" : "completed",
      argumentsJson: owner.argumentsJson,
      argumentsHash: owner.argumentsHash,
      resultJson,
      resultHash: litterBridgeSha256Utf8(resultJson),
      startedAt: owner.startedAt,
      completedAt: createdAt,
    };
    return {
      message: messageDescriptor({
        messageId: wireMessageId,
        parentMessageId,
        sequence: translation.sequence + 1,
        role: "tool",
        createdAt,
        parts: content.parts,
      }),
      tools: [descriptor],
      attachments: content.attachments,
      entryId,
      parentMessageId,
      safeOmission: false,
      toolOwnerUpdates: [[sourceMessage.toolCallId, completedOwner]],
    };
  }
  if (
    sourceMessage.role !== "system" &&
    sourceMessage.role !== "user" &&
    sourceMessage.role !== "assistant"
  ) {
    throw new SessionReadError("section_unavailable", "Session message role is unsupported", 422);
  }
  const content = translateContent(
    sourceMessage.content,
    wireMessageId,
    sourceMessage.role,
    createdAt,
    translation,
    sourceMessage.reasoning_content,
  );
  return {
    message: messageDescriptor({
      messageId: wireMessageId,
      parentMessageId,
      sequence: translation.sequence + 1,
      role: sourceMessage.role,
      createdAt,
      parts: content.parts,
    }),
    tools: content.tools,
    attachments: content.attachments,
    entryId,
    parentMessageId,
    safeOmission: false,
    toolOwnerUpdates: content.toolOwnerUpdates,
  };
};

const applySessionArtifacts = (
  artifacts: SessionArtifacts,
  translation: SessionTranslationState,
): void => {
  if (!artifacts.entryId) return;
  if (translation.seenEntryIds.size >= SESSION_LINEAGE_LIMIT) {
    throw new SessionReadError(
      "payload_too_large",
      "Session lineage exceeds the transfer limit",
      413,
    );
  }
  translation.seenEntryIds.add(artifacts.entryId);
  translation.lineage.set(
    artifacts.entryId,
    artifacts.message?.messageId ?? artifacts.parentMessageId,
  );
  for (const [sourceId, owner] of artifacts.toolOwnerUpdates) {
    if (
      !translation.toolOwners.has(sourceId) &&
      translation.toolOwners.size >= SESSION_TOOL_LIMIT
    ) {
      throw new SessionReadError(
        "payload_too_large",
        "Session tools exceed the transfer limit",
        413,
      );
    }
    translation.toolOwners.set(sourceId, owner);
  }
  if (artifacts.message) translation.sequence = artifacts.message.sequence;
};

const cloneTranslationState = (state: SessionTranslationState): SessionTranslationState => ({
  lineage: new Map(state.lineage),
  seenEntryIds: new Set(state.seenEntryIds),
  toolOwners: new Map(state.toolOwners),
  sequence: state.sequence,
});

const mergePageTools = (
  existing: LitterBridgeToolDescriptor[],
  incoming: LitterBridgeToolDescriptor[],
): LitterBridgeToolDescriptor[] => {
  const merged = [...existing];
  const indexes = new Map(merged.map((tool, index) => [tool.toolCallId, index]));
  for (const tool of incoming) {
    const index = indexes.get(tool.toolCallId);
    if (index === undefined) {
      indexes.set(tool.toolCallId, merged.length);
      merged.push(tool);
      continue;
    }
    const previous = merged[index];
    if (
      (previous.state !== "requested" && previous.state !== "running") ||
      (tool.state !== "completed" && tool.state !== "failed" && tool.state !== "cancelled")
    ) {
      throw new SessionReadError("integrity_failed", "Session tool state is duplicated", 422);
    }
    merged[index] = tool;
  }
  return merged;
};

const buildSessionPage = (input: {
  requestId: string;
  pageId: string;
  controllerId: string;
  sessionId: string;
  exportedAt: string;
  metadata: LitterBridgeSessionMetadata;
  revision: number;
  messages: LitterBridgeMessageDescriptor[];
  tools: LitterBridgeToolDescriptor[];
  attachments: LitterBridgeAttachmentDescriptor[];
  cursor: LitterBridgeTransferCursor | null;
}): LitterBridgeSessionPage => {
  const canonicalSession: LitterBridgeExternalSessionIdentity = {
    kind: "external_session",
    authority: "local-studio",
    installationId: input.controllerId,
    sessionId: input.sessionId,
  };
  const messageHashes = input.messages.map(({ messageId, contentHash }) => ({
    id: messageId,
    sha256: contentHash,
  }));
  const toolHashes = input.tools.map((tool) => ({
    id: tool.toolCallId,
    sha256: litterBridgeSha256Utf8(litterBridgeToolHashPreimage(tool)),
  }));
  const attachmentHashes = input.attachments.map(({ attachmentId, contentHash }) => ({
    id: attachmentId,
    sha256: contentHash,
  }));
  const sessionHash = litterBridgeSha256Utf8(
    litterBridgeSessionHashPreimage({
      canonicalSession,
      metadata: input.metadata,
      revision: input.revision,
      messages: messageHashes,
      tools: toolHashes,
      attachments: attachmentHashes,
    }),
  );
  try {
    return Schema.decodeUnknownSync(LitterBridgeSessionPageSchema)({
      type: "session_page",
      protocolVersion: LITTER_BRIDGE_PROTOCOL_VERSION,
      requestId: input.requestId,
      pageId: input.pageId,
      canonicalSession,
      origin: {
        application: "local-studio",
        installationId: input.controllerId,
        deviceId: null,
        exportedAt: input.exportedAt,
      },
      metadata: input.metadata,
      revision: input.revision,
      messages: input.messages,
      tools: input.tools,
      attachments: input.attachments,
      contentHashes: {
        algorithm: "sha256",
        session: sessionHash,
        messages: messageHashes,
        tools: toolHashes,
        attachments: attachmentHashes,
      },
      cursor: input.cursor,
    });
  } catch {
    throw new SessionReadError("section_unavailable", "Session cannot be represented safely", 422);
  }
};

const cursorDescriptor = (
  token: string,
  revision: number,
  afterSequence: number,
): LitterBridgeTransferCursor => ({
  type: "session_transfer_cursor",
  token,
  revision,
  afterSequence,
  hasMore: true,
});

const readSessionSlice = (input: {
  request: LitterBridgeSessionReadRequest;
  controllerId: string;
  filepath: string;
  cwd: string;
  sessionId: string;
  fingerprint: string;
  revision: number;
  offset: number;
  metadata: LitterBridgeSessionMetadata;
  translation: SessionTranslationState;
  now: Date;
  cursorTtlMs: number;
}): { page: LitterBridgeSessionPage; json: string; cursorState: SessionCursorState | null } => {
  const before = sessionFileFingerprint(input.filepath);
  if (before.value !== input.fingerprint || before.revision !== input.revision) {
    throw new SessionReadError("revision_conflict", "Session changed during transfer", 409, true);
  }
  if (input.offset < 0 || input.offset > before.size) {
    throw new SessionReadError("integrity_failed", "Session cursor offset is invalid", 422);
  }
  const translation = cloneTranslationState(input.translation);
  const messages: LitterBridgeMessageDescriptor[] = [];
  const tools: LitterBridgeToolDescriptor[] = [];
  const attachments: LitterBridgeAttachmentDescriptor[] = [];
  const pageId = randomUUID();
  const exportedAt = input.now.toISOString();
  const placeholderToken = "A".repeat(43);
  let offset = input.offset;
  const fd = openSync(input.filepath, "r");
  try {
    while (offset < before.size && messages.length < input.request.limit) {
      const line = readSessionLine(fd, before.size, offset);
      if (!line) break;
      const event = parseSessionLine(line);
      if (!event) {
        offset = line.end;
        continue;
      }
      if (event.type === "session") {
        throw new SessionReadError("integrity_failed", "Session contains a duplicate header", 422);
      }
      const artifacts = translateSessionEvent(event, translation);
      if (artifacts.safeOmission) {
        applySessionArtifacts(artifacts, translation);
        offset = line.end;
        continue;
      }
      if (!artifacts.message) {
        throw new SessionReadError("internal", "Session translation failed", 500);
      }
      if (
        artifacts.tools.length > SESSION_PAGE_ITEM_LIMIT ||
        artifacts.attachments.length > SESSION_PAGE_ITEM_LIMIT
      ) {
        throw new SessionReadError(
          "payload_too_large",
          "Session message has too many transfer items",
          413,
        );
      }
      const candidateMessages = [...messages, artifacts.message];
      const candidateTools = mergePageTools(tools, artifacts.tools);
      const candidateAttachments = [...attachments, ...artifacts.attachments];
      if (
        candidateTools.length > SESSION_PAGE_ITEM_LIMIT ||
        candidateAttachments.length > SESSION_PAGE_ITEM_LIMIT
      ) {
        break;
      }
      const candidateCursor =
        line.end < before.size
          ? cursorDescriptor(placeholderToken, input.revision, artifacts.message.sequence)
          : null;
      const candidate = buildSessionPage({
        requestId: input.request.auth.requestId,
        pageId,
        controllerId: input.controllerId,
        sessionId: input.sessionId,
        exportedAt,
        metadata: input.metadata,
        revision: input.revision,
        messages: candidateMessages,
        tools: candidateTools,
        attachments: candidateAttachments,
        cursor: candidateCursor,
      });
      if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > RESPONSE_LIMIT_BYTES) {
        if (messages.length === 0) {
          throw new SessionReadError(
            "payload_too_large",
            "Session page exceeds the transfer limit",
            413,
          );
        }
        break;
      }
      applySessionArtifacts(artifacts, translation);
      messages.push(artifacts.message);
      tools.splice(0, tools.length, ...candidateTools);
      attachments.push(...artifacts.attachments);
      offset = line.end;
    }
  } finally {
    closeSync(fd);
  }
  const after = sessionFileFingerprint(input.filepath);
  if (after.value !== before.value) {
    throw new SessionReadError("revision_conflict", "Session changed during transfer", 409, true);
  }
  const token = offset < after.size ? randomBytes(32).toString("base64url") : null;
  const cursor = token ? cursorDescriptor(token, input.revision, translation.sequence) : null;
  const page = buildSessionPage({
    requestId: input.request.auth.requestId,
    pageId,
    controllerId: input.controllerId,
    sessionId: input.sessionId,
    exportedAt,
    metadata: input.metadata,
    revision: input.revision,
    messages,
    tools,
    attachments,
    cursor,
  });
  const json = JSON.stringify(page);
  if (Buffer.byteLength(json, "utf8") > RESPONSE_LIMIT_BYTES) {
    throw new SessionReadError("payload_too_large", "Session page exceeds the transfer limit", 413);
  }
  return {
    page,
    json,
    cursorState: token
      ? {
          controllerId: input.controllerId,
          deviceId: input.request.auth.device.deviceId,
          sessionId: input.sessionId,
          filepath: input.filepath,
          cwd: input.cwd,
          fingerprint: input.fingerprint,
          revision: input.revision,
          offset,
          afterSequence: translation.sequence,
          expiresAt: input.now.getTime() + input.cursorTtlMs,
          metadata: input.metadata,
          translation,
        }
      : null,
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
  const projects = options.projects ?? listProjectsFromStore;
  const roots = sessionRootPaths(dataDir, options.sessionRoots);
  const cursorTtlMs = options.sessionCursorTtlMs ?? CURSOR_TTL_MS;
  if (!Number.isSafeInteger(cursorTtlMs) || cursorTtlMs <= 0 || cursorTtlMs > 86_400_000) {
    throw new Error("Invalid Litter bridge cursor lifetime");
  }
  const inventoryLimit = options.sessionInventoryLimit ?? SESSION_INVENTORY_LIMIT;
  if (!Number.isSafeInteger(inventoryLimit) || inventoryLimit <= 0 || inventoryLimit > 100_000) {
    throw new Error("Invalid Litter bridge session inventory limit");
  }
  const activeSessionIds =
    options.activeSessionIds ??
    (() =>
      new Set(
        piRuntimeManager
          .listSessions()
          .filter(({ session }) => session.status.active && session.status.piSessionId)
          .map(({ session }) => session.status.piSessionId as string),
      ));
  const archivedSessionIds =
    options.archivedSessionIds ??
    (() => new Set(listArchivedSessionMetadata().map((metadata) => metadata.id)));
  const replay = new Map<string, number>();
  const cursors = new Map<string, SessionCursorState>();
  const listCursors = new Map<string, SessionListCursorState>();
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

  const pruneCursors = (nowMs: number): void => {
    for (const [token, state] of cursors) {
      if (state.expiresAt <= nowMs) cursors.delete(token);
    }
    let retainedItems = [...cursors.values()].reduce(
      (count, state) =>
        count + state.translation.seenEntryIds.size + state.translation.toolOwners.size,
      0,
    );
    while (cursors.size > CURSOR_STORE_LIMIT || retainedItems > CURSOR_STATE_ITEM_LIMIT) {
      const oldest = cursors.keys().next().value;
      if (oldest === undefined) break;
      const state = cursors.get(oldest);
      if (state) {
        retainedItems -= state.translation.seenEntryIds.size + state.translation.toolOwners.size;
      }
      cursors.delete(oldest);
    }
    for (const [token, state] of listCursors) {
      if (state.expiresAt <= nowMs) listCursors.delete(token);
    }
    while (listCursors.size > CURSOR_STORE_LIMIT) {
      const oldest = listCursors.keys().next().value;
      if (oldest === undefined) break;
      listCursors.delete(oldest);
    }
  };

  const rememberCursor = (token: string, state: SessionCursorState): void => {
    cursors.set(token, state);
    pruneCursors(now().getTime());
  };

  const rememberListCursor = (token: string, state: SessionListCursorState): void => {
    listCursors.set(token, state);
    pruneCursors(now().getTime());
  };

  const buildSnapshot = async (
    request: LitterBridgeControllerSnapshotRequest,
  ): Promise<LitterBridgeControllerSnapshot> => {
    const settings = options.controllerUrl === undefined ? await getApiSettings() : null;
    const backendUrl = options.controllerUrl ?? settings?.backendUrl;
    if (!backendUrl) throw new Error("Controller settings are unavailable");
    const apiKey = options.controllerApiKey ?? settings?.apiKey ?? "";
    const base = resolveControllerBase(backendUrl);
    const requestId = request.auth.requestId;
    const healthPromise = (async () => {
      const startedAt = performance.now();
      try {
        const result = await fetchControllerJson(implementation, base, "/health", 1_500, apiKey);
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
          await fetchControllerJson(implementation, base, "/status", 2_000, apiKey),
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
          await fetchControllerJson(implementation, base, "/gpus", 2_500, apiKey),
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
          await fetchControllerJson(
            implementation,
            base,
            "/v1/metrics/vllm",
            2_500,
            apiKey,
          ),
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

  const handleSessionList = (
    request: LitterBridgeSessionListRequest,
    requestNow: Date,
  ): Response => {
    pruneCursors(requestNow.getTime());
    let offset = 0;
    let expected: SessionListCursorState | null = null;
    if (request.cursor) {
      const state = listCursors.get(request.cursor.token);
      if (!state || state.expiresAt <= requestNow.getTime()) {
        listCursors.delete(request.cursor.token);
        throw new SessionReadError(
          "invalid_request",
          "Session list cursor is invalid or expired",
          400,
        );
      }
      if (state.controllerId !== controllerId) {
        throw new SessionReadError("not_found", "Session list cursor was not found", 404);
      }
      if (state.deviceId !== request.auth.device.deviceId) {
        throw new SessionReadError(
          "forbidden",
          "Session list cursor belongs to another device",
          403,
        );
      }
      if (request.cursor.revision !== state.revision || request.cursor.hasMore !== true) {
        throw new SessionReadError("invalid_request", "Session list cursor is invalid", 400);
      }
      listCursors.delete(request.cursor.token);
      offset = state.offset;
      expected = state;
    }
    const inventory = enumerateSessionInventory({
      controllerId,
      projects: projects(),
      roots,
      inventoryLimit,
      activeSessionIds: activeSessionIds(),
      archivedSessionIds: archivedSessionIds(),
    });
    if (
      expected &&
      (expected.revision !== inventory.revision || expected.inventoryHash !== inventory.hash)
    ) {
      throw new SessionReadError(
        "revision_conflict",
        "Session inventory changed during discovery",
        409,
        true,
      );
    }
    const result = pageSessionInventory({ request, controllerId, inventory, offset });
    if (result.token && result.nextOffset !== null) {
      rememberListCursor(result.token, {
        controllerId,
        deviceId: request.auth.device.deviceId,
        revision: inventory.revision,
        inventoryHash: inventory.hash,
        offset: result.nextOffset,
        expiresAt: requestNow.getTime() + cursorTtlMs,
      });
    }
    return new Response(result.json, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  };

  const handleSessionRead = (
    request: LitterBridgeSessionReadRequest,
    requestNow: Date,
  ): Response => {
    pruneCursors(requestNow.getTime());
    let filepath: string;
    let cwd: string;
    let sessionId: string;
    let fingerprint: string;
    let sessionRevision: number;
    let offset: number;
    let metadata: LitterBridgeSessionMetadata;
    let translation: SessionTranslationState;
    if (request.session) {
      if (
        request.session.authority !== "local-studio" ||
        request.session.installationId !== controllerId
      ) {
        throw new SessionReadError("not_found", "Session identity was not found", 404);
      }
      const resolved = resolveSessionFile(request.session.sessionId, projects(), roots);
      metadata = readSessionMetadata(resolved);
      const afterMetadata = sessionFileFingerprint(resolved.filepath);
      if (afterMetadata.value !== resolved.value) {
        throw new SessionReadError(
          "revision_conflict",
          "Session changed during transfer",
          409,
          true,
        );
      }
      filepath = resolved.filepath;
      cwd = resolved.cwd;
      sessionId = resolved.sessionId;
      fingerprint = resolved.value;
      sessionRevision = resolved.revision;
      offset = resolved.headerEnd;
      translation = {
        lineage: new Map(),
        seenEntryIds: new Set(),
        toolOwners: new Map(),
        sequence: 0,
      };
    } else {
      const supplied = request.cursor;
      if (!supplied) {
        throw new SessionReadError("invalid_request", "Session cursor is invalid", 400);
      }
      const state = cursors.get(supplied.token);
      if (!state || state.expiresAt <= requestNow.getTime()) {
        cursors.delete(supplied.token);
        throw new SessionReadError("invalid_request", "Session cursor is invalid or expired", 400);
      }
      if (state.controllerId !== controllerId) {
        throw new SessionReadError("not_found", "Session cursor was not found", 404);
      }
      if (state.deviceId !== request.auth.device.deviceId) {
        throw new SessionReadError("forbidden", "Session cursor belongs to another device", 403);
      }
      if (
        supplied.revision !== state.revision ||
        supplied.afterSequence !== state.afterSequence ||
        supplied.hasMore !== true
      ) {
        throw new SessionReadError("invalid_request", "Session cursor is invalid", 400);
      }
      if (!liveProjects(projects()).some((project) => project.cwd === state.cwd)) {
        throw new SessionReadError("not_found", "Session project was not found", 404);
      }
      cursors.delete(supplied.token);
      filepath = state.filepath;
      cwd = state.cwd;
      sessionId = state.sessionId;
      fingerprint = state.fingerprint;
      sessionRevision = state.revision;
      offset = state.offset;
      metadata = state.metadata;
      translation = state.translation;
    }
    const result = readSessionSlice({
      request,
      controllerId,
      filepath,
      cwd,
      sessionId,
      fingerprint,
      revision: sessionRevision,
      offset,
      metadata,
      translation,
      now: requestNow,
      cursorTtlMs,
    });
    if (result.page.cursor && result.cursorState) {
      rememberCursor(result.page.cursor.token, result.cursorState);
    }
    return new Response(result.json, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
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
    let parsed: SignedGatewayRequest;
    try {
      if (isRecord(body.value) && body.value.type === "controller_snapshot_request") {
        parsed = Schema.decodeUnknownSync(LitterBridgeControllerSnapshotRequestSchema)(body.value);
      } else if (isRecord(body.value) && body.value.type === "session_list_request") {
        parsed = Schema.decodeUnknownSync(LitterBridgeSessionListRequestSchema)(body.value);
      } else if (isRecord(body.value) && body.value.type === "session_read_request") {
        parsed = Schema.decodeUnknownSync(LitterBridgeSessionReadRequestSchema)(body.value);
      } else {
        throw new Error("Unsupported request");
      }
    } catch {
      const suppliedVersion = isRecord(body.value) ? body.value.protocolVersion : null;
      const code =
        suppliedVersion !== null && suppliedVersion !== LITTER_BRIDGE_PROTOCOL_VERSION
          ? "unsupported_version"
          : "invalid_request";
      return jsonError(code, "Gateway request is invalid", requestId, 400);
    }
    const requestNow = now();
    const verified = verifyLitterBridgeRequest(parsed, requestNow);
    if (!verified.ok) return verified.response;
    if (parsed.type === "controller_snapshot_request" && parsed.controllerId !== controllerId) {
      return jsonError("not_found", "Controller identity was not found", requestId, 404);
    }
    if (
      parsed.type === "session_read_request" &&
      parsed.session &&
      (parsed.session.authority !== "local-studio" ||
        parsed.session.installationId !== controllerId)
    ) {
      return jsonError("not_found", "Controller identity was not found", requestId, 404);
    }
    const nowMs = requestNow.getTime();
    pruneReplay(nowMs);
    if (replay.has(verified.replayKey)) {
      return jsonError("replay_detected", "Request was already processed", requestId, 409);
    }
    replay.set(verified.replayKey, verified.expiresAt);
    if (parsed.type === "session_list_request") {
      try {
        return handleSessionList(parsed, requestNow);
      } catch (error) {
        if (error instanceof SessionReadError) {
          return jsonError(error.code, error.message, requestId, error.status, error.retriable);
        }
        return jsonError("internal", "Session discovery failed", requestId, 500);
      }
    }
    if (parsed.type === "session_read_request") {
      try {
        return handleSessionRead(parsed, requestNow);
      } catch (error) {
        if (error instanceof SessionReadError) {
          return jsonError(error.code, error.message, requestId, error.status, error.retriable);
        }
        return jsonError("internal", "Session export failed", requestId, 500);
      }
    }
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
