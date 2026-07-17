import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import type { Backend } from "@local-studio/contracts/recipes";
import { Effect, Schema } from "effect";
import type { ProcessInventoryEntry } from "./process-inventory";

const positiveInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));

export const DOCKER_BINDING_ENVIRONMENT_KEYS = [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
] as const;

const DockerBindingEnvironmentSchema = Schema.Struct({
  DOCKER_HOST: Schema.NullOr(Schema.String),
  DOCKER_CONTEXT: Schema.NullOr(Schema.String),
  DOCKER_CONFIG: Schema.NullOr(Schema.String),
  DOCKER_TLS_VERIFY: Schema.NullOr(Schema.String),
  DOCKER_CERT_PATH: Schema.NullOr(Schema.String),
});

const ownershipRecordFields = {
  version: Schema.Literal(1),
  launchId: Schema.String,
  recipeId: Schema.String,
  backend: Schema.Literals(["vllm", "sglang", "llamacpp", "mlx"]),
  port: positiveInteger,
  createdAtMs: positiveInteger,
  runtimeKind: Schema.Literals(["native", "docker"]),
  commandFingerprint: Schema.String,
  dockerAuthority: Schema.optional(Schema.Literal("direct")),
  dockerDaemonFingerprint: Schema.optional(Schema.String),
  dockerExecutable: Schema.optional(Schema.String),
  dockerEnvironment: Schema.optional(DockerBindingEnvironmentSchema),
};

const PendingProcessOwnershipRecordSchema = Schema.Struct({
  ...ownershipRecordFields,
  state: Schema.Literal("pending"),
});

const SpawnedProcessOwnershipRecordSchema = Schema.Struct({
  ...ownershipRecordFields,
  state: Schema.Literal("spawned"),
  rootPid: positiveInteger,
  processGroupId: positiveInteger,
});

const ActiveProcessOwnershipRecordSchema = Schema.Struct({
  ...ownershipRecordFields,
  state: Schema.Literal("active"),
  rootPid: positiveInteger,
  processGroupId: positiveInteger,
  startIdentity: Schema.String,
});

const ProcessOwnershipRecordSchema = Schema.Union([
  PendingProcessOwnershipRecordSchema,
  SpawnedProcessOwnershipRecordSchema,
  ActiveProcessOwnershipRecordSchema,
]);

export type ProcessOwnershipBase = {
  readonly version: 1;
  readonly launchId: string;
  readonly recipeId: string;
  readonly backend: Backend;
  readonly port: number;
  readonly createdAtMs: number;
  readonly runtimeKind: "native" | "docker";
  readonly commandFingerprint: string;
  readonly dockerAuthority?: "direct" | undefined;
  readonly dockerDaemonFingerprint?: string | undefined;
  readonly dockerExecutable?: string | undefined;
  readonly dockerEnvironment?: DockerBindingEnvironment | undefined;
};

export type DockerBindingEnvironment = {
  readonly DOCKER_HOST: string | null;
  readonly DOCKER_CONTEXT: string | null;
  readonly DOCKER_CONFIG: string | null;
  readonly DOCKER_TLS_VERIFY: string | null;
  readonly DOCKER_CERT_PATH: string | null;
};

export type PendingProcessOwnershipRecord = ProcessOwnershipBase & {
  readonly state: "pending";
};

export type SpawnedProcessOwnershipRecord = ProcessOwnershipBase & {
  readonly state: "spawned";
  readonly rootPid: number;
  readonly processGroupId: number;
};

export type ActiveProcessOwnershipRecord = ProcessOwnershipBase & {
  readonly state: "active";
  readonly rootPid: number;
  readonly processGroupId: number;
  readonly startIdentity: string;
};

export type ProcessOwnershipRecord =
  | PendingProcessOwnershipRecord
  | SpawnedProcessOwnershipRecord
  | ActiveProcessOwnershipRecord;

export type ProcessOwnershipRead =
  | { readonly status: "found"; readonly record: ProcessOwnershipRecord }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "missing" };

export type OwnedProcessGroupState =
  | { readonly status: "owned"; readonly members: readonly ProcessInventoryEntry[] }
  | { readonly status: "gone" }
  | { readonly status: "identity-mismatch" };

export type ProcessOwnershipScope = {
  readonly record: ProcessOwnershipRecord;
  readonly activate: (
    identity: Pick<ActiveProcessOwnershipRecord, "rootPid" | "processGroupId" | "startIdentity">,
  ) => ActiveProcessOwnershipRecord;
  readonly read: () => ProcessOwnershipRead;
  readonly remove: () => boolean;
};

