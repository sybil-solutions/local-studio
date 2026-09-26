import { hostname, networkInterfaces } from "node:os";
import type { Machine, RunningModel, Watchdog } from "@local-studio/contracts";
import type { Ctx, LifecycleService, Module, RuntimeService, RuntimeView, Services } from "../context";
import { computeGroups } from "./groups";
import { type HardwareList, scanGpus } from "./gpus";
import { createLifecycle } from "./lifecycle";
import { createProbeCache, healthCheck } from "./probe";
import { discoveryRoutes } from "./routes";
import { attachOwners, fullScan, nextTrack, type ScanState } from "./scan";
import { pool } from "./util";

const FAST_MS = 3000;
const FULL_MS = 15000;
const SCAN_DEADLINE_MS = 60_000;

const deadline = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`${what} exceeded ${ms} ms`)), ms)))]).finally(() => clearTimeout(t));
};

export const createDiscovery = (ctx: Ctx, svc: Services): Module<{ runtime: RuntimeService; lifecycle: LifecycleService }> => {
  let view: RuntimeView = { gpus: [], groups: [], models: [], endpoints: [], discovery: { lastScanAt: null, scanMs: null, docker: "absent", errors: [] } };
  let watchdogs: Watchdog[] = [];
  let pidOwner = new Map<number, string>();
  const st: ScanState = { tracks: new Map(), cacheInfo: new Map(), stopping: new Set(), probes: createProbeCache() };
  let scanning: Promise<RuntimeView> | null = null;
  let fastBusy = false;
  let timers: ReturnType<typeof setInterval>[] = [];

  let hw: HardwareList | null = null;
  let hwAt = 0;
  let hwPending = false;
  const hardware = (): HardwareList | null => {
    if (!hw && !hwPending && Date.now() - hwAt > 60000) {
      hwPending = true;
      hwAt = Date.now();
      Promise.resolve()
        .then(() => svc.recipes?.catalog())
        .then((c) => {
          if (c?.hardware?.length) hw = c.hardware;
        })
        .catch(() => {})
        .finally(() => {
          hwPending = false;
        });
    }
    return hw;
  };

  const isThisMachine = (host: string): boolean => {
    const h = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (h === "localhost" || h === "0.0.0.0" || h === "::" || h === "::1" || h.startsWith("127.")) return true;
    const me = hostname().toLowerCase();
    if (h === me || h.split(".")[0] === me.split(".")[0]) return true;
    return Object.values(networkInterfaces()).some((list) => (list ?? []).some((a) => a.address.toLowerCase() === h));
  };

  const excluded = (): Set<number> => {
    const s = new Set<number>([ctx.config.port]);
    for (const p of svc.peers?.list() ?? []) {
      try {
        const u = new URL(p.baseUrl);
        if (isThisMachine(u.hostname)) s.add(Number(u.port || (u.protocol === "https:" ? 443 : 80)));
      } catch {}
    }
    return s;
  };

  const publish = (v: RuntimeView) => {
    view = v;
  };

  const rescan = (): Promise<RuntimeView> => {
    if (scanning) return scanning;
    scanning = (async () => {
      const t = performance.now();
      try {
        const r = await deadline(fullScan(ctx, st, hardware(), excluded()), SCAN_DEADLINE_MS, "full scan");
        watchdogs = r.watchdogs;
        pidOwner = r.pidOwner;
        publish(r.view);
        return r.view;
      } catch (e) {
        ctx.log.warn(`discovery scan failed: ${String(e)}`, "scan.full");
        publish({ ...view, discovery: { ...view.discovery, lastScanAt: Date.now(), errors: [String(e)] } });
        return view;
      } finally {
        ctx.obs.observe("scan.full_ms", performance.now() - t);
        scanning = null;
      }
    })();
    return scanning;
  };

  const fast = async () => {
    if (fastBusy || scanning) return;
    fastBusy = true;
    const started = performance.now();
    try {
      const gs = await scanGpus(ctx, hardware());
      const known = new Set(pidOwner.keys());
      const newPid = gs.apps.some((a) => !known.has(a.pid) && !view.gpus.some((g) => g.processes.some((p) => p.pid === a.pid)));
      const gonePid = [...known].some((pid) => !gs.apps.some((a) => a.pid === pid));
      attachOwners(gs.gpus, pidOwner);
      const models: RunningModel[] = await deadline(pool(view.models, 8, async (m) => {
        const h = await healthCheck(ctx, m.baseUrl, m.state === "ready");
        const prev = st.tracks.get(m.id);
        const t = nextTrack(prev, prev?.lifeKey ?? m.id, h.ok, m.startedAt, st.stopping.has(m.id), h.note);
        st.tracks.set(m.id, t);
        const owned = gs.apps.filter((a) => pidOwner.get(a.pid) === m.id);
        return {
          ...m,
          state: t.state,
          stateSince: t.since,
          servedModels: h.models?.length ? h.models.map((x) => x.id) : m.servedModels,
          vramUsedMiB: owned.length && owned.every((a) => a.usedMiB !== null) ? owned.reduce((s, a) => s + (a.usedMiB ?? 0), 0) : m.vramUsedMiB,
          error: t.state === "unhealthy" ? t.note || "unhealthy" : null,
        };
      }), 20_000, "health checks");
      const stateChanged = models.some((m, i) => m.state !== view.models[i]?.state);
      publish({ ...view, gpus: gs.gpus.length ? gs.gpus : view.gpus, models, groups: computeGroups(gs.gpus.length ? gs.gpus : view.gpus, models) });
      if (newPid || gonePid || (stateChanged && models.some((m) => m.state === "ready" && !m.cache))) void rescan();
    } catch (e) {
      ctx.log.warn(`discovery fast loop: ${String(e)}`, "scan.fast");
    } finally {
      ctx.obs.observe("scan.fast_ms", performance.now() - started);
      fastBusy = false;
    }
  };

  const setStopping = (id: string, on: boolean) => {
    if (on) st.stopping.add(id);
    else st.stopping.delete(id);
    const models = view.models.map((m) => (m.id === id && on ? { ...m, state: "stopping" as const, stateSince: Date.now() } : m));
    publish({ ...view, models, groups: computeGroups(view.gpus, models) });
  };

  const runtime: RuntimeService = {
    view: () => view,
    machine: (): Machine => ({
      machineId: ctx.identity.machineId,
      name: ctx.identity.name,
      hostname: ctx.identity.hostname,
      platform: ctx.config.platform,
      version: ctx.config.version,
      url: ctx.config.publicUrl,
      self: true,
      online: true,
      lastSeenAt: Date.now(),
      readOnly: ctx.config.readOnly,
      watchdogs,
    }),
    models: () => view.models,
    model: (id) => view.models.find((m) => m.id === id),
    resolveServed: (name) => {
      const n = name.trim().toLowerCase();
      return view.models.find((m) => m.state === "ready" && m.servedModels.some((s) => s.toLowerCase() === n));
    },
    rescan,
  };

  const lifecycle = createLifecycle({ ctx, svc, view: () => view, rescan, setStopping });

  return {
    service: { runtime, lifecycle },
    routes: discoveryRoutes(runtime, lifecycle),
    start() {
      void rescan();
      timers = [setInterval(() => void fast(), FAST_MS), setInterval(() => void rescan(), FULL_MS)];
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers = [];
    },
  };
};
