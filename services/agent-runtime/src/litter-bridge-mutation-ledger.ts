import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

type SqlStatement = {
  run(...values: unknown[]): { changes: number };
  get(...values: unknown[]): unknown;
};

type SqlDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
};

const runtimeRequire = createRequire(import.meta.url);

const loadDatabase = (): new (filepath: string) => SqlDatabase => {
  const bunVersion = (process.versions as NodeJS.ProcessVersions & { bun?: string }).bun;
  if (bunVersion) {
    return (runtimeRequire("bun:sqlite") as { Database: new (filepath: string) => SqlDatabase })
      .Database;
  }
  return (
    runtimeRequire("node:sqlite") as {
      DatabaseSync: new (filepath: string) => SqlDatabase;
    }
  ).DatabaseSync;
};

const FILENAME = "litter-mutation-idempotency.sqlite";
const STORE_VERSION = 2;
const DEFAULT_LEASE_MS = 120_000;
export const LITTER_MUTATION_IDEMPOTENCY_HORIZON_MS = 30 * 24 * 60 * 60 * 1_000;

type LedgerState =
  | "reserved"
  | "dispatching"
  | "accepted"
  | "rejected"
  | "retryable"
  | "indeterminate";

type LedgerRow = {
  body_hash: string;
  state: LedgerState;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at_ms: number | null;
  correlation_json: string | null;
  result_json: string | null;
  http_status: number | null;
};

export type MutationIdentity = {
  controllerId: string;
  deviceId: string;
  idempotencyKey: string;
};

export type MutationLease = {
  ownerId: string;
  token: string;
  expiresAt: string;
};

export type MutationCorrelation = {
  dispatchId: string;
  sessionId: string;
  sessionFile: string;
  messageId: string;
  contentHash: string;
  baseRevision: number;
  baseOffset: number;
  modelId: string;
  dispatchedAt: string;
};

export type StoredMutationResult = {
  status: number;
  result: unknown;
};

export type MutationReservation =
  | { kind: "reserved"; lease: MutationLease }
  | { kind: "cached"; stored: StoredMutationResult }
  | { kind: "mismatch" }
  | { kind: "busy"; retryAfterMs: number }
  | { kind: "reconcile"; correlation: MutationCorrelation };

type LedgerOptions = {
  leaseMs?: number;
  retentionMs?: number;
  reconcileWindowMs?: number;
};

const validHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const validIdentifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value && value.length <= 512;

const validTimestamp = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value);

const normalizeCorrelation = (value: unknown): MutationCorrelation => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Litter mutation correlation is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    !validIdentifier(record.dispatchId) ||
    !validIdentifier(record.sessionId) ||
    typeof record.sessionFile !== "string" ||
    record.sessionFile.length === 0 ||
    record.sessionFile.length > 16_384 ||
    !path.isAbsolute(record.sessionFile) ||
    !validIdentifier(record.messageId) ||
    !validHash(record.contentHash) ||
    !Number.isSafeInteger(record.baseRevision) ||
    Number(record.baseRevision) < 0 ||
    !Number.isSafeInteger(record.baseOffset) ||
    Number(record.baseOffset) < 0 ||
    !validIdentifier(record.modelId) ||
    !validTimestamp(record.dispatchedAt)
  ) {
    throw new Error("Litter mutation correlation is invalid");
  }
  return {
    dispatchId: record.dispatchId,
    sessionId: record.sessionId,
    sessionFile: record.sessionFile,
    messageId: record.messageId,
    contentHash: record.contentHash,
    baseRevision: Number(record.baseRevision),
    baseOffset: Number(record.baseOffset),
    modelId: record.modelId,
    dispatchedAt: record.dispatchedAt,
  };
};

const entryKey = (identity: MutationIdentity): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        "litter-mutation-v1",
        "agent_turn",
        identity.controllerId,
        identity.deviceId,
        identity.idempotencyKey,
      ]),
      "utf8",
    )
    .digest("hex");

