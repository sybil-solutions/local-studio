import { Database } from "bun:sqlite";
import { lstatSync } from "node:fs";
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
  sweptPaths.add(dbPath);
  for (const table of OBSOLETE_TABLES) {
    db.run(`DROP TABLE IF EXISTS ${table}`);
  }
};

/**
 * Convert SQLite aggregate values into finite numbers.
 * @param value - Raw SQLite aggregate value.
 * @returns Finite number or zero.
 */
export const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
  } catch (error) {
    db.close();
    throw error;
  }
};
