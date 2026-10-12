import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { Effect } from "effect";

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
  const db = new Database(dbPath);
  try {
    db.run("PRAGMA busy_timeout = 5000");
    if (dbPath !== ":memory:") {
      try {
        chmodSync(dbPath, 0o600);
      } catch {}
    }
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
