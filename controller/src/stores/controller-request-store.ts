import type { Database } from "bun:sqlite";
import {
  normalizeControllerUsage,
  usageRate,
  type ControllerUsageStats,
} from "@local-studio/contracts/usage";
import type { Effect } from "effect";
import {
  openInitializedDatabase,
  makeDatabaseCloser,
  repositoryEffect,
  type RepositoryError,
} from "./sqlite";

export interface ControllerRequestRecord {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  success: boolean;
  error_class?: string | null;
  error_message?: string | null;
  user_agent?: string | null;
}

export interface ControllerFunctionCallRecord {
  function_name: string;
  duration_ms: number;
  success: boolean;
  error_class?: string | null;
  error_message?: string | null;
}

type NumberRow = Record<string, number | string | null>;

const RETENTION_DAYS = 14;
const PRUNE_EVERY_N_RECORDS = 1000;

export class ControllerRequestStore {
  private readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;
  private recordsSincePrune = 0;

  public constructor(dbPath: string) {
    this.db = openInitializedDatabase(dbPath, (db) => {
      this.migrate(db);
      this.prune(db);
    });
    this.closeDatabase = makeDatabaseCloser(this.db, "controller-requests.close");
  }

  private migrate(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS controller_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error_class TEXT,
        error_message TEXT,
        user_agent TEXT
      )
    `);
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_requests_created_at ON controller_requests(created_at)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_requests_path_created ON controller_requests(path, created_at)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_requests_status_created ON controller_requests(status, created_at)`,
    );
    db.run(`
      CREATE TABLE IF NOT EXISTS controller_function_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        function_name TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error_class TEXT,
        error_message TEXT
      )
    `);
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_function_calls_created_at ON controller_function_calls(created_at)`,
    );
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_function_calls_name_created ON controller_function_calls(function_name, created_at)`,
    );
  }

  private prune(db: Database = this.db): void {
    for (const table of ["controller_requests", "controller_function_calls"]) {
      db.run(
        `DELETE FROM ${table} WHERE created_at < datetime('now', '-${RETENTION_DAYS} days')`,
      );
    }
  }

  private maybePrune(): void {
    this.recordsSincePrune += 1;
    if (this.recordsSincePrune < PRUNE_EVERY_N_RECORDS) return;
    this.recordsSincePrune = 0;
    this.prune();
  }

  public record(record: ControllerRequestRecord): void {
    const durationMs = Math.max(0, Math.round(record.duration_ms));
    this.db
      .query(
        `INSERT INTO controller_requests (
           method, path, status, duration_ms, success, error_class, error_message, user_agent
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.method.toUpperCase(),
        record.path,
        Math.round(record.status),
        durationMs,
        record.success ? 1 : 0,
        record.error_class ?? null,
        record.error_message ?? null,
        record.user_agent ?? null,
      );
    this.maybePrune();
  }

  public recordEffect(record: ControllerRequestRecord): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("controller-requests.record", () => this.record(record));
  }

  public recordFunctionCall(record: ControllerFunctionCallRecord): void {
    const durationMs = Math.max(0, Math.round(record.duration_ms));
    this.db
      .query(
        `INSERT INTO controller_function_calls (
           function_name, duration_ms, success, error_class, error_message
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.function_name,
        durationMs,
        record.success ? 1 : 0,
        record.error_class ?? null,
        record.error_message ?? null,
      );
    this.maybePrune();
  }

  public recordFunctionCallEffect(
    record: ControllerFunctionCallRecord,
  ): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("controller-function-calls.record", () =>
      this.recordFunctionCall(record),
    );
  }

  public aggregate(): ControllerUsageStats {
    const totals = this.db
      .query<NumberRow, []>(
        `SELECT
           COUNT(*) as total_requests,
           COALESCE(SUM(success), 0) as successful_requests,
           COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failed_requests,
           AVG(duration_ms) as avg_duration_ms,
           MAX(duration_ms) as max_duration_ms
         FROM controller_requests`,
      )
      .get() as NumberRow | null;

    const byPath = this.db
      .query<NumberRow, []>(
        `SELECT
           method,
           path,
           COUNT(*) as requests,
           COALESCE(SUM(success), 0) as successful,
           COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failed,
           AVG(duration_ms) as avg_duration_ms,
           MAX(duration_ms) as max_duration_ms
         FROM controller_requests
         GROUP BY method, path
         ORDER BY requests DESC, path ASC
         LIMIT 50`,
      )
      .all() as NumberRow[];

    const byStatus = this.db
      .query<NumberRow, []>(
        `SELECT
           status,
           COUNT(*) as requests
         FROM controller_requests
         GROUP BY status
         ORDER BY requests DESC, status ASC`,
      )
      .all() as NumberRow[];

    const errors = this.db
      .query<NumberRow, []>(
        `SELECT
           method,
           path,
           status,
           error_class,
           error_message,
           created_at
         FROM controller_requests
         WHERE success = 0
         ORDER BY created_at DESC
         LIMIT 25`,
      )
      .all() as NumberRow[];

    const recent = this.db
      .query<NumberRow, []>(
        `SELECT
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) as last_hour,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) as last_24h,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') AND success = 0 THEN 1 ELSE 0 END) as last_24h_failed
         FROM controller_requests`,
      )
      .get() as NumberRow | null;

    const functionTotals = this.db
      .query<NumberRow, []>(
        `SELECT
           COUNT(*) as total_calls,
           COALESCE(SUM(success), 0) as successful_calls,
           COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failed_calls,
           AVG(duration_ms) as avg_duration_ms,
           MAX(duration_ms) as max_duration_ms
         FROM controller_function_calls`,
      )
      .get() as NumberRow | null;

    const byFunction = this.db
      .query<NumberRow, []>(
        `SELECT
           function_name,
           COUNT(*) as calls,
           COALESCE(SUM(success), 0) as successful,
           COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failed,
           AVG(duration_ms) as avg_duration_ms,
           MAX(duration_ms) as max_duration_ms
         FROM controller_function_calls
         GROUP BY function_name
         ORDER BY calls DESC, function_name ASC
         LIMIT 50`,
      )
      .all() as NumberRow[];

    const functionErrors = this.db
      .query<NumberRow, []>(
        `SELECT
           function_name,
           error_class,
           error_message,
           created_at
         FROM controller_function_calls
         WHERE success = 0
         ORDER BY created_at DESC
         LIMIT 25`,
      )
      .all() as NumberRow[];

    return normalizeControllerUsage({
      totals: {
        ...totals,
        success_rate: usageRate(totals?.["successful_requests"], totals?.["total_requests"]),
      },
      latency: {
        avg_ms: totals?.["avg_duration_ms"],
        max_ms: totals?.["max_duration_ms"],
      },
      recent_activity: {
        last_hour_requests: recent?.["last_hour"],
        last_24h_requests: recent?.["last_24h"],
        last_24h_failed_requests: recent?.["last_24h_failed"],
      },
      by_path: byPath.map((row) => ({
        ...row,
        success_rate: usageRate(row["successful"], row["requests"]),
      })),
      by_status: byStatus,
      recent_errors: errors,
      function_calls: {
        totals: {
          ...functionTotals,
          success_rate: usageRate(
            functionTotals?.["successful_calls"],
            functionTotals?.["total_calls"],
          ),
        },
        latency: {
          avg_ms: functionTotals?.["avg_duration_ms"],
          max_ms: functionTotals?.["max_duration_ms"],
        },
        by_function: byFunction.map((row) => ({
          ...row,
          success_rate: usageRate(row["successful"], row["calls"]),
        })),
        recent_errors: functionErrors,
      },
    }) as ControllerUsageStats;
  }

  public aggregateEffect(): Effect.Effect<ControllerUsageStats, RepositoryError> {
    return repositoryEffect("controller-requests.aggregate", () => this.aggregate());
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }
}
