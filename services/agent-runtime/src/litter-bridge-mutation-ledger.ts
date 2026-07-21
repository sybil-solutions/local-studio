import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";

const FILENAME = "litter-mutation-idempotency.json";
const STORE_VERSION = 1;
const STORE_LIMIT_BYTES = 16 * 1024 * 1024;
const ENTRY_LIMIT = 10_000;
const LOCK_STALE_MS = 30_000;

type LedgerState = "reserved" | "dispatching" | "accepted" | "rejected" | "indeterminate";

type LedgerEntry = {
  operation: "agent_turn";
  bodyHash: string;
  state: LedgerState;
  createdAt: string;
  updatedAt: string;
  result?: unknown;
};

type LedgerStore = {
  version: 1;
  entries: Record<string, LedgerEntry>;
};

export type MutationIdentity = {
  controllerId: string;
  deviceId: string;
  idempotencyKey: string;
};

export type MutationReservation =
  | { kind: "reserved" }
  | { kind: "cached"; result: unknown }
  | { kind: "mismatch" }
  | { kind: "indeterminate" };

export type MutationLedgerTransaction = {
  reserve(bodyHash: string): MutationReservation;
  markDispatching(bodyHash: string): void;
  settle(bodyHash: string, state: "accepted" | "rejected", result: unknown): void;
};

const emptyStore = (): LedgerStore => ({ version: STORE_VERSION, entries: {} });

const timestamp = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value);

const normalizeStore = (value: unknown): LedgerStore => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Litter mutation ledger is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== STORE_VERSION ||
    !record.entries ||
    typeof record.entries !== "object" ||
    Array.isArray(record.entries)
  ) {
    throw new Error("Litter mutation ledger is invalid");
  }
  const entries: Record<string, LedgerEntry> = {};
  for (const [key, raw] of Object.entries(record.entries as Record<string, unknown>)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Litter mutation ledger is invalid");
    }
    const entry = raw as Record<string, unknown>;
    if (
      entry.operation !== "agent_turn" ||
      typeof entry.bodyHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.bodyHash) ||
      (entry.state !== "reserved" &&
        entry.state !== "dispatching" &&
        entry.state !== "accepted" &&
        entry.state !== "rejected" &&
        entry.state !== "indeterminate") ||
      !timestamp(entry.createdAt) ||
      !timestamp(entry.updatedAt)
    ) {
      throw new Error("Litter mutation ledger is invalid");
    }
    if ((entry.state === "accepted" || entry.state === "rejected") && !("result" in entry)) {
      throw new Error("Litter mutation ledger is invalid");
    }
    entries[key] = {
      operation: "agent_turn",
      bodyHash: entry.bodyHash,
      state: entry.state,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...(entry.state === "accepted" || entry.state === "rejected" ? { result: entry.result } : {}),
    };
  }
  return { version: STORE_VERSION, entries };
};

const verifyPrivateFile = (filepath: string): void => {
  const metadata = lstatSync(filepath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error("Litter mutation ledger permissions are unsafe");
  }
  const uid = process.getuid?.();
  if (uid !== undefined && metadata.uid !== uid) {
    throw new Error("Litter mutation ledger ownership is unsafe");
  }
  if (metadata.size > STORE_LIMIT_BYTES) throw new Error("Litter mutation ledger is too large");
};

const syncDirectory = (directory: string): void => {
  const descriptor = openSync(directory, constants.O_RDONLY);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

const writeStore = (filepath: string, store: LedgerStore): void => {
  const encoded = `${JSON.stringify(store, null, 2)}\n`;
  if (Buffer.byteLength(encoded, "utf8") > STORE_LIMIT_BYTES) {
    throw new Error("Litter mutation ledger is too large");
  }
  const temporary = `${filepath}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  const descriptor = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  try {
    writeFileSync(descriptor, encoded, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, filepath);
  chmodSync(filepath, 0o600);
  syncDirectory(path.dirname(filepath));
};

const readStore = (filepath: string): LedgerStore => {
  verifyPrivateFile(filepath);
  return normalizeStore(JSON.parse(readFileSync(filepath, "utf8")));
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

export function createLitterMutationLedger(dataDir: string, now: () => Date) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const filepath = path.join(dataDir, FILENAME);
  if (!existsSync(filepath)) writeStore(filepath, emptyStore());
  const chains = new Map<string, Promise<unknown>>();

  const withMutation = <T>(
    identity: MutationIdentity,
    task: (transaction: MutationLedgerTransaction) => Promise<T>,
  ): Promise<T> => {
    const key = entryKey(identity);
    const previous = chains.get(key) ?? Promise.resolve();
    const execute = async () => {
      const release = await lockfile.lock(filepath, {
        realpath: false,
        stale: LOCK_STALE_MS,
        retries: { retries: 120, factor: 1, minTimeout: 25, maxTimeout: 25, randomize: false },
      });
      try {
        const store = readStore(filepath);
        let changed = false;
        for (const entry of Object.values(store.entries)) {
          if (entry.state === "dispatching") {
            entry.state = "indeterminate";
            entry.updatedAt = now().toISOString();
            changed = true;
          }
        }
        if (changed) writeStore(filepath, store);

        const persist = (): void => writeStore(filepath, store);
        const transaction: MutationLedgerTransaction = {
          reserve: (bodyHash) => {
            const existing = store.entries[key];
            if (existing) {
              if (existing.bodyHash !== bodyHash) return { kind: "mismatch" };
              if (existing.state === "accepted" || existing.state === "rejected") {
                return { kind: "cached", result: existing.result };
              }
              if (existing.state === "indeterminate" || existing.state === "dispatching") {
                return { kind: "indeterminate" };
              }
              return { kind: "reserved" };
            }
            if (Object.keys(store.entries).length >= ENTRY_LIMIT) {
              throw new Error("Litter mutation ledger capacity is exhausted");
            }
            const observedAt = now().toISOString();
            store.entries[key] = {
              operation: "agent_turn",
              bodyHash,
              state: "reserved",
              createdAt: observedAt,
              updatedAt: observedAt,
            };
            persist();
            return { kind: "reserved" };
          },
          markDispatching: (bodyHash) => {
            const entry = store.entries[key];
            if (!entry || entry.bodyHash !== bodyHash || entry.state !== "reserved") {
              throw new Error("Litter mutation reservation is invalid");
            }
            entry.state = "dispatching";
            entry.updatedAt = now().toISOString();
            persist();
          },
          settle: (bodyHash, state, result) => {
            const entry = store.entries[key];
            if (
              !entry ||
              entry.bodyHash !== bodyHash ||
              (entry.state !== "reserved" && entry.state !== "dispatching")
            ) {
              throw new Error("Litter mutation reservation is invalid");
            }
            entry.state = state;
            entry.result = result;
            entry.updatedAt = now().toISOString();
            persist();
          },
        };
        return await task(transaction);
      } finally {
        await release();
      }
    };
    const run = previous.then(execute, execute);
    const guarded = run
      .catch(() => undefined)
      .finally(() => {
        if (chains.get(key) === guarded) chains.delete(key);
      });
    chains.set(key, guarded);
    return run;
  };

  return { withMutation, filepath };
}
