import { randomUUID } from "node:crypto";
import { chmod, link, mkdir, readFile, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema, Semaphore } from "effect";
import { getExtraArgument } from "../engines/argument-utilities";
import type { GpuInfo, Recipe } from "../models/types";

const fullNvidiaUuid =
  /^GPU-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const directVisibilityKeys = [
  "visible_devices",
  "VISIBLE_DEVICES",
  "CUDA_VISIBLE_DEVICES",
  "cuda_visible_devices",
  "cuda-visible-devices",
] as const;

export type GpuLeaseOwner = "llm" | "speech";

export interface GpuLease {
  readonly uuid: string;
  readonly owner: GpuLeaseOwner;
}

export interface GpuVisibilityResolution {
  readonly source: "all" | "recipe";
  readonly selector: string | null;
  readonly uuids: readonly string[];
  readonly unresolvedTokens: readonly string[];
}

export interface GpuLeaseConflictEntry {
  readonly uuid: string;
  readonly heldBy: GpuLeaseOwner;
}

export class GpuLeaseConflict extends Error {
  readonly _tag = "GpuLeaseConflict";

  constructor(
    readonly requestedBy: GpuLeaseOwner,
    readonly conflicts: readonly GpuLeaseConflictEntry[],
  ) {
    super(
      `GPU lease conflict for ${requestedBy}: ${conflicts
        .map(({ uuid, heldBy }) => `${uuid} held by ${heldBy}`)
        .join(", ")}`,
    );
    this.name = "GpuLeaseConflict";
  }
}

export class InvalidGpuLeaseUuid extends Error {
  readonly _tag = "InvalidGpuLeaseUuid";

  constructor(readonly invalidUuids: readonly string[]) {
    super(`GPU leases require full NVIDIA UUIDs: ${invalidUuids.join(", ")}`);
    this.name = "InvalidGpuLeaseUuid";
  }
}

export class GpuLeaseLockFailure extends Error {
  readonly _tag = "GpuLeaseLockFailure";

  constructor(
    readonly operation: "acquire" | "release",
    cause: unknown,
  ) {
    super(`Unable to ${operation} the host GPU lease`, { cause });
    this.name = "GpuLeaseLockFailure";
  }
}

export interface GpuLeaseRegistryOptions {
  readonly lockDirectory?: string;
}

type GpuLeaseError = GpuLeaseConflict | GpuLeaseLockFailure | InvalidGpuLeaseUuid;

export interface GpuLeaseRegistry {
  readonly claim: (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ) => Effect.Effect<readonly GpuLease[], GpuLeaseError>;
  readonly replace: (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ) => Effect.Effect<readonly GpuLease[], GpuLeaseError>;
  readonly release: (
    owner: GpuLeaseOwner,
    uuids?: readonly string[],
  ) => Effect.Effect<readonly GpuLease[], GpuLeaseLockFailure | InvalidGpuLeaseUuid>;
  readonly snapshot: () => Effect.Effect<readonly GpuLease[]>;
}

const HostGpuLeaseRecordSchema = Schema.Struct({
  version: Schema.Literal(1),
  uuid: Schema.String,
  owner: Schema.Literals(["llm", "speech"]),
  pid: Schema.Number,
  processStartToken: Schema.Union([Schema.String, Schema.Null]),
  registryId: Schema.String,
});

interface HostGpuLeaseRecord {
  readonly version: 1;
  readonly uuid: string;
  readonly owner: GpuLeaseOwner;
  readonly pid: number;
  readonly processStartToken: string | null;
  readonly registryId: string;
}

type HostLockRead =
  | { readonly status: "found"; readonly record: HostGpuLeaseRecord }
  | { readonly status: "invalid" }
  | { readonly status: "missing" };

type HostLockClaim =
  | { readonly status: "acquired" }
  | { readonly status: "owned" }
  | { readonly status: "conflict"; readonly heldBy: GpuLeaseOwner };

interface HostGpuLockStore {
  readonly acquire: (uuid: string, owner: GpuLeaseOwner) => Promise<HostLockClaim>;
  readonly release: (uuid: string) => Promise<void>;
}

type LinuxProcessStart =
  | { readonly status: "found"; readonly token: string }
  | { readonly status: "missing" }
  | { readonly status: "unknown" };

const hostLockAttempts = 128;
const staleReaperAgeMs = 5_000;

function hasErrorCode(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}

function linuxStartToken(stat: string): string | null {
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 0) return null;
  const token = stat
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/)[19];
  return token && /^\d+$/.test(token) ? token : null;
}

