import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Health, Peer, Snapshot } from "@local-studio/contracts";
import { SERVICE } from "@local-studio/contracts";
import type { Ctx } from "../context";
import { migrate } from "../core/db";

export interface PeerRow {
  id: string;
  machine_id: string;
  name: string;
  base_url: string;
  added_at: number;
  last_seen_at: number | null;
}

export interface PeerState {
  row: PeerRow;
  online: boolean;
  misses: number;
  version: string | null;
  error: string | null;
  snapshot: Snapshot | null;
  snapshotKey: string;
  persistedSeenAt: number;
}

export class PeerError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const normaliseUrl = (raw: string): string => {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new PeerError(400, "BAD_URL", "peer url must be http or https");
  if (u.username || u.password) throw new PeerError(400, "BAD_URL", "peer url must not carry credentials");
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
};

export const toPeer = (s: PeerState): Peer => ({
  id: s.row.id,
  machineId: s.row.machine_id,
  name: s.row.name,
  baseUrl: s.row.base_url,
  addedAt: s.row.added_at,
  lastSeenAt: s.row.last_seen_at,
  online: s.online,
  version: s.version,
  error: s.error,
});

export interface PeerStore {
  all(): PeerRow[];
  keyFor(id: string): string | null;
  connect(body: { url: string; key: string; name?: string }): Promise<{ row: PeerRow; snapshot: Snapshot; health: Health; adminKey: boolean }>;
  remove(id: string): boolean;
  touch(id: string, at: number): void;
}

export const createPeerStore = (ctx: Ctx): PeerStore => {
  migrate(ctx.db, "federation", [
    `CREATE TABLE peers (
      id TEXT PRIMARY KEY, machine_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, base_url TEXT NOT NULL,
      added_at INTEGER NOT NULL, last_seen_at INTEGER)`,
  ]);
  const keysDir = join(ctx.config.home, "keys");
  const keyPath = (id: string) => join(keysDir, `peer-${id}.key`);
  const writeKey = (id: string, key: string) => {
    mkdirSync(keysDir, { recursive: true, mode: 0o700 });
    const tmp = `${keyPath(id)}.${process.pid}.tmp`;
    writeFileSync(tmp, `${key}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, keyPath(id));
  };
  const keyCache = new Map<string, string>();

  const readJson = async (res: Response): Promise<unknown> => {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  return {
    all: () => ctx.db.query<PeerRow, []>("SELECT * FROM peers ORDER BY added_at, id").all(),
    keyFor(id) {
      const cached = keyCache.get(id);
      if (cached) return cached;
      const p = keyPath(id);
      if (!existsSync(p)) return null;
      const k = readFileSync(p, "utf8").trim();
      if (k) keyCache.set(id, k);
      return k || null;
    },
    async connect({ url, key, name }) {
      const baseUrl = normaliseUrl(url);
      let health: Health;
      try {
        const res = await ctx.fetch(`${baseUrl}/health`, { method: "GET", timeoutMs: 5000 });
        const body = (await readJson(res)) as Partial<Health> | null;
        if (!res.ok || !body) throw new PeerError(502, "PEER_UNREACHABLE", `${baseUrl}/health answered ${res.status}`);
        if (body.service !== SERVICE || !body.machineId)
          throw new PeerError(400, "NOT_LOCAL_STUDIO", `${baseUrl} is not a Local Studio controller (legacy controller or other service)`);
        health = body as Health;
      } catch (e) {
        if (e instanceof PeerError) throw e;
        throw new PeerError(502, "PEER_UNREACHABLE", `${baseUrl}/health: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (health.machineId === ctx.identity.machineId) throw new PeerError(400, "SELF", "that URL is this controller");
      let snapshot: Snapshot;
      try {
        const res = await ctx.fetch(`${baseUrl}/api/snapshot`, { method: "GET", headers: { authorization: `Bearer ${key}` }, timeoutMs: 10_000 });
        if (res.status === 401 || res.status === 403) {
          await res.body?.cancel();
          throw new PeerError(401, "PEER_AUTH", `peer ${health.name} rejected the key (HTTP ${res.status}); nothing was stored`);
        }
        const body = (await readJson(res)) as Snapshot | null;
        if (!res.ok || !body?.machine) throw new PeerError(502, "PEER_SNAPSHOT", `peer snapshot answered ${res.status}`);
        snapshot = body;
      } catch (e) {
        if (e instanceof PeerError) throw e;
        throw new PeerError(502, "PEER_UNREACHABLE", `${baseUrl}/api/snapshot: ${e instanceof Error ? e.message : String(e)}`);
      }
      const adminKey = await ctx
        .fetch(`${baseUrl}/api/keys`, { method: "GET", headers: { authorization: `Bearer ${key}` }, timeoutMs: 5000 })
        .then(async (r) => {
          await r.body?.cancel();
          return r.status === 200;
        })
        .catch(() => false);
      const now = Date.now();
      const existing = ctx.db.query<PeerRow, [string]>("SELECT * FROM peers WHERE machine_id = ?").get(health.machineId);
      const id = existing?.id ?? `peer_${randomBytes(4).toString("hex")}`;
      const row: PeerRow = {
        id,
        machine_id: health.machineId,
        name: name ?? existing?.name ?? health.name,
        base_url: baseUrl,
        added_at: existing?.added_at ?? now,
        last_seen_at: now,
      };
      writeKey(id, key);
      keyCache.set(id, key);
      ctx.db
        .query("INSERT OR REPLACE INTO peers (id, machine_id, name, base_url, added_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(row.id, row.machine_id, row.name, row.base_url, row.added_at, row.last_seen_at);
      return { row, snapshot, health, adminKey };
    },
    remove(id) {
      const n = ctx.db.query("DELETE FROM peers WHERE id = ?").run(id).changes;
      keyCache.delete(id);
      if (n > 0 && /^peer_[0-9a-f]{8}$/.test(id) && existsSync(keyPath(id))) unlinkSync(keyPath(id));
      return n > 0;
    },
    touch(id, at) {
      ctx.db.query("UPDATE peers SET last_seen_at = ? WHERE id = ?").run(at, id);
    },
  };
};
