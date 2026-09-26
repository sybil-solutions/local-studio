import type { ControllerHealth, Percentiles } from "@local-studio/contracts";

const RING = 2048;

class Ring {
  private buf = new Float64Array(RING);
  private n = 0;
  last: number | null = null;
  add(v: number) {
    this.buf[this.n++ % RING] = v;
    this.last = v;
  }
  pct(): Percentiles & { n: number } {
    const k = Math.min(this.n, RING);
    if (!k) return { p50: null, p90: null, p99: null, n: 0 };
    const s = this.buf.slice(0, k).sort();
    const at = (p: number) => Math.round(s[Math.min(k - 1, Math.floor(p * k))]! * 1000) / 1000;
    return { p50: at(0.5), p90: at(0.9), p99: at(0.99), n: this.n };
  }
}

export interface Obs {
  count(name: string, by?: number): void;
  observe(name: string, v: number): void;
  error(where: string, message: string): void;
  gauge(name: string, fn: () => number): void;
  time<T>(name: string, p: Promise<T>): Promise<T>;
  health(): ControllerHealth;
  prom(): string;
  stop(): void;
}

export const createObs = (): Obs => {
  const t0 = Date.now();
  const counters = new Map<string, number>();
  const rings = new Map<string, Ring>();
  const gauges = new Map<string, () => number>();
  const lastErrors: ControllerHealth["lastErrors"] = [];
  const ring = (name: string) => rings.get(name) ?? (rings.set(name, new Ring()), rings.get(name)!);
  let lagMax = 0;
  let tick = performance.now();
  const lagTimer = setInterval(() => {
    const now = performance.now();
    const lag = Math.max(0, now - tick - 500);
    tick = now;
    lagMax = Math.max(lagMax, lag);
    ring("event_loop_lag_ms").add(lag);
  }, 500);
  lagTimer.unref?.();
  const obs: Obs = {
    count: (name, by = 1) => counters.set(name, (counters.get(name) ?? 0) + by),
    observe: (name, v) => ring(name).add(v),
    error(where, message) {
      obs.count(`errors.${where}`);
      lastErrors.unshift({ at: Date.now(), where, message: message.slice(0, 500) });
      lastErrors.length = Math.min(lastErrors.length, 20);
    },
    gauge: (name, fn) => gauges.set(name, fn),
    async time(name, p) {
      const s = performance.now();
      try {
        return await p;
      } finally {
        ring(name).add(performance.now() - s);
      }
    },
    health() {
      const m = process.memoryUsage();
      const g: Record<string, number> = {};
      for (const [k, fn] of gauges) {
        try {
          g[k] = fn();
        } catch {
          g[k] = -1;
        }
      }
      return {
        at: Date.now(),
        uptimeS: Math.round((Date.now() - t0) / 1000),
        pid: process.pid,
        memory: { rssMiB: m.rss / 1048576, heapUsedMiB: m.heapUsed / 1048576, heapTotalMiB: m.heapTotal / 1048576, externalMiB: m.external / 1048576 },
        eventLoopLagMaxMs: lagMax,
        gauges: g,
        counters: Object.fromEntries(counters),
        timings: Object.fromEntries([...rings].map(([k, r]) => [k, { ...r.pct(), last: r.last }])),
        lastErrors,
      };
    },
    prom() {
      const h = obs.health();
      const name = (k: string) => `local_studio_${k.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      const out = [
        `local_studio_uptime_seconds ${h.uptimeS}`,
        `local_studio_rss_bytes ${Math.round(h.memory.rssMiB * 1048576)}`,
        `local_studio_heap_used_bytes ${Math.round(h.memory.heapUsedMiB * 1048576)}`,
        `local_studio_event_loop_lag_max_ms ${h.eventLoopLagMaxMs}`,
      ];
      for (const [k, v] of Object.entries(h.gauges)) out.push(`${name(k)} ${v}`);
      for (const [k, v] of Object.entries(h.counters)) out.push(`${name(k)}_total ${v}`);
      for (const [k, t] of Object.entries(h.timings))
        for (const q of ["p50", "p90", "p99"] as const) if (t[q] !== null) out.push(`${name(k)}{quantile="0.${q.slice(1)}"} ${t[q]}`);
      return `${out.join("\n")}\n`;
    },
    stop: () => clearInterval(lagTimer),
  };
  return obs;
};