export type ProcessOwnershipLockTiming = {
  readonly acquireTimeoutMs?: number | undefined;
  readonly invalidOwnerGraceMs?: number | undefined;
  readonly retryIntervalMs?: number | undefined;
};

export type ProcessOwnershipLaunch = {
  readonly markSpawned: (
    identity: Pick<SpawnedProcessOwnershipRecord, "rootPid" | "processGroupId">,
  ) => SpawnedProcessOwnershipRecord | ActiveProcessOwnershipRecord;
  readonly activate: (
    identity: Pick<ActiveProcessOwnershipRecord, "rootPid" | "processGroupId" | "startIdentity">,
  ) => ActiveProcessOwnershipRecord;
  readonly remove: () => boolean;
  readonly release: () => void;
};

export type ExactGenerationResult<Value> =
  | { readonly status: "acquired"; readonly value: Value }
  | { readonly status: "changed" };

export interface ProcessOwnershipStore {
  readonly path: string;
  readonly beginLaunch: (record: PendingProcessOwnershipRecord) => ProcessOwnershipLaunch;
  readonly create: (record: PendingProcessOwnershipRecord) => void;
  readonly markSpawned: (
    pending: PendingProcessOwnershipRecord,
    identity: Pick<SpawnedProcessOwnershipRecord, "rootPid" | "processGroupId">,
  ) => SpawnedProcessOwnershipRecord | ActiveProcessOwnershipRecord;
  readonly activate: (
    pending: PendingProcessOwnershipRecord | SpawnedProcessOwnershipRecord,
    identity: Pick<ActiveProcessOwnershipRecord, "rootPid" | "processGroupId" | "startIdentity">,
  ) => ActiveProcessOwnershipRecord;
  readonly read: () => ProcessOwnershipRead;
  readonly remove: (record: ProcessOwnershipRecord) => boolean;
  readonly withExactGeneration: <Value, Failure, Requirements>(
    record: ProcessOwnershipRecord,
    use: (scope: ProcessOwnershipScope) => Effect.Effect<Value, Failure, Requirements>,
  ) => Effect.Effect<ExactGenerationResult<Value>, Failure | Error, Requirements>;
}

const MAX_RECORD_BYTES = 16_384;
const DEFAULT_LOCK_TIMING = {
  acquireTimeoutMs: 15_000,
  invalidOwnerGraceMs: 250,
  retryIntervalMs: 10,
} as const;

type ResolvedLockTiming = {
  readonly acquireTimeoutMs: number;
  readonly invalidOwnerGraceMs: number;
  readonly retryIntervalMs: number;
};

const boundedTiming = (value: number | undefined, fallback: number, maximum: number): number =>
  Number.isSafeInteger(value) ? Math.min(maximum, Math.max(1, value ?? fallback)) : fallback;

const resolveLockTiming = (timing: ProcessOwnershipLockTiming): ResolvedLockTiming => {
  const invalidOwnerGraceMs = boundedTiming(
    timing.invalidOwnerGraceMs,
    DEFAULT_LOCK_TIMING.invalidOwnerGraceMs,
    5_000,
  );
  const retryIntervalMs = boundedTiming(
    timing.retryIntervalMs,
    DEFAULT_LOCK_TIMING.retryIntervalMs,
    250,
  );
  return {
    invalidOwnerGraceMs,
    retryIntervalMs,
    acquireTimeoutMs: Math.max(
      invalidOwnerGraceMs + retryIntervalMs,
      boundedTiming(timing.acquireTimeoutMs, DEFAULT_LOCK_TIMING.acquireTimeoutMs, 60_000),
    ),
  };
};

const ownershipDirectory = (dataDirectory: string): string => join(dataDirectory, "processes");

export const processOwnershipRecordPath = (dataDirectory: string): string =>
  join(ownershipDirectory(dataDirectory), "inference-owner.json");

const LockMetadataSchema = Schema.Struct({
  version: Schema.Literal(1),
  token: Schema.String,
  pid: positiveInteger,
  startIdentity: Schema.String,
  createdAtMs: positiveInteger,
});

type LockMetadata = {
  readonly version: 1;
  readonly token: string;
  readonly pid: number;
  readonly startIdentity: string;
  readonly createdAtMs: number;
};

type ProcessStartIdentityRead =
  | { readonly status: "found"; readonly value: string }
  | { readonly status: "gone" }
  | { readonly status: "unavailable" };

type LockHandle = {
  readonly directory: string;
  readonly metadata: LockMetadata;
};

