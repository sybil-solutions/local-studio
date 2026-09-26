import { Database } from "bun:sqlite";
import { join } from "node:path";

export const openDb = (dataDir: string): Database => {
  const db = new Database(join(dataDir, "local-studio.db"), { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (module TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY (module, version))");
  return db;
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