async function readLinuxProcessStart(pid: number): Promise<LinuxProcessStart> {
  try {
    const token = linuxStartToken(await readFile(`/proc/${pid}/stat`, "utf8"));
    return token ? { status: "found", token } : { status: "unknown" };
  } catch (error) {
    return hasErrorCode(error) && error.code === "ENOENT"
      ? { status: "missing" }
      : { status: "unknown" };
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error) || error.code !== "ESRCH";
  }
}

async function hostRecordIsLive(record: HostGpuLeaseRecord): Promise<boolean> {
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0) return false;
  if (process.platform !== "linux") return processIsAlive(record.pid);
  if (record.processStartToken === null) return false;
  const current = await readLinuxProcessStart(record.pid);
  if (current.status === "missing") return false;
  return current.status === "unknown" || current.token === record.processStartToken;
}

async function currentProcessStartToken(): Promise<string | null> {
  if (process.platform !== "linux") return null;
  const current = await readLinuxProcessStart(process.pid);
  if (current.status !== "found") throw new Error("Unable to read the controller process identity");
  return current.token;
}

function validHostRecord(value: unknown): HostGpuLeaseRecord | null {
  try {
    const record = Schema.decodeUnknownSync(HostGpuLeaseRecordSchema)(value);
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0 || !record.registryId) return null;
    if (!fullNvidiaUuid.test(record.uuid)) return null;
    return record;
  } catch {
    return null;
  }
}

async function readHostLock(path: string): Promise<HostLockRead> {
  try {
    const record = validHostRecord(JSON.parse(await readFile(path, "utf8")));
    return record ? { status: "found", record } : { status: "invalid" };
  } catch (error) {
    if (hasErrorCode(error) && error.code === "ENOENT") return { status: "missing" };
    if (error instanceof SyntaxError) return { status: "invalid" };
    throw error;
  }
}

async function removeIfPresent(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (!hasErrorCode(error) || error.code !== "ENOENT") throw error;
  });
}

async function releaseReaper(path: string): Promise<void> {
  await rmdir(path).catch((error: unknown) => {
    if (!hasErrorCode(error) || error.code !== "ENOENT") throw error;
  });
}

