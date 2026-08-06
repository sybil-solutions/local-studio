import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Effect } from "effect";
import type {
  DeviceId,
  EngineId,
  InstanceRecord,
  LaunchFailure,
  NodeId,
  EngineRuntimeKind,
} from "../contracts";

/**
 * The instance store: one JSON file per running deployment, written write-then-rename so
 * a crash mid-write reads as "not running" rather than as garbage.
 *
 * The records ARE the GPU lease. There is no registry, no lock-file-per-device, and no
 * in-memory cache of who holds what — `heldDevices` derives capacity by unioning the
 * devices of every record whose handle is still alive. The only mutual exclusion in the
 * whole design is `withPlacementLock`, held for the few milliseconds of a reservation,
 * never across a spawn.
 */

export interface InstanceStore {
  readonly directory: string;
  readonly read: (name: string) => InstanceRecord | null;
  readonly all: () => readonly InstanceRecord[];
  readonly write: (record: InstanceRecord) => void;
  readonly drop: (name: string) => void;
  readonly acquire: (record: Omit<InstanceRecord, "nonce">) => InstanceRecord | null;
  readonly replace: (record: InstanceRecord, attemptNonce: string) => boolean;
  readonly release: (name: string, attemptNonce: string) => boolean;
  readonly logPath: (name: string) => string;
  readonly reserve: (
    reservation: Reservation,
    alive: (record: InstanceRecord) => Effect.Effect<boolean>,
  ) => Effect.Effect<InstanceRecord, LaunchFailure>;
  readonly heldDevices: (
    alive: (record: InstanceRecord) => Effect.Effect<boolean>,
  ) => Effect.Effect<ReadonlySet<DeviceId>>;
  readonly allocatePort: (basePort: number, attemptNonce?: string) => number;
}

export interface Reservation {
  readonly name: string;
  readonly nodeId: NodeId;
  readonly engine: EngineId;
  readonly recipeId: string;
  readonly runtime: EngineRuntimeKind;
  readonly attemptNonce: string;
  readonly candidates: readonly DeviceId[];
  readonly need: number;
  /** Unified-memory accelerators (Apple Silicon, DGX Spark) are shared by design: the
   *  SoC is one pool and RAM is the real budget, so instances stack on the same device
   *  instead of leasing it exclusively. */
  readonly shareable: boolean;
  readonly basePort: number;
  /** Reserve exactly this port (legacy inference_port semantics) instead of scanning
   *  upward from basePort; fails when something else already holds it. */
  readonly exactPort?: number;
  readonly readyDeadlineMs: number;
}

/** Names come from recipes but stop/drop accept user input — keep them inside the dir. */
const safeName = (name: string): string => name.replace(/[/\\]/g, "_");

const isRecord = (value: unknown): value is InstanceRecord =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as InstanceRecord).name === "string" &&
  typeof (value as InstanceRecord).engine === "string" &&
  typeof (value as InstanceRecord).port === "number" &&
  Array.isArray((value as InstanceRecord).devices);

const pidAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/* ── placement lock ──────────────────────────────────────────────────────── */

// Reservation is a read-modify-write over the record set, so two concurrent launches
// could otherwise both see the same free devices. exo's build-lock recipe: create with
// "wx" (atomic on every OS), holder pid inside, stale iff the holder is dead — SIGKILL
// skips finally blocks, and without the staleness rule a crashed reservation would block
// every launch until someone deletes the file by hand.
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

