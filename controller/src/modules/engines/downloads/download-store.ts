import { Effect, Option, Schema } from "effect";
import { openSqliteDatabase } from "../../../stores/sqlite";
import { EngineOperationError } from "../engine-spec";
import type { ModelDownload } from "../types";

const DownloadFileSchema = Schema.Struct({
  path: Schema.String,
  size_bytes: Schema.NullOr(Schema.Number),
  downloaded_bytes: Schema.Number,
  status: Schema.Literals(["pending", "downloading", "completed", "error"]),
});

const ModelDownloadSchema = Schema.Struct({
  id: Schema.String,
  model_id: Schema.String,
  revision: Schema.NullOr(Schema.String),
  status: Schema.Literals(["queued", "downloading", "paused", "completed", "failed", "canceled"]),
  source: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  updated_at: Schema.String,
  completed_at: Schema.optional(Schema.NullOr(Schema.String)),
  target_dir: Schema.String,
  total_bytes: Schema.NullOr(Schema.Number),
  downloaded_bytes: Schema.Number,
  speed_bytes_per_second: Schema.optional(Schema.NullOr(Schema.Number)),
  files: Schema.Array(DownloadFileSchema),
  error: Schema.NullOr(Schema.String),
});

const operationError = (operation: string, cause: unknown): EngineOperationError =>
  new EngineOperationError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });

const attempt = <A>(operation: string, evaluate: () => A): Effect.Effect<A, EngineOperationError> =>
  Effect.try({
    try: evaluate,
    catch: (cause) => operationError(operation, cause),
  });

const decodeDownload = (value: unknown): Effect.Effect<ModelDownload, EngineOperationError> =>
  attempt("parse-download-record", () =>
    typeof value === "string" ? JSON.parse(value) : value,
  ).pipe(
    Effect.flatMap((parsed) => Schema.decodeUnknownEffect(ModelDownloadSchema)(parsed)),
    Effect.mapError((cause) => operationError("decode-download-record", cause)),
    Effect.map((download) => download as ModelDownload),
  );

export class DownloadStore {
  private constructor(private readonly db: ReturnType<typeof openSqliteDatabase>) {}

  public static make(dbPath: string): Effect.Effect<DownloadStore, EngineOperationError> {
    return Effect.gen(function* () {
      const db = yield* attempt("open-download-database", () => openSqliteDatabase(dbPath));
      const store = new DownloadStore(db);
      return yield* store.migrate().pipe(
        Effect.as(store),
        Effect.onError(() =>
          attempt("close-download-database", () => db.close()).pipe(Effect.ignore),
        ),
      );
    });
  }

  private migrate(): Effect.Effect<void, EngineOperationError> {
    return attempt("migrate-download-store", () => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS model_downloads (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
    });
  }

  public list(): Effect.Effect<ModelDownload[], EngineOperationError> {
    const store = this;
    return Effect.gen(function* () {
      const rows = yield* attempt(
        "list-downloads",
        () =>
          store.db
            .query("SELECT data FROM model_downloads ORDER BY updated_at DESC")
            .all() as Array<{
            data: string;
          }>,
      );
      const decoded = yield* Effect.forEach(rows, (row) =>
        decodeDownload(row.data).pipe(Effect.option),
      );
      return decoded.filter(Option.isSome).map((entry) => entry.value);
    });
  }

  public get(id: string): Effect.Effect<ModelDownload | null, EngineOperationError> {
    const store = this;
    return Effect.gen(function* () {
      const row = yield* attempt(
        "get-download",
        () =>
          store.db.query("SELECT data FROM model_downloads WHERE id = ?").get(id) as {
            data: string;
          } | null,
      );
      if (!row?.data) return null;
      return yield* decodeDownload(row.data).pipe(Effect.catch(() => Effect.succeed(null)));
    });
  }

  public save(download: ModelDownload): Effect.Effect<void, EngineOperationError> {
    return attempt("save-download", () => {
      const data = JSON.stringify(download);
      this.db
        .query(
          `
            INSERT INTO model_downloads (id, data, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
          `,
        )
        .run(download.id, data);
    });
  }

  public delete(id: string): Effect.Effect<boolean, EngineOperationError> {
    return attempt(
      "delete-download",
      () => this.db.query("DELETE FROM model_downloads WHERE id = ?").run(id).changes > 0,
    );
  }

  public close(): Effect.Effect<void, EngineOperationError> {
    return attempt("close-download-database", () => this.db.close());
  }
}
