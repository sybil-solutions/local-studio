import { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { join } from "node:path";

export const dbPath = (dataDir: string): string => join(dataDir, "local-studio.db");

export const openDb = (dataDir: string): Database => {
  const db = new Database(dbPath(dataDir), { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA wal_autocheckpoint = 1000");
  db.exec("PRAGMA journal_size_limit = 67108864");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (module TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY (module, version))");
  return db;
};

export const checkpoint = (db: Database): void => {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("PRAGMA optimize");
};

export const dbBytes = (dataDir: string): { db: number; wal: number } => {
  const size = (p: string) => {
    try {
      return statSync(p).size;
    } catch {
      return 0;
    }
  };
  return { db: size(dbPath(dataDir)), wal: size(`${dbPath(dataDir)}-wal`) };
};

export const migrate = (db: Database, module: string, steps: string[]): void => {
  const done = new Set(
    db
      .query<{ version: number }, [string]>("SELECT version FROM schema_migrations WHERE module = ?")
      .all(module)
      .map((r) => r.version),
  );
  steps.forEach((sql, i) => {
    if (done.has(i)) return;
    db.transaction(() => {
      db.exec(sql);
      db.query("INSERT INTO schema_migrations (module, version) VALUES (?, ?)").run(module, i);
    })();
  });
};
