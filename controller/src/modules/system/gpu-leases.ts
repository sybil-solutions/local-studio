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
  readonly acquire: (uuid: string, owner: GpuLeaseOwner) => Effect.Effect<HostLockClaim, unknown>;
  readonly release: (uuid: string) => Effect.Effect<void, unknown>;
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

function readLinuxProcessStart(pid: number): Effect.Effect<LinuxProcessStart> {
  return Effect.tryPromise({
    try: () => readFile(`/proc/${pid}/stat`, "utf8"),
    catch: (error) => error,
  }).pipe(
    Effect.map((contents): LinuxProcessStart => {
      const token = linuxStartToken(contents);
      return token ? { status: "found", token } : { status: "unknown" };
    }),
    Effect.catch((error) =>
      Effect.succeed(
        hasErrorCode(error) && error.code === "ENOENT"
          ? ({ status: "missing" } as const)
          : ({ status: "unknown" } as const),
      ),
    ),
  );
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error) || error.code !== "ESRCH";
  }
}

function hostRecordIsLive(record: HostGpuLeaseRecord): Effect.Effect<boolean> {
  if (!Number.isSafeInteger(record.pid) || record.pid <= 0) return Effect.succeed(false);
  if (process.platform !== "linux") return Effect.sync(() => processIsAlive(record.pid));
  if (record.processStartToken === null) return Effect.succeed(false);
  return readLinuxProcessStart(record.pid).pipe(
    Effect.map(
      (current) =>
        current.status !== "missing" &&
        (current.status === "unknown" || current.token === record.processStartToken),
    ),
  );
}

