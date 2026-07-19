import type { Database } from "bun:sqlite";
import type { Rig } from "@local-studio/contracts/rigs";
import type { Effect } from "effect";
import {
  makeDatabaseCloser,
  openInitializedDatabase,
  repositoryEffect,
  type RepositoryError,
} from "./sqlite";

type RigRow = {
  data: string;
};

export class RigStore {
  private readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;

  public constructor(dbPath: string) {
    this.db = openInitializedDatabase(dbPath, (db) =>
      db.run(`
        CREATE TABLE IF NOT EXISTS rigs (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `),
    );
    this.closeDatabase = makeDatabaseCloser(this.db, "rigs.close");
  }

  public list(): Rig[] {
    const rows = this.db.query("SELECT data FROM rigs ORDER BY created_at").all() as RigRow[];
    const rigs: Rig[] = [];
    for (const row of rows) {
      try {
        rigs.push(JSON.parse(row.data) as Rig);
      } catch {
        continue;
      }
    }
    return rigs;
  }

  public listEffect(): Effect.Effect<Rig[], RepositoryError> {
    return repositoryEffect("rigs.list", () => this.list());
  }

  public get(rigId: string): Rig | null {
    const row = this.db.query("SELECT data FROM rigs WHERE id = ?").get(rigId) as RigRow | null;
    if (!row) return null;
    try {
      return JSON.parse(row.data) as Rig;
    } catch {
      return null;
    }
  }

  public getEffect(rigId: string): Effect.Effect<Rig | null, RepositoryError> {
    return repositoryEffect("rigs.get", () => this.get(rigId));
  }

  public save(rig: Rig): void {
    this.db
      .query(
        `INSERT INTO rigs (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(rig.id, JSON.stringify(rig));
  }

  public saveEffect(rig: Rig): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("rigs.save", () => this.save(rig));
  }

  public delete(rigId: string): boolean {
    const result = this.db.query("DELETE FROM rigs WHERE id = ?").run(rigId);
    return result.changes > 0;
  }

  public deleteEffect(rigId: string): Effect.Effect<boolean, RepositoryError> {
    return repositoryEffect("rigs.delete", () => this.delete(rigId));
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }
}
