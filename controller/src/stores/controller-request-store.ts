import type { Database } from "bun:sqlite";
import { openSqliteDatabase, toFiniteNumber, toNullableNumber } from "./sqlite";

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

export class ControllerRequestStore {
  private readonly db: Database;

  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
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
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_requests_created_at ON controller_requests(created_at)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_requests_path_created ON controller_requests(path, created_at)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_requests_status_created ON controller_requests(status, created_at)`
    );
    this.db.run(`
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
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_function_calls_created_at ON controller_function_calls(created_at)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_function_calls_name_created ON controller_function_calls(function_name, created_at)`
    );
  }

  public record(record: ControllerRequestRecord): void {
    const durationMs = Math.max(0, Math.round(record.duration_ms));
    this.db
      .query(
        `INSERT INTO controller_requests (
           method, path, status, duration_ms, success, error_class, error_message, user_agent
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.method.toUpperCase(),
        record.path,
        Math.round(record.status),
        durationMs,
        record.success ? 1 : 0,
        record.error_class ?? null,
        record.error_message ?? null,
        record.user_agent ?? null
      );
  }

  public recordFunctionCall(record: ControllerFunctionCallRecord): void {
    const durationMs = Math.max(0, Math.round(record.duration_ms));
    this.db
      .query(
        `INSERT INTO controller_function_calls (
           function_name, duration_ms, success, error_class, error_message
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        record.function_name,
        durationMs,
        record.success ? 1 : 0,
        record.error_class ?? null,
        record.error_message ?? null
      );
  }

  public aggregate(): Record<string, unknown> {
    const totals = this.db
      .query<NumberRow, []>(
        `SELECT
           COUNT(*) as total_requests,
           COALESCE(SUM(success), 0) as successful_requests,
           COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failed_requests,
           AVG(duration_ms) as avg_duration_ms,
           MAX(duration_ms) as max_duration_ms
         FROM controller_requests`
      )
      .get() as NumberRow | null;

    const totalRequests = toFiniteNumber(totals?.["total_requests"]);
    const successfulRequests = toFiniteNumber(totals?.["successful_requests"]);
    const failedRequests = toFiniteNumber(totals?.["failed_requests"]);

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
         LIMIT 50`
      )
      .all() as NumberRow[];

    const byStatus = this.db
      .query<NumberRow, []>(
        `SELECT
           status,
           COUNT(*) as requests
         FROM controller_requests
         GROUP BY status
         ORDER BY requests DESC, status ASC`
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
         LIMIT 25`
      )
      .all() as NumberRow[];

    const recent = this.db
      .query<NumberRow, []>(
        `SELECT
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) as last_hour,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) as last_24h,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') AND success = 0 THEN 1 ELSE 0 END) as last_24h_failed
         FROM controller_requests`
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
         FROM controller_function_calls`
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
         LIMIT 50`
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
         LIMIT 25`
      )
      .all() as NumberRow[];

    const totalFunctionCalls = toFiniteNumber(functionTotals?.["total_calls"]);
    const successfulFunctionCalls = toFiniteNumber(functionTotals?.["successful_calls"]);

    return {
      totals: {
        total_requests: totalRequests,
        successful_requests: successfulRequests,
        failed_requests: failedRequests,
        success_rate: totalRequests ? (successfulRequests / totalRequests) * 100 : 0,
      },
      latency: {
        avg_ms: toNullableNumber(totals?.["avg_duration_ms"]),
        max_ms: toNullableNumber(totals?.["max_duration_ms"]),
      },
      recent_activity: {
        last_hour_requests: toFiniteNumber(recent?.["last_hour"]),
        last_24h_requests: toFiniteNumber(recent?.["last_24h"]),
        last_24h_failed_requests: toFiniteNumber(recent?.["last_24h_failed"]),
      },
      by_path: byPath.map((row) => {
        const requests = toFiniteNumber(row["requests"]);
        const successful = toFiniteNumber(row["successful"]);
        return {
          method: String(row["method"] ?? ""),
          path: String(row["path"] ?? ""),
          requests,
          successful,
          failed: toFiniteNumber(row["failed"]),
          success_rate: requests ? (successful / requests) * 100 : 0,
          avg_duration_ms: toNullableNumber(row["avg_duration_ms"]),
          max_duration_ms: toNullableNumber(row["max_duration_ms"]),
        };
      }),
      by_status: byStatus.map((row) => ({
        status: toFiniteNumber(row["status"]),
        requests: toFiniteNumber(row["requests"]),
      })),
      recent_errors: errors.map((row) => ({
        method: String(row["method"] ?? ""),
        path: String(row["path"] ?? ""),
        status: toFiniteNumber(row["status"]),
        error_class: row["error_class"] ? String(row["error_class"]) : null,
        error_message: row["error_message"] ? String(row["error_message"]) : null,
        created_at: String(row["created_at"] ?? ""),
      })),
      function_calls: {
        totals: {
          total_calls: totalFunctionCalls,
          successful_calls: successfulFunctionCalls,
          failed_calls: toFiniteNumber(functionTotals?.["failed_calls"]),
          success_rate: totalFunctionCalls
            ? (successfulFunctionCalls / totalFunctionCalls) * 100
            : 0,
        },
        latency: {
          avg_ms: toNullableNumber(functionTotals?.["avg_duration_ms"]),
          max_ms: toNullableNumber(functionTotals?.["max_duration_ms"]),
        },
        by_function: byFunction.map((row) => {
          const calls = toFiniteNumber(row["calls"]);
          const successful = toFiniteNumber(row["successful"]);
          return {
            function_name: String(row["function_name"] ?? ""),
            calls,
            successful,
            failed: toFiniteNumber(row["failed"]),
            success_rate: calls ? (successful / calls) * 100 : 0,
            avg_duration_ms: toNullableNumber(row["avg_duration_ms"]),
            max_duration_ms: toNullableNumber(row["max_duration_ms"]),
          };
        }),
        recent_errors: functionErrors.map((row) => ({
          function_name: String(row["function_name"] ?? ""),
          error_class: row["error_class"] ? String(row["error_class"]) : null,
          error_message: row["error_message"] ? String(row["error_message"]) : null,
          created_at: String(row["created_at"] ?? ""),
        })),
      },
    };
  }
}