const hasErrorCode = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && "code" in error && typeof error.code === "string";

const ownedByCurrentUser = (uid: number): boolean =>
  typeof process.getuid !== "function" || uid === process.getuid();

const directoryIsPrivate = (path: string): boolean => {
  const metadata = lstatSync(path);
  return (
    metadata.isDirectory() &&
    !metadata.isSymbolicLink() &&
    ownedByCurrentUser(metadata.uid) &&
    (metadata.mode & 0o777) === 0o700
  );
};

const recordIsPrivate = (path: string): boolean => {
  const metadata = lstatSync(path);
  return (
    metadata.isFile() &&
    !metadata.isSymbolicLink() &&
    metadata.size <= MAX_RECORD_BYTES &&
    ownedByCurrentUser(metadata.uid) &&
    (metadata.mode & 0o777) === 0o600
  );
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasErrorCode(error) && error.code === "EPERM";
  }
};

const linuxProcessStartIdentity = (pid: number): ProcessStartIdentityRead => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat
      .slice(stat.lastIndexOf(")") + 1)
      .trim()
      .split(/\s+/);
    if (fields[0] === "Z") return { status: "gone" };
    const startTime = fields[19];
    return startTime && /^\d+$/.test(startTime)
      ? { status: "found", value: `linux:${startTime}` }
      : { status: "unavailable" };
  } catch (error) {
    return hasErrorCode(error) && error.code === "ENOENT"
      ? { status: "gone" }
      : { status: "unavailable" };
  }
};

const portableProcessStartIdentity = (pid: number): ProcessStartIdentityRead => {
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart=", "-o", "stat="], {
    encoding: "utf8",
    env: { ...process.env, LANG: "C", LC_ALL: "C" },
  });
  if (result.status !== 0) {
    return processExists(pid) ? { status: "unavailable" } : { status: "gone" };
  }
  const fields = result.stdout.trim().split(/\s+/);
  const state = fields.pop();
  const value = fields.join(" ");
  if (state?.startsWith("Z")) return { status: "gone" };
  return state && value ? { status: "found", value: `ps:${value}` } : { status: "unavailable" };
};

const processStartIdentity = (pid: number): ProcessStartIdentityRead =>
  process.platform === "linux" ? linuxProcessStartIdentity(pid) : portableProcessStartIdentity(pid);

const currentProcessIdentity = processStartIdentity(process.pid);
const currentProcessStartIdentity =
  currentProcessIdentity.status === "found" ? currentProcessIdentity.value : `pid:${process.pid}`;

const decodeLockMetadata = (value: unknown): LockMetadata | null => {
  try {
    const metadata = Schema.decodeUnknownSync(LockMetadataSchema)(value);
    return /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(metadata.token) &&
      metadata.startIdentity.length > 0 &&
      metadata.startIdentity.length <= 256 &&
      Number.isSafeInteger(metadata.pid) &&
      Number.isSafeInteger(metadata.createdAtMs)
      ? metadata
      : null;
  } catch {
    return null;
  }
};

const lockMetadataIsCurrent = (metadata: LockMetadata): boolean => {
  if (!processExists(metadata.pid)) return false;
  const identity = processStartIdentity(metadata.pid);
  if (identity.status === "gone") return false;
  if (identity.status === "unavailable") return true;
  return (
    identity.value === metadata.startIdentity || metadata.startIdentity === `pid:${metadata.pid}`
  );
};

const dockerExecutableIsValid = (value: string): boolean =>
  value.length <= 4_096 && !value.includes("\0") && isAbsolute(value) && normalize(value) === value;

const dockerEnvironmentIsValid = (environment: DockerBindingEnvironment): boolean =>
  DOCKER_BINDING_ENVIRONMENT_KEYS.every((key) => {
    const value = environment[key];
    return value === null || (value.length <= 4_096 && !value.includes("\0"));
  });