function currentProcessStartToken(): Effect.Effect<string | null, Error> {
  if (process.platform !== "linux") return Effect.succeed(null);
  return readLinuxProcessStart(process.pid).pipe(
    Effect.flatMap((current) =>
      current.status === "found"
        ? Effect.succeed(current.token)
        : Effect.fail(new Error("Unable to read the controller process identity")),
    ),
  );
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

function readHostLock(path: string): Effect.Effect<HostLockRead, unknown> {
  return Effect.tryPromise({ try: () => readFile(path, "utf8"), catch: (error) => error }).pipe(
    Effect.flatMap((contents) =>
      Effect.try({ try: () => JSON.parse(contents) as unknown, catch: (error) => error }),
    ),
    Effect.map((value): HostLockRead => {
      const record = validHostRecord(value);
      return record ? { status: "found", record } : { status: "invalid" };
    }),
    Effect.catch((error): Effect.Effect<HostLockRead, unknown> => {
      if (hasErrorCode(error) && error.code === "ENOENT") {
        return Effect.succeed({ status: "missing" } as const);
      }
      if (error instanceof SyntaxError) return Effect.succeed({ status: "invalid" } as const);
      return Effect.fail(error);
    }),
  );
}

function removeIfPresent(path: string): Effect.Effect<void, unknown> {
  return Effect.tryPromise({ try: () => unlink(path), catch: (error) => error }).pipe(
    Effect.catch((error) =>
      hasErrorCode(error) && error.code === "ENOENT" ? Effect.void : Effect.fail(error),
    ),
  );
}

function releaseReaper(path: string): Effect.Effect<void, unknown> {
  return Effect.tryPromise({ try: () => rmdir(path), catch: (error) => error }).pipe(
    Effect.catch((error) =>
      hasErrorCode(error) && error.code === "ENOENT" ? Effect.void : Effect.fail(error),
    ),
  );
}

function withCleanup<A, E, R, CleanupError, CleanupRequirements>(
  effect: Effect.Effect<A, E, R>,
  cleanup: Effect.Effect<void, CleanupError, CleanupRequirements>,
): Effect.Effect<A, E | CleanupError, R | CleanupRequirements> {
  return Effect.uninterruptibleMask((restore) =>
    Effect.exit(restore(effect)).pipe(
      Effect.flatMap((exit) => cleanup.pipe(Effect.andThen(exit))),
    ),
  );
}

function staleReaper(path: string): Effect.Effect<boolean, unknown> {
  return Effect.tryPromise({ try: () => stat(path), catch: (error) => error }).pipe(
    Effect.map((metadata) => Date.now() - metadata.mtimeMs >= staleReaperAgeMs),
    Effect.catch((error) =>
      hasErrorCode(error) && error.code === "ENOENT" ? Effect.succeed(false) : Effect.fail(error),
    ),
  );
}

function reclaimStaleHostLock(path: string): Effect.Effect<void, unknown> {
  const reaperPath = `${path}.reaper`;
  return Effect.gen(function* () {
    const claimed = yield* Effect.tryPromise({
      try: () => mkdir(reaperPath, { mode: 0o700 }),
      catch: (error) => error,
    }).pipe(
      Effect.as(true),
      Effect.catch((error) =>
        hasErrorCode(error) && error.code === "EEXIST" ? Effect.succeed(false) : Effect.fail(error),
      ),
    );
    if (!claimed) {
      if (yield* staleReaper(reaperPath)) yield* releaseReaper(reaperPath);
      else yield* Effect.sleep(5);
      return;
    }
    yield* withCleanup(
      Effect.gen(function* () {
        const current = yield* readHostLock(path);
        if (current.status === "invalid") {
          return yield* Effect.fail(new Error("Host GPU lease record is invalid"));
        }
        if (current.status === "found" && !(yield* hostRecordIsLive(current.record))) {
          yield* removeIfPresent(path);
        }
      }),
      releaseReaper(reaperPath),
    );
  });
}

function hostLockPath(directory: string, uuid: string): string {
  return join(directory, `${uuid.toLowerCase()}.lock`);
}

function createHostGpuLockStore(directory: string): HostGpuLockStore {
  const registryId = randomUUID();
  const ensureDirectory = Effect.tryPromise({
    try: () => mkdir(directory, { recursive: true, mode: 0o700 }),
    catch: (error) => error,
  }).pipe(
    Effect.andThen(
      Effect.tryPromise({ try: () => chmod(directory, 0o700), catch: (error) => error }),
    ),
    Effect.asVoid,
  );
  const acquire = (uuid: string, owner: GpuLeaseOwner): Effect.Effect<HostLockClaim, unknown> =>
    Effect.gen(function* () {
      yield* ensureDirectory;
      const path = hostLockPath(directory, uuid);
      const temporaryPath = join(directory, `.${registryId}-${randomUUID()}.lock`);
      const record = {
        version: 1,
        uuid,
        owner,
        pid: process.pid,
        processStartToken: yield* currentProcessStartToken(),
        registryId,
      } satisfies HostGpuLeaseRecord;
      yield* Effect.tryPromise({
        try: () => writeFile(temporaryPath, JSON.stringify(record), { flag: "wx", mode: 0o600 }),
        catch: (error) => error,
      });
      return yield* withCleanup(
        Effect.gen(function* () {
          for (let attempt = 0; attempt < hostLockAttempts; attempt += 1) {
            const linked = yield* Effect.tryPromise({
              try: () => link(temporaryPath, path),
              catch: (error) => error,
            }).pipe(
              Effect.as(true),
              Effect.catch((error) =>
                hasErrorCode(error) && error.code === "EEXIST"
                  ? Effect.succeed(false)
                  : Effect.fail(error),
              ),
            );
            if (linked) return { status: "acquired" } as const;
            const current = yield* readHostLock(path);
            if (current.status === "missing") continue;
            if (current.status === "found") {
              if (current.record.registryId === registryId) {
                return current.record.owner === owner
                  ? ({ status: "owned" } as const)
                  : ({ status: "conflict", heldBy: current.record.owner } as const);
              }
              if (yield* hostRecordIsLive(current.record)) {
                return { status: "conflict", heldBy: current.record.owner } as const;
              }
            }
            yield* reclaimStaleHostLock(path);
          }
          return yield* Effect.fail(new Error(`Unable to settle host GPU lease ${uuid}`));
        }),
        removeIfPresent(temporaryPath),
      );
    });
  const release = (uuid: string): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const path = hostLockPath(directory, uuid);
      const current = yield* readHostLock(path);
      if (current.status === "found" && current.record.registryId === registryId) {
        yield* removeIfPresent(path);
      }
    });
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
  const acquireHostLeases = (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ): Effect.Effect<readonly GpuLeaseConflictEntry[], unknown> => {
    if (!hostLocks) return Effect.succeed([]);
    return Effect.gen(function* () {
      const acquired: string[] = [];
      for (const uuid of uuids) {
        const result = yield* hostLocks.acquire(uuid, owner);
        if (result.status !== "conflict") acquired.push(uuid);
        if (result.status === "conflict") {
          yield* Effect.forEach(acquired, (acquiredUuid) => hostLocks.release(acquiredUuid), {
            concurrency: "unbounded",
          });
          return [{ uuid, heldBy: result.heldBy }];
        }
      }
      return [];
    }).pipe(
      Effect.catch((error) =>
        Effect.forEach(uuids, (uuid) => hostLocks.release(uuid).pipe(Effect.ignore), {
          concurrency: "unbounded",
          discard: true,
        }).pipe(Effect.andThen(Effect.fail(error))),
      ),
    );
  };
  const releaseHostLeases = (uuids: readonly string[]): Effect.Effect<void, unknown> =>
    hostLocks
      ? Effect.forEach(uuids, (uuid) => hostLocks.release(uuid), {
          concurrency: "unbounded",
          discard: true,
        })
      : Effect.void;
  const hostAcquireEffect = (
    owner: GpuLeaseOwner,
    uuids: readonly string[],
  ): Effect.Effect<readonly GpuLeaseConflictEntry[], GpuLeaseLockFailure> =>
    acquireHostLeases(owner, uuids).pipe(
      Effect.mapError((error) => new GpuLeaseLockFailure("acquire", error)),
    );
  const hostReleaseEffect = (uuids: readonly string[]): Effect.Effect<void, GpuLeaseLockFailure> =>
    releaseHostLeases(uuids).pipe(
      Effect.mapError((error) => new GpuLeaseLockFailure("release", error)),
    );
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
