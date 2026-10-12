import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect } from "effect";
import type {
  DeviceId,
  EngineId,
  InstanceRecord,
  LaunchFailure,
  NodeId,
  EngineRuntimeKind,
} from "../contracts";
import { decodeInstanceRecord } from "./record-schema";

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
  readonly logPath: (name: string) => string;
  readonly reserve: (
    reservation: Reservation,
    alive: (record: InstanceRecord) => Effect.Effect<boolean>,
  ) => Effect.Effect<InstanceRecord, LaunchFailure>;
  readonly heldDevices: (
    alive: (record: InstanceRecord) => Effect.Effect<boolean>,
  ) => Effect.Effect<ReadonlySet<DeviceId>>;
  readonly allocatePort: (basePort: number) => number;
}

export interface Reservation {
  readonly name: string;
  readonly nodeId: NodeId;
  readonly engine: EngineId;
  readonly recipeId: string;
  readonly runtime: EngineRuntimeKind;
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
  chmodSync(logsDirectory, 0o700);
  const lockPath = join(directory, "placement.lock");
  const recordPath = (name: string): string => join(directory, `${safeName(name)}.json`);

  const read = (name: string): InstanceRecord | null => {
    try {
      const path = recordPath(name);
      chmodSync(path, 0o600);
      return decodeInstanceRecord(JSON.parse(readFileSync(path, "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };

  const all = (): readonly InstanceRecord[] => {
    try {
      return readdirSync(directory)
        .filter((file) => file.endsWith(".json"))
        .map((file) => read(file.slice(0, -".json".length)))
        .filter((record): record is InstanceRecord => record !== null);
    } catch (error) {
      throw error;
    }
  };

  const write = (record: InstanceRecord): void => {
    const path = recordPath(record.name);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      // wx + rename keeps a crash mid-write from reading as garbage; the
      // fsync before rename keeps a power loss right after the rename from
      // resurrecting an empty lease file (rename can outlive its contents).
      const file = openSync(temporaryPath, "wx", 0o600);
      try {
        writeFileSync(file, JSON.stringify(record, null, 2));
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      renameSync(temporaryPath, path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  };

  const drop = (name: string): void => {
    try {
      rmSync(recordPath(name));
    } catch {
      /* already gone */
    }
  };

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

  const allocatePort = (basePort: number): number => {
    const used = new Set(all().map((record) => record.port));
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
          const takenByRecord = all().some((record) => record.port === reservation.exactPort);
          if (takenByRecord || !portIsBindable(reservation.exactPort)) {
            return yield* Effect.fail<LaunchFailure>({
              kind: "spawn-failed",
              detail: `port ${reservation.exactPort} is already in use`,
            });
          }
          port = reservation.exactPort;
        } else {
          port = allocatePort(reservation.basePort);
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
          nonce: randomUUID(),
          startedAt: new Date(now).toISOString(),
          readyDeadlineAt: new Date(now + reservation.readyDeadlineMs).toISOString(),
        };
        write(reserved);
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
    logPath: (name: string) => join(logsDirectory, `${safeName(name)}.log`),
    reserve,
    heldDevices,
    allocatePort,
  };
};