const decodeRecord = (value: unknown): ProcessOwnershipRecord | null => {
  try {
    const record = Schema.decodeUnknownSync(ProcessOwnershipRecordSchema)(value);
    if (
      record.port > 65_535 ||
      !Number.isSafeInteger(record.createdAtMs) ||
      !record.launchId.trim() ||
      record.launchId.length > 128 ||
      !/^[a-f\d]{64}$/i.test(record.commandFingerprint) ||
      !record.recipeId.trim() ||
      record.recipeId.length > 4_096 ||
      (record.runtimeKind === "docker" &&
        (record.dockerAuthority === undefined ||
          record.dockerDaemonFingerprint === undefined ||
          !/^[a-f\d]{64}$/i.test(record.dockerDaemonFingerprint) ||
          record.dockerExecutable === undefined ||
          !dockerExecutableIsValid(record.dockerExecutable) ||
          record.dockerEnvironment === undefined ||
          !dockerEnvironmentIsValid(record.dockerEnvironment))) ||
      (record.runtimeKind === "native" &&
        (record.dockerAuthority !== undefined ||
          record.dockerDaemonFingerprint !== undefined ||
          record.dockerExecutable !== undefined ||
          record.dockerEnvironment !== undefined)) ||
      (record.state === "spawned" && record.rootPid !== record.processGroupId) ||
      (record.state === "active" &&
        (record.rootPid !== record.processGroupId ||
          !record.startIdentity.trim() ||
          record.startIdentity.length > 128))
    ) {
      return null;
    }
    return record;
  } catch {
    return null;
  }
};

const removeIfPresent = (path: string): void => {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!hasErrorCode(error) || error.code !== "ENOENT") throw error;
  }
};

