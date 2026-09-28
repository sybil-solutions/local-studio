import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "../core/db";
import type { KeyStore } from "../core/keys";

export const migrateAgentKeys = (db: Database) =>
  migrate(db, "agent_keys", [`CREATE TABLE agent_keys (client TEXT PRIMARY KEY, key_id TEXT NOT NULL, created_at INTEGER NOT NULL)`]);

export const keyFilePath = (home: string, client: string) => join(home, "keys", `${client}.key`);

export const writeSecret = (path: string, value: string) => {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${value}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
};

export const readSecret = (path: string): string | null => {
  if (!existsSync(path)) return null;
  const v = readFileSync(path, "utf8").trim();
  return v || null;
};

export const ensureClientKey = (db: Database, keys: KeyStore, home: string, client: string): { keyFile: string; keyId: string; fresh: boolean } => {
  migrateAgentKeys(db);
  const keyFile = keyFilePath(home, client);
  const row = db.query<{ key_id: string }, [string]>("SELECT key_id FROM agent_keys WHERE client = ?").get(client);
  const plain = readSecret(keyFile);
  if (row && plain) {
    const v = keys.verify(plain);
    if (v && v.id === row.key_id) return { keyFile, keyId: row.key_id, fresh: false };
  }
  if (row) keys.revoke(row.key_id);
  const { info, key } = keys.issue(client, `${client} (agents)`);
  writeSecret(keyFile, key);
  db.query("INSERT OR REPLACE INTO agent_keys (client, key_id, created_at) VALUES (?, ?, ?)").run(client, info.id, Date.now());
  return { keyFile, keyId: info.id, fresh: true };
};

export const forgetKeyId = (db: Database, keyId: string) => {
  migrateAgentKeys(db);
  db.query("DELETE FROM agent_keys WHERE key_id = ?").run(keyId);
};