const tryAcquire = (lockPath: string): boolean => {
  try {
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
};

const lockIsStale = (lockPath: string): boolean => {
  try {
    const holder = Number.parseInt(readFileSync(lockPath, "utf8").trim(), 10);
    return !pidAlive(holder);
  } catch {
    // Unreadable or already gone — the next acquire attempt settles it.
    return false;
  }
};

const releaseLock = (lockPath: string): void => {
  try {
    rmSync(lockPath);
  } catch {
    /* already gone */
  }
};

const acquirePlacementLock = (lockPath: string): Effect.Effect<void, LaunchFailure> =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    while (!tryAcquire(lockPath)) {
      if (lockIsStale(lockPath)) {
        releaseLock(lockPath);
        continue;
      }
      if (Date.now() - startedAt > LOCK_TIMEOUT_MS) {
        return yield* Effect.fail<LaunchFailure>({
          kind: "spawn-failed",
          detail: `placement lock still held after ${LOCK_TIMEOUT_MS}ms: ${lockPath}`,
        });
      }
      yield* Effect.sleep(LOCK_RETRY_MS);
    }
  });

/* ── store ───────────────────────────────────────────────────────────────── */

export const makeInstanceStore = (dataDirectory: string): InstanceStore => {
  const directory = join(dataDirectory, "instances");
  const logsDirectory = join(directory, "logs");
  mkdirSync(logsDirectory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const lockPath = join(directory, "placement.lock");
  const mutationPath = join(directory, "mutations.sqlite");
  const recordPath = (name: string): string => join(directory, `${safeName(name)}.json`);

  const openMutationDatabase = (): Database => {
    const database = new Database(mutationPath, { create: true });
    database.run("PRAGMA busy_timeout = 5000");
    return database;
  };
  const initialize = openMutationDatabase();
  initialize.run("CREATE TABLE IF NOT EXISTS instance_store_mutex (id INTEGER PRIMARY KEY, generation INTEGER NOT NULL)");
  initialize.run("INSERT OR IGNORE INTO instance_store_mutex (id, generation) VALUES (1, 0)");
  initialize.close();
  chmodSync(mutationPath, 0o600);

  const mutate = <A>(operation: () => A): A => {
    const database = openMutationDatabase();
    try {
      database.run("BEGIN IMMEDIATE");
      database.run("UPDATE instance_store_mutex SET generation = generation + 1 WHERE id = 1");
      const result = operation();
      database.run("COMMIT");
      return result;
    } catch (error) {
      try {
        database.run("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      database.close();
    }
  };

  const read = (name: string): InstanceRecord | null => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(recordPath(name), "utf8"));
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const all = (): readonly InstanceRecord[] => {
    try {
      return readdirSync(directory)
        .filter((file) => file.endsWith(".json"))
        .map((file) => read(file.slice(0, -".json".length)))
        .filter((record): record is InstanceRecord => record !== null);
    } catch {
      return [];
    }
  };

  const writeRecord = (record: InstanceRecord): void => {
    const path = recordPath(record.name);
    writeFileSync(`${path}.tmp`, JSON.stringify(record, null, 2));
    renameSync(`${path}.tmp`, path);
  };

  const dropRecord = (name: string): void => rmSync(recordPath(name), { force: true });

  const write = (record: InstanceRecord): void => mutate(() => writeRecord(record));
  const drop = (name: string): void => mutate(() => dropRecord(name));
  const acquire = (seed: Omit<InstanceRecord, "nonce">): InstanceRecord | null => {
    const record = { ...seed, nonce: randomUUID() };
    return mutate(() => {
      if (existsSync(recordPath(record.name))) return null;
      writeRecord(record);
      return record;
    });
  };

  const replace = (record: InstanceRecord, attemptNonce: string): boolean =>
    mutate(() => {
      if (record.nonce !== attemptNonce || read(record.name)?.nonce !== attemptNonce) return false;
      writeRecord(record);
      return true;
    });

  const release = (name: string, attemptNonce: string): boolean =>
    mutate(() => {
      if (read(name)?.nonce !== attemptNonce) return false;
      dropRecord(name);
      return true;
    });

  const heldDevices = (
    alive: (record: InstanceRecord) => Effect.Effect<boolean>,
  ): Effect.Effect<ReadonlySet<DeviceId>> =>
    Effect.gen(function* () {
      const held = new Set<DeviceId>();
      for (const record of all()) {
        // A reservation with no handle yet still holds its devices — that is the point
        // of reserving before spawning.
        const holds = record.ref === null ? true : yield* alive(record);
        if (holds) for (const device of record.devices) held.add(device);
      }
      return held;
    });

  // Record-held ports are not enough: an unrelated process (an orphaned dev server, a
  // hand-started engine) can squat a port and answer 200 on /health, and a launch that
  // lands on it would be declared ready by someone else's server. A bind probe is the
  // only honest test of "free".
  // Both interfaces: engines bind 127.0.0.1, dev servers bind 0.0.0.0, and macOS lets a
  // specific-interface bind coexist with a wildcard one — probing only loopback would
  // declare a wildcard-held port free.
  const portIsBindable = (port: number): boolean => {
    for (const hostname of ["127.0.0.1", "0.0.0.0"]) {
      try {
        const listener = Bun.listen({ hostname, port, socket: { data: () => {} } });
        listener.stop(true);
      } catch {
        return false;
      }
    }
    return true;
  };

  const allocatePort = (basePort: number, attemptNonce?: string): number => {
    const used = new Set(
      all()
        .filter((record) => record.nonce !== attemptNonce)
        .map((record) => record.port),
    );
    let port = basePort;
    while (used.has(port) || !portIsBindable(port)) port += 1;
    return port;
  };

  const reserve = (
    reservation: Reservation,
    alive: (record: InstanceRecord) => Effect.Effect<boolean>,
  ): Effect.Effect<InstanceRecord, LaunchFailure> =>
    Effect.gen(function* () {
      yield* acquirePlacementLock(lockPath);
      const record = yield* Effect.gen(function* () {
        const attempt = read(reservation.name);
        if (attempt?.nonce !== reservation.attemptNonce) {
          return yield* Effect.fail<LaunchFailure>({
            kind: "already-running",
            name: reservation.name,
          });
        }
        const held = reservation.shareable ? new Set<DeviceId>() : yield* heldDevices(alive);
        const free = reservation.candidates.filter((device) => !held.has(device));
        if (free.length < reservation.need) {
          return yield* Effect.fail<LaunchFailure>({
            kind: "no-capacity",
            need: reservation.need,
            free: free.length,
          });
        }
        let port: number;
        if (reservation.exactPort !== undefined) {
          const takenByRecord = all().some(
            (record) =>
              record.nonce !== reservation.attemptNonce && record.port === reservation.exactPort,
          );
          if (takenByRecord || !portIsBindable(reservation.exactPort)) {
            return yield* Effect.fail<LaunchFailure>({
              kind: "spawn-failed",
              detail: `port ${reservation.exactPort} is already in use`,
            });
          }
          port = reservation.exactPort;
        } else {
          port = allocatePort(reservation.basePort, reservation.attemptNonce);
        }
        const now = Date.now();
        const reserved: InstanceRecord = {
          name: reservation.name,
          nodeId: reservation.nodeId,
          engine: reservation.engine,
          recipeId: reservation.recipeId,
          runtime: reservation.runtime,
          ref: null,
          port,
          devices: free.slice(0, reservation.need),
          nonce: reservation.attemptNonce,
          startedAt: attempt.startedAt,
          readyDeadlineAt: new Date(now + reservation.readyDeadlineMs).toISOString(),
        };
        if (!replace(reserved, reservation.attemptNonce)) {
          return yield* Effect.fail<LaunchFailure>({
            kind: "already-running",
            name: reservation.name,
          });
        }
        return reserved;
      }).pipe(Effect.ensuring(Effect.sync(() => releaseLock(lockPath))));
      return record;
    });

  return {
    directory,
    read,
    all,
    write,
    drop,
    acquire,
    replace,
    release,
    logPath: (name: string) => join(logsDirectory, `${safeName(name)}.log`),
    reserve,
    heldDevices,
    allocatePort,
  };
};
