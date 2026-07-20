import { Database } from "bun:sqlite";
import { lstatSync } from "node:fs";
import { Effect } from "effect";
import { ensurePrivateFile, repairOwnerOnlyFile } from "../core/private-files";

const OBSOLETE_TABLES = [
  "jobs",
  "chat_sessions",
  "chat_messages",
  "chat_runs",
  "chat_usage",
  "sessions",
  "messages",
  "runs",
  "usage",
] as const;

const sweptPaths = new Set<string>();
const SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

const errorCode = (error: unknown): unknown =>
  error !== null && typeof error === "object" ? Reflect.get(error, "code") : undefined;

const hardenSqliteSidecars = (dbPath: string): void => {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const sidecar = `${dbPath}${suffix}`;
    try {
      const stat = lstatSync(sidecar);
      if (!stat.isFile() || stat.isSymbolicLink() || !repairOwnerOnlyFile(sidecar)) {
        throw new Error(`Unsafe private database sidecar: ${sidecar}`);
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      if (error instanceof Error && error.message.startsWith("Unsafe private database sidecar:")) {
        throw error;
      }
      throw new Error(`Unsafe private database sidecar: ${sidecar}`);
    }
  }
};

const dropObsoleteTables = (db: Database, dbPath: string): void => {
  if (sweptPaths.has(dbPath)) return;
  for (const table of OBSOLETE_TABLES) {
    db.run(`DROP TABLE IF EXISTS ${table}`);
  }
  sweptPaths.add(dbPath);
};

export const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export class RepositoryError extends Error {
  readonly _tag = "RepositoryError";

  public constructor(
    readonly operation: string,
    override readonly cause: unknown,
  ) {
    super(`Repository operation failed: ${operation}`, { cause });
    this.name = "RepositoryError";
  }
}

export const repositoryEffect = <A>(
  operation: string,
  execute: () => A,
): Effect.Effect<A, RepositoryError> =>
  Effect.try({
    try: execute,
    catch: (cause) => new RepositoryError(operation, cause),
  });

export const makeDatabaseCloser = (
  db: Database,
  operation: string,
): (() => Effect.Effect<void, RepositoryError>) => {
  let closed = false;
  return () =>
    repositoryEffect(operation, () => {
      if (closed) return;
      db.close();
      closed = true;
    });
};

export const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const openSqliteDatabase = (dbPath: string): Database => {
  if (dbPath !== ":memory:") {
    ensurePrivateFile(dbPath);
    hardenSqliteSidecars(dbPath);
  }
  const db = new Database(dbPath);
  try {
    if (dbPath !== ":memory:") {
      if (!repairOwnerOnlyFile(dbPath)) throw new Error(`Unsafe private database: ${dbPath}`);
      hardenSqliteSidecars(dbPath);
    }
    db.run("PRAGMA busy_timeout = 5000");
    dropObsoleteTables(db, dbPath);
    if (dbPath !== ":memory:") hardenSqliteSidecars(dbPath);
    return db;
  } catch (cause) {
    try {
      db.close();
    } catch {}
    throw cause;
  }
};

export const openInitializedDatabase = (
  dbPath: string,
  initialize: (db: Database) => void,
): Database => {
  const db = openSqliteDatabase(dbPath);
  try {
    initialize(db);
    return db;
  } catch (cause) {
    try {
      db.close();
    } catch {}
    throw cause;
  }
};