const syncDirectory = (path: string): void => {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

const generationsMatch = (left: ProcessOwnershipRecord, right: ProcessOwnershipRecord): boolean =>
  left.launchId === right.launchId &&
  left.createdAtMs === right.createdAtMs &&
  left.recipeId === right.recipeId &&
  left.backend === right.backend &&
  left.port === right.port &&
  left.runtimeKind === right.runtimeKind &&
  left.commandFingerprint === right.commandFingerprint &&
  left.dockerAuthority === right.dockerAuthority &&
  left.dockerDaemonFingerprint === right.dockerDaemonFingerprint &&
  left.dockerExecutable === right.dockerExecutable &&
  DOCKER_BINDING_ENVIRONMENT_KEYS.every(
    (key) => left.dockerEnvironment?.[key] === right.dockerEnvironment?.[key],
  );

const recordsMatch = (left: ProcessOwnershipRecord, right: ProcessOwnershipRecord): boolean => {
  if (!generationsMatch(left, right) || left.state !== right.state) return false;
  if (left.state === "pending" || right.state === "pending") return true;
  if (left.rootPid !== right.rootPid || left.processGroupId !== right.processGroupId) return false;
  return left.state === "spawned" || right.state === "spawned"
    ? true
    : left.startIdentity === right.startIdentity;
};

const encodedRecord = (record: ProcessOwnershipRecord): string => {
  if (!decodeRecord(record)) throw new Error("Process ownership record is invalid");
  const encoded = JSON.stringify(record);
  if (Buffer.byteLength(encoded) > MAX_RECORD_BYTES) {
    throw new Error("Process ownership record exceeds the storage boundary");
  }
  return encoded;
};

const processOwnershipStagePath = (
  directory: string,
  record: ProcessOwnershipRecord,
  stage: "active" | "spawned",
): string => {
  const generation = createHash("sha256")
    .update(`${record.launchId}:${record.createdAtMs}`)
    .digest("hex");
  return join(directory, `.inference-owner-${generation}.${stage}`);
};

const lockOwnerPath = (directory: string): string => join(directory, "owner.json");
const lockReclaimPath = (directory: string): string => join(directory, "reclaim.json");

const createExactGenerationScope = (
  initial: ProcessOwnershipRecord,
  activate: (
    record: PendingProcessOwnershipRecord | SpawnedProcessOwnershipRecord,
    identity: Pick<ActiveProcessOwnershipRecord, "rootPid" | "processGroupId" | "startIdentity">,
  ) => ActiveProcessOwnershipRecord,
  read: () => ProcessOwnershipRead,
  remove: (record: ProcessOwnershipRecord) => boolean,
): ProcessOwnershipScope => {
  let current = initial;
  return {
    get record(): ProcessOwnershipRecord {
      return current;
    },
    activate: (identity): ActiveProcessOwnershipRecord => {
      if (current.state === "active") {
        if (
          current.rootPid !== identity.rootPid ||
          current.processGroupId !== identity.processGroupId ||
          current.startIdentity !== identity.startIdentity
        ) {
          throw new Error("Active process ownership identity changed");
        }
        return current;
      }
      current = activate(current, identity);
      return current;
    },
    read,
    remove: () => remove(current),
  };
};

export const createProcessOwnershipStore = (
  dataDirectory: string,
  lockTiming: ProcessOwnershipLockTiming = {},
): ProcessOwnershipStore => {
  const directory = ownershipDirectory(dataDirectory);
  const timing = resolveLockTiming(lockTiming);
  const path = processOwnershipRecordPath(dataDirectory);
  const lockDirectory = join(directory, ".inference-owner.lock");
  const stagePath = processOwnershipStagePath.bind(null, directory);
  const ensureDirectory = (): void => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!directoryIsPrivate(directory)) {
      const metadata = lstatSync(directory);
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        !ownedByCurrentUser(metadata.uid)
      ) {
        throw new Error("Process ownership directory is not trustworthy");
      }
      chmodSync(directory, 0o700);
    }
    if (!directoryIsPrivate(directory)) {
      throw new Error("Process ownership directory is not private");
    }
  };
  const readRecord = (recordPath: string): ProcessOwnershipRead => {
    try {
      if (!recordIsPrivate(recordPath)) {
        return { status: "invalid", reason: "ownership record is not private" };
      }
      const parsed: unknown = JSON.parse(readFileSync(recordPath, "utf8"));
      const record = decodeRecord(parsed);
      return record
        ? { status: "found", record }
        : { status: "invalid", reason: "ownership record is malformed" };
    } catch (error) {
      if (hasErrorCode(error) && error.code === "ENOENT") return { status: "missing" };
      return { status: "invalid", reason: "ownership record cannot be read" };
    }
  };
  const read = (): ProcessOwnershipRead => {
    try {
      if (!directoryIsPrivate(directory)) {
        return { status: "invalid", reason: "ownership directory is not private" };
      }
    } catch (error) {
      if (hasErrorCode(error) && error.code === "ENOENT") return { status: "missing" };
      return { status: "invalid", reason: "ownership directory cannot be read" };
    }
    const pending = readRecord(path);
    if (pending.status !== "found") return pending;
    if (pending.record.state !== "pending") {
      return { status: "invalid", reason: "ownership pending record is malformed" };
    }
    const active = readRecord(stagePath(pending.record, "active"));
    if (active.status === "missing") {
      const spawned = readRecord(stagePath(pending.record, "spawned"));
      if (spawned.status === "missing") return pending;
      if (
        spawned.status !== "found" ||
        spawned.record.state !== "spawned" ||
        !generationsMatch(spawned.record, pending.record)
      ) {
        return { status: "invalid", reason: "ownership spawned record is malformed" };
      }
      return spawned;
    }
    if (
      active.status !== "found" ||
      active.record.state !== "active" ||
      !generationsMatch(active.record, pending.record)
    ) {
      return { status: "invalid", reason: "ownership active record is malformed" };
    }
    return active;
  };
  const writeExclusive = (targetPath: string, record: ProcessOwnershipRecord): void => {
    const encoded = encodedRecord(record);
    ensureDirectory();
    const temporaryPath = join(directory, `.inference-owner-${randomUUID()}.tmp`);
    let descriptor: number | null = null;
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      chmodSync(temporaryPath, 0o600);
      writeFileSync(descriptor, encoded);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      linkSync(temporaryPath, targetPath);
      syncDirectory(directory);
    } finally {
      if (descriptor !== null) closeSync(descriptor);
      removeIfPresent(temporaryPath);
    }
  };
  type LockRead =
    | { readonly status: "found"; readonly metadata: LockMetadata; readonly snapshot: string }
    | { readonly status: "invalid"; readonly snapshot: string }
    | { readonly status: "missing"; readonly snapshot: "missing" };
  const readLock = (lockPath: string): LockRead => {
    let descriptor: number | null = null;
    try {
      descriptor = openSync(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const metadata = fstatSync(descriptor);
      const snapshot = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`;
      if (
        !metadata.isFile() ||
        !ownedByCurrentUser(metadata.uid) ||
        (metadata.mode & 0o777) !== 0o600 ||
        metadata.size > MAX_RECORD_BYTES
      ) {
        return { status: "invalid", snapshot };
      }
      const decoded = decodeLockMetadata(JSON.parse(readFileSync(descriptor, "utf8")));
      return decoded
        ? { status: "found", metadata: decoded, snapshot }
        : { status: "invalid", snapshot };
    } catch (error) {
      return hasErrorCode(error) && error.code === "ENOENT"
        ? { status: "missing", snapshot: "missing" }
        : { status: "invalid", snapshot: "unreadable" };
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
  };
  const writeLock = (targetPath: string, metadata: LockMetadata): void => {
    const descriptor = openSync(targetPath, "wx", 0o600);
    try {
      fchmodSync(descriptor, 0o600);
      writeFileSync(descriptor, JSON.stringify(metadata));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  };
  const lockMetadata = (): LockMetadata => ({
    version: 1,
    token: randomUUID(),
    pid: process.pid,
    startIdentity: currentProcessStartIdentity,
    createdAtMs: Date.now(),
  });
  const lockAge = (): number => {
    try {
      return Date.now() - lstatSync(lockDirectory).mtimeMs;
    } catch {
      return 0;
    }
  };
  const lockReadIsStale = (lock: LockRead): boolean =>
    lock.status === "found"
      ? !lockMetadataIsCurrent(lock.metadata)
      : lockAge() >= timing.invalidOwnerGraceMs;
  const lockReadsMatch = (left: LockRead, right: LockRead): boolean =>
    left.status === right.status && left.snapshot === right.snapshot;
  const clearMovedLock = (movedDirectory: string): void => {
    removeIfPresent(lockOwnerPath(movedDirectory));
    removeIfPresent(lockReclaimPath(movedDirectory));
    rmdirSync(movedDirectory);
  };
  const recoverStaleLock = (): boolean => {
    if (!directoryIsPrivate(lockDirectory)) {
      throw new Error("Process ownership lock is not trustworthy");
    }
    const observedOwner = readLock(lockOwnerPath(lockDirectory));
    if (!lockReadIsStale(observedOwner)) return false;
    let observedReclaim = readLock(lockReclaimPath(lockDirectory));
    if (observedReclaim.status === "missing") {
      try {
        writeLock(lockReclaimPath(lockDirectory), lockMetadata());
        syncDirectory(lockDirectory);
      } catch (error) {
        if (!hasErrorCode(error) || error.code !== "EEXIST") throw error;
      }
      observedReclaim = readLock(lockReclaimPath(lockDirectory));
    }
    if (!lockReadIsStale(observedReclaim)) {
      if (
        observedReclaim.status !== "found" ||
        observedReclaim.metadata.pid !== process.pid ||
        observedReclaim.metadata.startIdentity !== currentProcessStartIdentity
      ) {
        return false;
      }
    }
    const confirmedOwner = readLock(lockOwnerPath(lockDirectory));
    const confirmedReclaim = readLock(lockReclaimPath(lockDirectory));
    if (
      !lockReadsMatch(observedOwner, confirmedOwner) ||
      !lockReadsMatch(observedReclaim, confirmedReclaim)
    ) {
      return false;
    }
    const movedDirectory = join(directory, `.inference-owner-lock-stale-${randomUUID()}`);
    try {
      renameSync(lockDirectory, movedDirectory);
    } catch (error) {
      if (hasErrorCode(error) && error.code === "ENOENT") return false;
      throw error;
    }
    syncDirectory(directory);
    clearMovedLock(movedDirectory);
    return true;
  };
  const acquireLockOnce = (): LockHandle | null => {
    ensureDirectory();
    const metadata = lockMetadata();
    try {
      mkdirSync(lockDirectory, { mode: 0o700 });
    } catch (error) {
      if (!hasErrorCode(error) || error.code !== "EEXIST") throw error;
      recoverStaleLock();
      return null;
    }
    try {
      if (!directoryIsPrivate(lockDirectory)) {
        throw new Error("Process ownership lock is not private");
      }
      writeLock(lockOwnerPath(lockDirectory), metadata);
      syncDirectory(lockDirectory);
      syncDirectory(directory);
      return { directory: lockDirectory, metadata };
    } catch (error) {
      removeIfPresent(lockOwnerPath(lockDirectory));
      rmdirSync(lockDirectory);
      throw error;
    }
  };
  const acquireLockSync = (): LockHandle | null => acquireLockOnce() ?? acquireLockOnce();
  const acquireLockEffect = (): Effect.Effect<LockHandle, Error> =>
    Effect.gen(function* () {
      const deadline = Date.now() + timing.acquireTimeoutMs;
      while (true) {
        const handle = acquireLockOnce();
        if (handle) return handle;
        if (Date.now() >= deadline) {
          return yield* Effect.fail(new Error("Process ownership lock acquisition timed out"));
        }
        yield* Effect.sleep(timing.retryIntervalMs);
      }
    });
  const releaseLock = (handle: LockHandle): void => {
    if (!directoryIsPrivate(handle.directory)) {
      throw new Error("Process ownership lock changed before release");
    }
    const owner = readLock(lockOwnerPath(handle.directory));
    if (
      owner.status !== "found" ||
      owner.metadata.token !== handle.metadata.token ||
      owner.metadata.pid !== handle.metadata.pid ||
      owner.metadata.startIdentity !== handle.metadata.startIdentity
    ) {
      throw new Error("Process ownership lock owner changed before release");
    }
    const movedDirectory = join(
      directory,
      `.inference-owner-lock-release-${handle.metadata.token}`,
    );
    renameSync(handle.directory, movedDirectory);
    syncDirectory(directory);
    clearMovedLock(movedDirectory);
  };
  const createUnlocked = (record: PendingProcessOwnershipRecord): void => {
    const current = read();
    if (current.status !== "missing") {
      throw new Error("A process ownership record already exists");
    }
    writeExclusive(path, record);
  };
  const create = (record: PendingProcessOwnershipRecord): void => {
    const lock = acquireLockSync();
    if (!lock) throw new Error("Process ownership generation is busy");
    try {
      createUnlocked(record);
    } finally {
      releaseLock(lock);
    }
  };
  const markSpawnedUnlocked = (
    pending: PendingProcessOwnershipRecord,
    identity: Pick<SpawnedProcessOwnershipRecord, "rootPid" | "processGroupId">,
  ): SpawnedProcessOwnershipRecord | ActiveProcessOwnershipRecord => {
    const spawned = {
      ...pending,
      ...identity,
      state: "spawned",
    } satisfies SpawnedProcessOwnershipRecord;
    const current = read();
    if (
      current.status === "found" &&
      current.record.state === "active" &&
      generationsMatch(current.record, spawned) &&
      current.record.rootPid === spawned.rootPid &&
      current.record.processGroupId === spawned.processGroupId
    ) {
      return current.record;
    }
    if (current.status === "found" && current.record.state === "spawned") {
      if (recordsMatch(current.record, spawned)) return current.record;
      throw new Error("Process ownership generation changed");
    }
    if (current.status !== "found" || !recordsMatch(current.record, pending)) {
      throw new Error("Process ownership generation changed");
    }
    try {
      writeExclusive(stagePath(pending, "spawned"), spawned);
    } catch (error) {
      const persisted = read();
      if (
        persisted.status === "found" &&
        persisted.record.state === "spawned" &&
        recordsMatch(persisted.record, spawned)
      ) {
        return persisted.record;
      }
      throw error;
    }
    return spawned;
  };
  const markSpawned = (
    pending: PendingProcessOwnershipRecord,
    identity: Pick<SpawnedProcessOwnershipRecord, "rootPid" | "processGroupId">,
  ): SpawnedProcessOwnershipRecord | ActiveProcessOwnershipRecord => {
    const lock = acquireLockSync();
    if (!lock) throw new Error("Process ownership generation is busy");
    try {
      return markSpawnedUnlocked(pending, identity);
    } finally {
      releaseLock(lock);
    }
  };
  const activateUnlocked = (
    pending: PendingProcessOwnershipRecord | SpawnedProcessOwnershipRecord,
    identity: Pick<ActiveProcessOwnershipRecord, "rootPid" | "processGroupId" | "startIdentity">,
  ): ActiveProcessOwnershipRecord => {
    const active = {
      ...pending,
      ...identity,
      state: "active",
    } satisfies ActiveProcessOwnershipRecord;
    const current = read();
    if (current.status === "found" && current.record.state === "active") {
      if (recordsMatch(current.record, active)) return current.record;
      throw new Error("Process ownership generation changed");
    }
    if (current.status !== "found" || !recordsMatch(current.record, pending)) {
      throw new Error("Process ownership generation changed");
    }
    if (
      pending.state === "spawned" &&
      (pending.rootPid !== identity.rootPid || pending.processGroupId !== identity.processGroupId)
    ) {
      throw new Error("Spawned process identity changed");
    }
    try {
      writeExclusive(stagePath(pending, "active"), active);
    } catch (error) {
      const activated = read();
      if (
        activated.status === "found" &&
        activated.record.state === "active" &&
        recordsMatch(activated.record, active)
      ) {
        return activated.record;
      }
      throw error;
    }
    const persistedPending = readRecord(path);
    if (
      persistedPending.status !== "found" ||
      persistedPending.record.state !== "pending" ||
      !generationsMatch(persistedPending.record, pending)
    ) {
      throw new Error("Process ownership generation changed");
    }
    return active;
  };
  const activate = (
    pending: PendingProcessOwnershipRecord | SpawnedProcessOwnershipRecord,
    identity: Pick<ActiveProcessOwnershipRecord, "rootPid" | "processGroupId" | "startIdentity">,
  ): ActiveProcessOwnershipRecord => {
    const lock = acquireLockSync();
    if (!lock) throw new Error("Process ownership generation is busy");
    try {
      return activateUnlocked(pending, identity);
    } finally {
      releaseLock(lock);
    }
  };
  const removeUnlocked = (record: ProcessOwnershipRecord): boolean => {
    const current = read();
    if (current.status === "missing") return true;
    if (current.status !== "found" || !recordsMatch(current.record, record)) return false;
    if (current.record.state === "active") {
      removeIfPresent(stagePath(current.record, "active"));
      removeIfPresent(stagePath(current.record, "spawned"));
    }
    if (current.record.state === "spawned") {
      removeIfPresent(stagePath(current.record, "spawned"));
    }
    const persistedPending = readRecord(path);
    if (
      persistedPending.status !== "found" ||
      persistedPending.record.state !== "pending" ||
      !generationsMatch(persistedPending.record, record)
    ) {
      return false;
    }
    removeIfPresent(path);
    syncDirectory(directory);
    return true;
  };
  const beginLaunch = (record: PendingProcessOwnershipRecord): ProcessOwnershipLaunch => {
    const lock = acquireLockSync();
    if (!lock) throw new Error("Process ownership generation is busy");
    try {
      createUnlocked(record);
    } catch (error) {
      releaseLock(lock);
      throw error;
    }
    let current: ProcessOwnershipRecord = record;
    let released = false;
    const ensureHeld = (): void => {
      if (released) throw new Error("Process ownership launch scope is closed");
    };
    const release = (): void => {
      ensureHeld();
      releaseLock(lock);
      released = true;
    };
    const removeLaunch = (): boolean => {
      ensureHeld();
      const removed = removeUnlocked(current);
      release();
      return removed;
    };
    return {
      markSpawned: (identity): SpawnedProcessOwnershipRecord | ActiveProcessOwnershipRecord => {
        ensureHeld();
        if (current.state !== "pending") {
          throw new Error("Process ownership launch is not pending");
        }
        current = markSpawnedUnlocked(current, identity);
        return current;
      },
      activate: (identity): ActiveProcessOwnershipRecord => {
        ensureHeld();
        if (current.state === "active") return current;
        current = activateUnlocked(current, identity);
        return current;
      },
      remove: removeLaunch,
      release,
    };
  };
  const remove = (record: ProcessOwnershipRecord): boolean => {
    const lock = acquireLockSync();
    if (!lock) return false;
    try {
      return removeUnlocked(record);
    } finally {
      releaseLock(lock);
    }
  };
  const withExactGeneration = <Value, Failure, Requirements>(
    record: ProcessOwnershipRecord,
    use: (scope: ProcessOwnershipScope) => Effect.Effect<Value, Failure, Requirements>,
  ): Effect.Effect<ExactGenerationResult<Value>, Failure | Error, Requirements> =>
    Effect.acquireUseRelease(
      acquireLockEffect(),
      (_lock) =>
        Effect.gen(function* () {
          const current = read();
          if (current.status !== "found" || !recordsMatch(current.record, record)) {
            return { status: "changed" } as ExactGenerationResult<Value>;
          }
          const scope = createExactGenerationScope(
            current.record,
            activateUnlocked,
            read,
            removeUnlocked,
          );
          const value = yield* use(scope);
          return { status: "acquired", value } as ExactGenerationResult<Value>;
        }),
      (lock) => Effect.sync(() => releaseLock(lock)),
    );
  return {
    path,
    beginLaunch,
    create,
    markSpawned,
    activate,
    read,
    remove,
    withExactGeneration,
  };
};

export const inspectOwnedProcessGroup = (
  record: ActiveProcessOwnershipRecord,
  inventory: readonly ProcessInventoryEntry[],
  processLaunchId: (pid: number) => string | null,
): OwnedProcessGroupState => {
  const leader = inventory.find((entry) => entry.pid === record.rootPid);
  if (
    leader &&
    (leader.processGroupId !== record.processGroupId ||
      leader.startIdentity !== record.startIdentity)
  ) {
    return { status: "identity-mismatch" };
  }
  const members = inventory.filter(
    (entry) => entry.processGroupId === record.processGroupId && !entry.stat.includes("Z"),
  );
  if (members.length === 0) return { status: "gone" };
  if (leader && !leader.stat.includes("Z")) {
    return processLaunchId(leader.pid) === record.launchId
      ? { status: "owned", members }
      : { status: "identity-mismatch" };
  }
  return members.every((entry) => processLaunchId(entry.pid) === record.launchId)
    ? { status: "owned", members }
    : { status: "identity-mismatch" };
};