const verifyOwnerOnly = (filepath: string, kind: "file" | "directory"): void => {
  const metadata = lstatSync(filepath);
  const validKind = kind === "file" ? metadata.isFile() : metadata.isDirectory();
  if (!validKind || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error(`Litter mutation ledger ${kind} permissions are unsafe`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && metadata.uid !== uid) {
    throw new Error(`Litter mutation ledger ${kind} ownership is unsafe`);
  }
};

const createOwnerOnlyFile = (filepath: string): void => {
  try {
    const descriptor = openSync(
      filepath,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    closeSync(descriptor);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  }
  verifyOwnerOnly(filepath, "file");
};

const parseRow = (value: unknown): LedgerRow | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !validHash(row.body_hash) ||
    (row.state !== "reserved" &&
      row.state !== "dispatching" &&
      row.state !== "accepted" &&
      row.state !== "rejected" &&
      row.state !== "retryable" &&
      row.state !== "indeterminate")
  ) {
    throw new Error("Litter mutation ledger row is invalid");
  }
  return row as LedgerRow;
};

export function createLitterMutationLedger(
  dataDir: string,
  now: () => Date,
  options: LedgerOptions = {},
) {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const retentionMs = options.retentionMs ?? LITTER_MUTATION_IDEMPOTENCY_HORIZON_MS;
  const reconcileWindowMs = options.reconcileWindowMs ?? leaseMs;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 3_600_000) {
    throw new Error("Invalid Litter mutation lease lifetime");
  }
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 60_000) {
    throw new Error("Invalid Litter mutation retention lifetime");
  }
  if (
    !Number.isSafeInteger(reconcileWindowMs) ||
    reconcileWindowMs < 1_000 ||
    reconcileWindowMs > 3_600_000
  ) {
    throw new Error("Invalid Litter mutation reconciliation window");
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  verifyOwnerOnly(dataDir, "directory");
  const filepath = path.join(dataDir, FILENAME);
  createOwnerOnlyFile(filepath);
  const RuntimeDatabase = loadDatabase();
  const database = new RuntimeDatabase(filepath);
  database.exec("PRAGMA busy_timeout = 10000");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA trusted_schema = OFF");
  database.exec(`
    CREATE TABLE IF NOT EXISTS ledger_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS mutations (
      entry_key TEXT PRIMARY KEY,
      operation TEXT NOT NULL CHECK (operation = 'agent_turn'),
      body_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('reserved', 'dispatching', 'accepted', 'rejected', 'retryable', 'indeterminate')),
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER,
      lease_owner TEXT,
      lease_token TEXT,
      lease_expires_at_ms INTEGER,
      correlation_json TEXT,
      result_json TEXT,
      http_status INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS mutations_expiry ON mutations(expires_at_ms);
  `);
  database
    .prepare("INSERT OR IGNORE INTO ledger_metadata(key, value) VALUES ('version', ?)")
    .run(String(STORE_VERSION));
  const version = database
    .prepare("SELECT value FROM ledger_metadata WHERE key = 'version'")
    .get() as { value?: unknown } | undefined;
  if (version?.value !== String(STORE_VERSION)) {
    database.close();
    throw new Error("Unsupported Litter mutation ledger version");
  }
  chmodSync(filepath, 0o600);
  verifyOwnerOnly(filepath, "file");

  const transaction = <T>(task: () => T): T => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = task();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  };

  const getRow = (key: string): LedgerRow | null =>
    parseRow(
      database
        .prepare(
          "SELECT body_hash, state, lease_owner, lease_token, lease_expires_at_ms, correlation_json, result_json, http_status FROM mutations WHERE entry_key = ?",
        )
        .get(key),
    );

  const requireBody = (key: string, bodyHash: string): LedgerRow => {
    const row = getRow(key);
    if (!row || row.body_hash !== bodyHash) {
      throw new Error("Litter mutation reservation is invalid");
    }
    return row;
  };

  const reserve = (
    identity: MutationIdentity,
    bodyHash: string,
    ownerId: string,
  ): MutationReservation => {
    if (!validHash(bodyHash) || !validIdentifier(ownerId)) {
      throw new Error("Litter mutation reservation input is invalid");
    }
    const key = entryKey(identity);
    return transaction(() => {
      const observedAt = now().getTime();
      database
        .prepare(
          "DELETE FROM mutations WHERE expires_at_ms IS NOT NULL AND expires_at_ms <= ? AND state IN ('accepted', 'rejected', 'retryable', 'dispatching', 'indeterminate')",
        )
        .run(observedAt);
      const existing = getRow(key);
      if (existing) {
        if (existing.body_hash !== bodyHash) return { kind: "mismatch" };
        if (existing.state === "accepted" || existing.state === "rejected") {
          if (
            typeof existing.result_json !== "string" ||
            !Number.isInteger(existing.http_status) ||
            Number(existing.http_status) < 100 ||
            Number(existing.http_status) > 599
          ) {
            throw new Error("Litter mutation cached result is invalid");
          }
          return {
            kind: "cached",
            stored: {
              status: Number(existing.http_status),
              result: JSON.parse(existing.result_json),
            },
          };
        }
        if (existing.state === "dispatching" || existing.state === "indeterminate") {
          if (typeof existing.correlation_json !== "string") {
            throw new Error("Litter mutation dispatch correlation is missing");
          }
          return {
            kind: "reconcile",
            correlation: normalizeCorrelation(JSON.parse(existing.correlation_json)),
          };
        }
        if (
          existing.state === "reserved" &&
          typeof existing.lease_expires_at_ms === "number" &&
          existing.lease_expires_at_ms > observedAt
        ) {
          return { kind: "busy", retryAfterMs: existing.lease_expires_at_ms - observedAt };
        }
      }
      const token = randomBytes(24).toString("base64url");
      const expiresAtMs = observedAt + leaseMs;
      if (existing) {
        database
          .prepare(
            "UPDATE mutations SET state = 'reserved', updated_at_ms = ?, expires_at_ms = NULL, lease_owner = ?, lease_token = ?, lease_expires_at_ms = ?, correlation_json = NULL, result_json = NULL, http_status = NULL WHERE entry_key = ?",
          )
          .run(observedAt, ownerId, token, expiresAtMs, key);
      } else {
        database
          .prepare(
            "INSERT INTO mutations(entry_key, operation, body_hash, state, created_at_ms, updated_at_ms, lease_owner, lease_token, lease_expires_at_ms) VALUES (?, 'agent_turn', ?, 'reserved', ?, ?, ?, ?, ?)",
          )
          .run(key, bodyHash, observedAt, observedAt, ownerId, token, expiresAtMs);
      }
      return {
        kind: "reserved",
        lease: { ownerId, token, expiresAt: new Date(expiresAtMs).toISOString() },
      };
    });
  };

  const renew = (identity: MutationIdentity, bodyHash: string, lease: MutationLease): boolean => {
    const key = entryKey(identity);
    return transaction(() => {
      const row = requireBody(key, bodyHash);
      if (
        row.state !== "reserved" ||
        row.lease_owner !== lease.ownerId ||
        row.lease_token !== lease.token
      ) {
        return false;
      }
      const observedAt = now().getTime();
      const expiresAtMs = observedAt + leaseMs;
      const result = database
        .prepare(
          "UPDATE mutations SET updated_at_ms = ?, lease_expires_at_ms = ? WHERE entry_key = ? AND state = 'reserved' AND lease_owner = ? AND lease_token = ?",
        )
        .run(observedAt, expiresAtMs, key, lease.ownerId, lease.token);
      if (result.changes === 1) lease.expiresAt = new Date(expiresAtMs).toISOString();
      return result.changes === 1;
    });
  };

  const markDispatching = (
    identity: MutationIdentity,
    bodyHash: string,
    lease: MutationLease,
    correlation: MutationCorrelation,
  ): void => {
    const normalized = normalizeCorrelation(correlation);
    const key = entryKey(identity);
    transaction(() => {
      const row = requireBody(key, bodyHash);
      if (
        row.state !== "reserved" ||
        row.lease_owner !== lease.ownerId ||
        row.lease_token !== lease.token
      ) {
        throw new Error("Litter mutation lease was lost before dispatch");
      }
      const observedAt = now().getTime();
      const result = database
        .prepare(
          "UPDATE mutations SET state = 'dispatching', updated_at_ms = ?, expires_at_ms = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at_ms = NULL, correlation_json = ? WHERE entry_key = ? AND state = 'reserved' AND lease_owner = ? AND lease_token = ?",
        )
        .run(observedAt, observedAt + reconcileWindowMs, JSON.stringify(normalized), key, lease.ownerId, lease.token);
      if (result.changes !== 1) throw new Error("Litter mutation lease was lost before dispatch");
    });
  };

  const settleReservedRejected = (
    identity: MutationIdentity,
    bodyHash: string,
    lease: MutationLease,
    stored: StoredMutationResult,
  ): void => {
    const key = entryKey(identity);
    const resultJson = JSON.stringify(stored.result);
    if (typeof resultJson !== "string" || stored.status < 100 || stored.status > 599) {
      throw new Error("Litter mutation result is invalid");
    }
    transaction(() => {
      const row = requireBody(key, bodyHash);
      if (
        row.state !== "reserved" ||
        row.lease_owner !== lease.ownerId ||
        row.lease_token !== lease.token
      ) {
        throw new Error("Litter mutation reservation is invalid");
      }
      const observedAt = now().getTime();
      database
        .prepare(
          "UPDATE mutations SET state = 'rejected', updated_at_ms = ?, expires_at_ms = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at_ms = NULL, result_json = ?, http_status = ? WHERE entry_key = ?",
        )
        .run(observedAt, observedAt + retentionMs, resultJson, stored.status, key);
    });
  };

  const releaseRetryable = (
    identity: MutationIdentity,
    bodyHash: string,
    lease: MutationLease,
  ): void => {
    const key = entryKey(identity);
    transaction(() => {
      const row = requireBody(key, bodyHash);
      if (
        row.state !== "reserved" ||
        row.lease_owner !== lease.ownerId ||
        row.lease_token !== lease.token
      ) {
        throw new Error("Litter mutation reservation is invalid");
      }
      const observedAt = now().getTime();
      database
        .prepare(
          "UPDATE mutations SET state = 'retryable', updated_at_ms = ?, expires_at_ms = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at_ms = NULL WHERE entry_key = ?",
        )
        .run(observedAt, observedAt + retentionMs, key);
    });
  };

  const releaseDispatchRetryable = (
    identity: MutationIdentity,
    bodyHash: string,
    dispatchId: string,
  ): void => {
    const key = entryKey(identity);
    transaction(() => {
      const row = requireBody(key, bodyHash);
      if (row.state !== "dispatching" || typeof row.correlation_json !== "string") {
        throw new Error("Litter mutation dispatch is invalid");
      }
      const correlation = normalizeCorrelation(JSON.parse(row.correlation_json));
      if (correlation.dispatchId !== dispatchId) {
        throw new Error("Litter mutation dispatch is invalid");
      }
      const observedAt = now().getTime();
      database
        .prepare(
          "UPDATE mutations SET state = 'retryable', updated_at_ms = ?, expires_at_ms = ?, correlation_json = NULL WHERE entry_key = ?",
        )
        .run(observedAt, observedAt + retentionMs, key);
    });
  };

  const settleDispatched = (
    identity: MutationIdentity,
    bodyHash: string,
    dispatchId: string,
    state: "accepted" | "rejected",
    stored: StoredMutationResult,
  ): void => {
    const key = entryKey(identity);
    const resultJson = JSON.stringify(stored.result);
    if (typeof resultJson !== "string" || stored.status < 100 || stored.status > 599) {
      throw new Error("Litter mutation result is invalid");
    }
    transaction(() => {
      const row = requireBody(key, bodyHash);
      if (
        (row.state !== "dispatching" && row.state !== "indeterminate") ||
        typeof row.correlation_json !== "string"
      ) {
        throw new Error("Litter mutation dispatch is invalid");
      }
      const correlation = normalizeCorrelation(JSON.parse(row.correlation_json));
      if (correlation.dispatchId !== dispatchId) {
        throw new Error("Litter mutation dispatch is invalid");
      }
      const observedAt = now().getTime();
      database
        .prepare(
          "UPDATE mutations SET state = ?, updated_at_ms = ?, expires_at_ms = ?, result_json = ?, http_status = ? WHERE entry_key = ?",
        )
        .run(state, observedAt, observedAt + retentionMs, resultJson, stored.status, key);
    });
  };

  const markIndeterminate = (
    identity: MutationIdentity,
    bodyHash: string,
    dispatchId: string,
  ): void => {
    const key = entryKey(identity);
    transaction(() => {
      const row = requireBody(key, bodyHash);
      if (row.state !== "dispatching" || typeof row.correlation_json !== "string") return;
      const correlation = normalizeCorrelation(JSON.parse(row.correlation_json));
      if (correlation.dispatchId !== dispatchId) {
        throw new Error("Litter mutation dispatch is invalid");
      }
      const observedAt = now().getTime();
      database
        .prepare(
          "UPDATE mutations SET state = 'indeterminate', updated_at_ms = ?, expires_at_ms = ? WHERE entry_key = ?",
        )
        .run(observedAt, observedAt + reconcileWindowMs, key);
    });
  };

  const close = (): void => database.close();

  return {
    reserve,
    renew,
    markDispatching,
    settleReservedRejected,
    releaseRetryable,
    releaseDispatchRetryable,
    settleDispatched,
    markIndeterminate,
    close,
    filepath,
    leaseMs,
    retentionMs,
    reconcileWindowMs,
  };
}
