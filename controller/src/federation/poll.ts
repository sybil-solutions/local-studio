import { type Snapshot, normalizeSnapshot } from "@local-studio/contracts";
import type { Ctx } from "../context";
import { snapshotKey } from "../core/snapshot";
import type { PeerState, PeerStore } from "./peers";
import { toPeer } from "./peers";

const POLL_MS = 3000;
const TIMEOUT_MS = 2000;
const OFFLINE_AFTER = 3;
const PERSIST_EVERY_MS = 30_000;

export interface Poller {
  states: Map<string, PeerState>;
  sync(): void;
  pollOne(id: string): Promise<void>;
  start(): void;
  stop(): void;
  onChange(fn: () => void): void;
}

export const createPoller = (ctx: Ctx, store: PeerStore): Poller => {
  const states = new Map<string, PeerState>();
  const inflight = new Set<string>();
  const listeners: (() => void)[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let fleetDirty = false;

  const sync = () => {
    const rows = store.all();
    const ids = new Set(rows.map((r) => r.id));
    for (const id of [...states.keys()]) if (!ids.has(id)) states.delete(id);
    for (const row of rows) {
      const s = states.get(row.id);
      if (s) s.row = row;
      else
        states.set(row.id, {
          row,
          online: false,
          misses: 0,
          version: null,
          error: null,
          snapshot: null,
          snapshotKey: "",
          persistedSeenAt: row.last_seen_at ?? 0,
        });
    }
  };

  const flush = () => {
    if (!fleetDirty) return;
    fleetDirty = false;
    for (const fn of listeners) fn();
  };

  const pollOne = async (id: string) => {
    const s = states.get(id);
    if (!s || inflight.has(id)) return;
    const key = store.keyFor(id);
    inflight.add(id);
    const before = { online: s.online, error: s.error, version: s.version };
    try {
      if (!key) throw new Error("no stored key for this peer");
      const res = await ctx.fetch(`${s.row.base_url}/api/snapshot`, {
        method: "GET",
        headers: { authorization: `Bearer ${key}`, "x-local-studio-via": ctx.identity.machineId },
        timeoutMs: TIMEOUT_MS,
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(res.status === 401 || res.status === 403 ? `peer rejected the stored key (HTTP ${res.status})` : `HTTP ${res.status}`);
      }
      const snap = normalizeSnapshot((await res.json()) as Snapshot);
      if (!snap) throw new Error("peer snapshot is malformed");
      if (!states.has(id)) return;
      const now = Date.now();
      s.misses = 0;
      s.online = true;
      s.error = null;
      s.version = snap.machine?.version ?? null;
      s.row.last_seen_at = now;
      if (now - s.persistedSeenAt > PERSIST_EVERY_MS) {
        s.persistedSeenAt = now;
        store.touch(id, now);
      }
      const k = snapshotKey(snap);
      s.snapshot = snap;
      if (k !== s.snapshotKey) {
        s.snapshotKey = k;
        fleetDirty = true;
      }
    } catch (e) {
      if (!states.has(id)) return;
      s.misses += 1;
      const msg = e instanceof Error ? (e.name === "TimeoutError" ? `no answer within ${TIMEOUT_MS} ms` : e.message) : String(e);
      if (s.misses >= OFFLINE_AFTER) {
        s.online = false;
        s.error = msg;
      }
    } finally {
      inflight.delete(id);
    }
    if (before.online !== s.online || before.error !== s.error || before.version !== s.version) {
      fleetDirty = true;
      ctx.bus.emit({ type: "peer", data: toPeer(s) });
      if (before.online !== s.online) ctx.log.info(`peer ${s.row.name} (${s.row.id}) ${s.online ? "online" : `offline: ${s.error}`}`);
    }
  };

  const round = async () => {
    if (!states.size) return;
    await ctx.obs.time("federation.poll_ms", Promise.all([...states.keys()].map(pollOne)));
    flush();
  };

  return {
    states,
    sync,
    async pollOne(id) {
      await pollOne(id);
      flush();
    },
    start() {
      sync();
      void round();
      timer = setInterval(() => void round(), POLL_MS);
    },
    stop() {
      clearInterval(timer);
    },
    onChange(fn) {
      listeners.push(fn);
    },
  };
};