async function staleReaper(path: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(path)).mtimeMs >= staleReaperAgeMs;
  } catch (error) {
    if (hasErrorCode(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function reclaimStaleHostLock(path: string): Promise<void> {
  const reaperPath = `${path}.reaper`;
  try {
    await mkdir(reaperPath, { mode: 0o700 });
  } catch (error) {
    if (hasErrorCode(error) && error.code === "EEXIST") {
      if (await staleReaper(reaperPath)) await releaseReaper(reaperPath);
      else await Effect.runPromise(Effect.sleep(5));
      return;
    }
    throw error;
  }
  try {
    const current = await readHostLock(path);
    if (current.status === "invalid") throw new Error("Host GPU lease record is invalid");
    if (current.status === "found" && !(await hostRecordIsLive(current.record))) {
      await removeIfPresent(path);
    }
  } finally {
    await releaseReaper(reaperPath);
  }
}

function hostLockPath(directory: string, uuid: string): string {
  return join(directory, `${uuid.toLowerCase()}.lock`);
}

function createHostGpuLockStore(directory: string): HostGpuLockStore {
  const registryId = randomUUID();
  const processStartToken = currentProcessStartToken();
  const ensureDirectory = async (): Promise<void> => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
  };
  const acquire = async (uuid: string, owner: GpuLeaseOwner): Promise<HostLockClaim> => {
    await ensureDirectory();
    const path = hostLockPath(directory, uuid);
    const temporaryPath = join(directory, `.${registryId}-${randomUUID()}.lock`);
    const record = {
      version: 1,
      uuid,
      owner,
      pid: process.pid,
      processStartToken: await processStartToken,
      registryId,
    } satisfies HostGpuLeaseRecord;
    await writeFile(temporaryPath, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    try {
      for (let attempt = 0; attempt < hostLockAttempts; attempt += 1) {
        try {
          await link(temporaryPath, path);
          return { status: "acquired" };
        } catch (error) {
          if (!hasErrorCode(error) || error.code !== "EEXIST") throw error;
        }
        const current = await readHostLock(path);
        if (current.status === "missing") continue;
        if (current.status === "found") {
          if (current.record.registryId === registryId) {
            return current.record.owner === owner
              ? { status: "owned" }
              : { status: "conflict", heldBy: current.record.owner };
          }
          if (await hostRecordIsLive(current.record)) {
            return { status: "conflict", heldBy: current.record.owner };
          }
        }
        await reclaimStaleHostLock(path);
      }
      throw new Error(`Unable to settle host GPU lease ${uuid}`);
    } finally {
      await removeIfPresent(temporaryPath);
    }
  };
  const release = async (uuid: string): Promise<void> => {
    const path = hostLockPath(directory, uuid);
    const current = await readHostLock(path);
    if (current.status === "found" && current.record.registryId === registryId) {
      await removeIfPresent(path);
    }
  };
  return { acquire, release };
}

export function perUserGpuLeaseLockDirectory(): string {
  const user = typeof process.getuid === "function" ? process.getuid() : "user";
  return join(tmpdir(), `local-studio-${user}`, "gpu-leases");
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function directVisibilitySelector(recipe: Recipe): string | null {
  for (const key of directVisibilityKeys) {
    const value = getExtraArgument(recipe.extra_args, key);
    if (value === undefined || value === null) continue;
    return value === false ? null : String(value);
  }
  return null;
}

function environmentVisibilitySelector(recipe: Recipe): string | null {
  let selector = recipe.env_vars?.["CUDA_VISIBLE_DEVICES"] ?? null;
  const extraEnvironment =
    getExtraArgument(recipe.extra_args, "env_vars") ?? recipe.extra_args["envVars"];
  if (!isUnknownRecord(extraEnvironment)) return selector;
  const value = extraEnvironment["CUDA_VISIBLE_DEVICES"];
  if (value !== undefined && value !== null) selector = String(value);
  return selector;
}

function recipeVisibilitySelector(recipe: Recipe): string | null {
  return directVisibilitySelector(recipe) ?? environmentVisibilitySelector(recipe);
}

function canonicalNvidiaUuid(uuid: string): string {
  return `GPU-${uuid.slice(4).toLowerCase()}`;
}

function leaseableUuid(gpu: GpuInfo): string | null {
  const uuid = gpu.uuid?.trim();
  return uuid && fullNvidiaUuid.test(uuid) ? canonicalNvidiaUuid(uuid) : null;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

export function resolveRecipeGpuUuids(
  recipe: Recipe,
  gpus: readonly GpuInfo[],
): GpuVisibilityResolution {
  const byIndex = new Map<number, string>();
  const byUuid = new Map<string, string>();
  const allUuids: string[] = [];
  for (const gpu of gpus) {
    const uuid = leaseableUuid(gpu);
    if (!uuid) continue;
    if (!byIndex.has(gpu.index)) byIndex.set(gpu.index, uuid);
    byUuid.set(uuid.toLowerCase(), uuid);
    appendUnique(allUuids, uuid);
  }

  const selector = recipeVisibilitySelector(recipe);
  if (selector === null) {
    return { source: "all", selector, uuids: allUuids, unresolvedTokens: [] };
  }

  const uuids: string[] = [];
  const unresolvedTokens: string[] = [];
  const tokens = selector
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const uuid = /^\d+$/.test(token) ? byIndex.get(Number(token)) : byUuid.get(token.toLowerCase());
    if (uuid) appendUnique(uuids, uuid);
    else appendUnique(unresolvedTokens, token);
  }
  return { source: "recipe", selector, uuids, unresolvedTokens };
}

function uniqueUuids(uuids: readonly string[]): string[] {
  return [...new Set(uuids)];
}

function invalidUuidRequest(uuids: readonly string[]): InvalidGpuLeaseUuid | null {
  const invalidUuids = uniqueUuids(uuids).filter((uuid) => !fullNvidiaUuid.test(uuid));
  return invalidUuids.length > 0 ? new InvalidGpuLeaseUuid(invalidUuids) : null;
}

function leaseSnapshot(leases: ReadonlyMap<string, GpuLeaseOwner>): readonly GpuLease[] {
  return [...leases]
    .map(([uuid, owner]) => ({ uuid, owner }))
    .sort((left, right) => left.uuid.localeCompare(right.uuid));
}

function conflictingLeases(
  leases: ReadonlyMap<string, GpuLeaseOwner>,
  owner: GpuLeaseOwner,
  uuids: readonly string[],
): GpuLeaseConflictEntry[] {
  const conflicts: GpuLeaseConflictEntry[] = [];
  for (const uuid of uuids) {
    const heldBy = leases.get(uuid);
    if (heldBy && heldBy !== owner) conflicts.push({ uuid, heldBy });
  }
  return conflicts;
}

function releaseOwnerLeases(
  leases: Map<string, GpuLeaseOwner>,
  owner: GpuLeaseOwner,
  uuids?: readonly string[],
): void {
  for (const [uuid, heldBy] of leases) {
    if (heldBy === owner && (!uuids || uuids.includes(uuid))) leases.delete(uuid);
  }
}

export function createGpuLeaseRegistry(options: GpuLeaseRegistryOptions = {}): GpuLeaseRegistry {
  const leases = new Map<string, GpuLeaseOwner>();
  const semaphore = Semaphore.makeUnsafe(1);
  const hostLocks = options.lockDirectory ? createHostGpuLockStore(options.lockDirectory) : null;
  const acquireHostLeases = async (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ): Promise<readonly GpuLeaseConflictEntry[]> => {
    if (!hostLocks) return [];
    const acquired: string[] = [];
    try {
      for (const uuid of uuids) {
        const result = await hostLocks.acquire(uuid, owner);
        if (result.status !== "conflict") acquired.push(uuid);
        if (result.status === "conflict") {
          await Promise.all(acquired.map((acquiredUuid) => hostLocks.release(acquiredUuid)));
          return [{ uuid, heldBy: result.heldBy }];
        }
      }
      return [];
    } catch (error) {
      await Promise.allSettled(acquired.map((uuid) => hostLocks.release(uuid)));
      throw error;
    }
  };
  const releaseHostLeases = async (uuids: readonly string[]): Promise<void> => {
    if (hostLocks) await Promise.all(uuids.map((uuid) => hostLocks.release(uuid)));
  };
  const hostAcquireEffect = (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ): Effect.Effect<readonly GpuLeaseConflictEntry[], GpuLeaseLockFailure> =>
    Effect.tryPromise({
      try: () => acquireHostLeases(owner, uuids),
      catch: (error) => new GpuLeaseLockFailure("acquire", error),
    });
  const hostReleaseEffect = (uuids: readonly string[]): Effect.Effect<void, GpuLeaseLockFailure> =>
    Effect.tryPromise({
      try: () => releaseHostLeases(uuids),
      catch: (error) => new GpuLeaseLockFailure("release", error),
    });
  const assign = (
    owner: GpuLeaseOwner,
    requestedUuids: readonly string[],
    replace: boolean,
  ): Effect.Effect<readonly GpuLease[], GpuLeaseError> =>
    semaphore.withPermit(
      Effect.gen(function* () {
        const requested = uniqueUuids(requestedUuids);
        const invalid = invalidUuidRequest(requested);
        if (invalid) return yield* Effect.fail(invalid);
        const uuids = uniqueUuids(requested.map(canonicalNvidiaUuid));
        const conflicts = conflictingLeases(leases, owner, uuids);
        if (conflicts.length > 0) return yield* Effect.fail(new GpuLeaseConflict(owner, conflicts));
        const additions = uuids.filter((uuid) => leases.get(uuid) !== owner);
        const hostConflicts = yield* hostAcquireEffect(owner, additions);
        if (hostConflicts.length > 0) {
          return yield* Effect.fail(new GpuLeaseConflict(owner, hostConflicts));
        }
        const removals = replace
          ? [...leases]
              .filter(([uuid, heldBy]) => heldBy === owner && !uuids.includes(uuid))
              .map(([uuid]) => uuid)
          : [];
        yield* hostReleaseEffect(removals).pipe(
          Effect.catch((error) =>
            hostReleaseEffect(additions).pipe(
              Effect.catch(() => Effect.void),
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        );
        if (replace) releaseOwnerLeases(leases, owner);
        for (const uuid of uuids) leases.set(uuid, owner);
        return leaseSnapshot(leases);
      }).pipe(Effect.uninterruptible),
    );
  const release = (
    owner: GpuLeaseOwner,
    requestedUuids?: readonly string[],
  ): Effect.Effect<readonly GpuLease[], GpuLeaseLockFailure | InvalidGpuLeaseUuid> =>
    semaphore.withPermit(
      Effect.gen(function* () {
        const requested = requestedUuids ? uniqueUuids(requestedUuids) : undefined;
        const invalid = requested ? invalidUuidRequest(requested) : null;
        if (invalid) return yield* Effect.fail(invalid);
        const uuids = requested?.map(canonicalNvidiaUuid);
        const released = [...leases]
          .filter(([uuid, heldBy]) => heldBy === owner && (!uuids || uuids.includes(uuid)))
          .map(([uuid]) => uuid);
        yield* hostReleaseEffect(released);
        releaseOwnerLeases(leases, owner, uuids);
        return leaseSnapshot(leases);
      }).pipe(Effect.uninterruptible),
    );
  return {
    claim: (owner, uuids) => assign(owner, uuids, false),
    replace: (owner, uuids) => assign(owner, uuids, true),
    release,
    snapshot: () => semaphore.withPermit(Effect.sync(() => leaseSnapshot(leases))),
  };
}
