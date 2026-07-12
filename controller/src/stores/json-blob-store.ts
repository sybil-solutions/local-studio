import type { Database } from "bun:sqlite";
import { openSqliteDatabase } from "./sqlite";

type BlobRow = { data: string };

export type JsonBlobStoreOptions<T> = {
  orderBy: string;
  idOf: (value: T) => string;
  decode: (data: string) => T | null;
};

export class JsonBlobStore<T> {
  protected readonly db: Database;

  public constructor(
    dbPath: string,
    private readonly table: string,
    private readonly options: JsonBlobStoreOptions<T>,
  ) {
    this.db = openSqliteDatabase(dbPath);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  public list(): T[] {
    const rows = this.db
      .query(`SELECT data FROM ${this.table} ORDER BY ${this.options.orderBy}`)
      .all() as BlobRow[];
    const values: T[] = [];
    for (const row of rows) {
      const value = this.options.decode(row.data);
      if (value) values.push(value);
    }
    return values;
  }

  public get(id: string): T | null {
    const row = this.db
      .query(`SELECT data FROM ${this.table} WHERE id = ?`)
      .get(id) as BlobRow | null;
    if (!row?.data) return null;
    return this.options.decode(row.data);
  }

  public save(value: T): void {
    this.db
      .query(
        `INSERT INTO ${this.table} (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(this.options.idOf(value), JSON.stringify(value));
  }

  public delete(id: string): boolean {
    return this.db.query(`DELETE FROM ${this.table} WHERE id = ?`).run(id).changes > 0;
  }
}
