import type { Database } from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { ApiKeyInfo } from "@local-studio/contracts";
import { migrate } from "./db";
import { readOrCreateSecretFile } from "./config";

export type KeyScope = "admin" | "client" | "federation";

export interface KeyIdentity {
  id: string;
  client: string;
  admin: boolean;
  scope: KeyScope;
  actions: boolean;
}

export interface KeyStore {
  adminKey(): string;
  verify(token: string): KeyIdentity | null;
  issue(client: string, label?: string, scope?: KeyScope, actions?: boolean): { info: ApiKeyInfo; key: string };
  list(): ApiKeyInfo[];
  revoke(id: string): boolean;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const createKeyStore = (db: Database, dataDir: string, override: string | null): KeyStore => {
  migrate(db, "keys", [
    `CREATE TABLE api_keys (
      id TEXT PRIMARY KEY, client TEXT NOT NULL, label TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL, last_used_at INTEGER, admin INTEGER NOT NULL DEFAULT 0)`,
    `ALTER TABLE api_keys ADD COLUMN scope TEXT NOT NULL DEFAULT 'client'; ALTER TABLE api_keys ADD COLUMN actions INTEGER NOT NULL DEFAULT 0;`,
  ]);
  const admin = override ?? readOrCreateSecretFile(join(dataDir, "admin.key"), () => randomBytes(32).toString("hex"));
  const adminHash = Buffer.from(sha(admin), "hex");
  const touch = db.query("UPDATE api_keys SET last_used_at = ? WHERE id = ?");
  const byHash = db.query<{ id: string; client: string; admin: number; scope: string; actions: number }, [string]>(
    "SELECT id, client, admin, scope, actions FROM api_keys WHERE hash = ?",
  );
  const lastTouch = new Map<string, number>();
  type Row = { id: string; client: string; label: string; created_at: number; last_used_at: number | null; admin: number; scope: string; actions: number };
  const row = (r: Row): ApiKeyInfo => ({
    id: r.id,
    client: r.client,
    label: r.label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    admin: r.admin === 1,
    scope: r.admin === 1 ? "admin" : r.scope === "federation" ? "federation" : "client",
    actions: r.actions === 1,
  });
  return {
    adminKey: () => admin,
    verify(token) {
      if (!token) return null;
      const h = sha(token);
      if (timingSafeEqual(Buffer.from(h, "hex"), adminHash)) return { id: "admin", client: "api", admin: true, scope: "admin", actions: true };
      const r = byHash.get(h);
      if (!r) return null;
      const now = Date.now();
      if ((lastTouch.get(r.id) ?? 0) < now - 60_000) {
        lastTouch.set(r.id, now);
        touch.run(now, r.id);
      }
      const scope: KeyScope = r.admin === 1 ? "admin" : r.scope === "federation" ? "federation" : "client";
      return { id: r.id, client: r.client, admin: r.admin === 1, scope, actions: r.actions === 1 };
    },
    issue(client, label, scope = "client", actions = false) {
      const key = `ls_${randomBytes(24).toString("hex")}`;
      const id = `key_${randomBytes(4).toString("hex")}`;
      const now = Date.now();
      const act = scope === "admin" || (scope === "federation" && actions);
      db.query("INSERT INTO api_keys (id, client, label, hash, created_at, admin, scope, actions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
        id,
        client,
        label ?? client,
        sha(key),
        now,
        scope === "admin" ? 1 : 0,
        scope,
        act ? 1 : 0,
      );
      return { info: { id, client, label: label ?? client, createdAt: now, lastUsedAt: null, admin: scope === "admin", scope, actions: act }, key };
    },
    list: () =>
      db
        .query<Row, []>("SELECT id, client, label, created_at, last_used_at, admin, scope, actions FROM api_keys ORDER BY created_at")
        .all()
        .map(row),
    revoke: (id) => db.query("DELETE FROM api_keys WHERE id = ?").run(id).changes > 0,
  };
};
