import type { Activity, ControllerHealth, EngineRates, FleetSnapshot, Gpu, HourlyRow, LaunchProgress, RecipeRow, RunningModel, Snapshot, TtftHour } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";

export type Mark = "" | "ready" | "busy" | "failed";

export interface MachineView {
  id: string;
  peerId: string | null;
  name: string;
  self: boolean;
  online: boolean;
  readOnly: boolean;
  gpuSummary: string;
  mark: Mark;
  error: string | null;
  snap: Snapshot | null;
}

export interface Group {
  id: string;
  name: string;
  pod: boolean;
  ms: MachineView[];
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const ACTIVE: LaunchProgress["phase"][] = ["planning", "weights", "pulling", "starting", "loading"];

export const parseDay = (s: string | number | null | undefined): Date | null => {
  if (s === null || s === undefined || s === "") return null;
  if (typeof s === "number") return new Date(s < 1e12 ? s * 1000 : s);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
};

export const fmtFormat = (f: string | null | undefined): string => (f ?? "").replace(/ · /g, " ");

export const shortGpu = (g: Gpu): string => (g.name || g.product).replace(/^(NVIDIA GeForce |NVIDIA |Intel |AMD Radeon |AMD )/, "").replace(/ (Workstation|Server) Edition$/, "");

export const markOf = (s: Snapshot | null, launches: LaunchProgress[]): Mark => {
  if (!s) return "";
  if (launches.some((l) => l.phase === "failed") || s.models.some((m) => m.state === "unhealthy")) return "failed";
  if (launches.some((l) => ACTIVE.includes(l.phase)) || s.models.some((m) => m.state === "loading" || m.state === "stopping")) return "busy";
  return s.models.some((m) => m.state === "ready") ? "ready" : "";
};

export const launchesFor = (s: Snapshot | null, live: Record<string, LaunchProgress>, selfId: string | null): LaunchProgress[] => {
  const map = new Map<string, LaunchProgress>();
  for (const l of s?.launches ?? []) map.set(l.launchId, l);
  if (s && s.machine.machineId === selfId)
    for (const l of Object.values(live)) {
      const prev = map.get(l.launchId);
      if (!prev || prev.updatedAt <= l.updatedAt) map.set(l.launchId, l);
    }
  return [...map.values()].sort((a, b) => b.startedAt - a.startedAt);
};

export const gpuLine = (gpus: Gpu[]): string => {
  const by = new Map<string, number>();
  for (const g of gpus) by.set(shortGpu(g), (by.get(shortGpu(g)) ?? 0) + 1);
  return [...by.entries()].map(([n, c]) => (c > 1 ? `${c} × ${n}` : n)).join(", ");
};

export const machines = (f: FleetSnapshot | null, live: Record<string, LaunchProgress>): MachineView[] =>
  (f?.machines ?? []).map((m) => {
    const s = m.snapshot;
    const peer = f?.peers.find((p) => p.id === m.peerId);
    return {
      id: m.machineId,
      peerId: m.peerId,
      name: s?.machine.name ?? peer?.name ?? m.machineId,
      self: m.machineId === f?.self && m.peerId === null,
      online: m.online,
      readOnly: s?.machine.readOnly ?? false,
      gpuSummary: s ? gpuLine(s.gpus) || "no GPU" : "–",
      mark: m.online ? markOf(s, launchesFor(s, live, f?.self ?? null)) : "failed",
      error: m.error ?? peer?.error ?? null,
      snap: s,
    };
  });

const podKey = (name: string) => /^(.+)-[0-9a-f]{3,4}$/.exec(name)?.[1] ?? null;

export const groups = (ms: MachineView[]): Group[] => {
  const count = new Map<string, number>();
  for (const m of ms) {
    const k = podKey(m.name);
    if (k) count.set(k, (count.get(k) ?? 0) + 1);
  }
  const out: Group[] = [];
  for (const m of ms) {
    const k = podKey(m.name);
    if (k && (count.get(k) ?? 0) > 1) {
      const g = out.find((x) => x.id === `pod:${k}`);
      if (g) g.ms.push(m);
      else out.push({ id: `pod:${k}`, name: `${k} pod`, pod: true, ms: [m] });
    } else out.push({ id: m.id, name: m.name, pod: false, ms: [m] });
  }
  return out;
};

export const groupMark = (ms: MachineView[]): Mark =>
  ms.some((m) => m.mark === "failed") ? "failed" : ms.some((m) => m.mark === "busy") ? "busy" : ms.some((m) => m.mark === "ready") ? "ready" : "";

export const sumActivity = (f: FleetSnapshot | null): Activity | null => {
  if (!f) return null;
  if (f.activity && f.activity.requests > 0) return f.activity;
  const list = f.machines.map((m) => m.snapshot?.activity).filter((a): a is Activity => !!a && a.requests > 0);
  if (!list.length) return f.activity ?? null;
  const base = list[0]!;
  const same = list.filter((a) => a.start === base.start && a.days.length === base.days.length);
  const sinces = same.map((a) => a.since).filter((x): x is string => !!x).sort();
  return {
    ...base,
    days: base.days.map((_, i) => same.reduce((t, a) => t + (a.days[i] ?? 0), 0)),
    requests: same.reduce((t, a) => t + a.requests, 0),
    total: same.reduce((t, a) => t + a.total, 0),
    week: same.reduce((t, a) => t + a.week, 0),
    since: sinces[0] ?? null,
  };
};

export interface LifeView {
  months: { col: number; label: string }[];
  cells: number[];
  labels: string[];
}

export const life = (a: Activity): LifeView => {
  const days = a.days ?? [];
  const top = Math.max(1, ...days);
  const start = parseDay(a.start) ?? new Date();
  const months: { col: number; label: string }[] = [];
  let last = -1;
  for (let c = 0; c * 7 < days.length; c++) {
    const d = new Date(start);
    d.setDate(d.getDate() + c * 7);
    if (d.getMonth() !== last) months.push({ col: c, label: MONTHS[d.getMonth()]! });
    last = d.getMonth();
  }
  if (months.length > 1 && months[1]!.col < 3) months.shift();
  return {
    months,
    cells: days.map((v, i) => (i > a.today ? -1 : v > 0 ? Math.min(4, Math.ceil((v / top) * 4)) : 0)),
    labels: days.map((v, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}  ${v > 0 ? `${fmt.k(v)} tokens` : "–"}`;
    }),
  };
};

export const engineFor = (s: Snapshot, id: string, live: Record<string, EngineRates>, self: boolean): EngineRates | null => (self ? live[id] : undefined) ?? s.engines.find((e) => e.modelId === id) ?? null;

export const tpsOf = (e: EngineRates | null): number | null => e?.generationTpsWall ?? e?.decodeTps ?? null;

export const homeDir = (d: string): string => d.replace(/^\/(home|Users)\/[^/]+/, "~");

export interface Agg {
  memUsed: number | null;
  memTotal: number;
  util: number | null;
  models: string[];
  tps: number | null;
}

const total = (xs: (number | null)[]): number | null => (xs.some((x) => x !== null) ? xs.reduce<number>((t, x) => t + (x ?? 0), 0) : null);

export const aggOf = (ms: MachineView[], live: Record<string, EngineRates>): Agg => {
  const gs = ms.flatMap((m) => (m.online ? (m.snap?.gpus ?? []) : []));
  const utils = gs.map((g) => g.utilPct).filter((x): x is number => x !== null);
  const rates = ms.flatMap((m) => (m.snap && m.online ? m.snap.models.filter((x) => x.state === "ready").map((x) => tpsOf(engineFor(m.snap!, x.id, live, m.self))) : []));
  return {
    memUsed: gs.length && gs.every((g) => g.memUsedMiB !== null) ? gs.reduce((t, g) => t + (g.memUsedMiB ?? 0), 0) : null,
    memTotal: gs.reduce((t, g) => t + g.memTotalMiB, 0),
    util: utils.length ? utils.reduce((t, x) => t + x, 0) / utils.length : null,
    models: ms.flatMap((m) => (m.online ? (m.snap?.models ?? []).map((x) => x.primaryModel || x.id) : [])),
    tps: total(rates),
  };
};

export const vram = (a: { memUsed: number | null; memTotal: number }) => (a.memTotal <= 0 ? "–" : `${a.memUsed !== null ? `${Math.round(a.memUsed / 1024)}/` : ""}${Math.round(a.memTotal / 1024)}G`);

export const gpuMem = (g: Gpu) => vram({ memUsed: g.memUsedMiB, memTotal: g.memTotalMiB });

export const holder = (g: Gpu, s: Snapshot): { text: string; state: "free" | "model" | "foreign" } => {
  const gr = s.groups.find((x) => x.gpuKeys.includes(g.key));
  const names = (gr?.modelIds ?? []).map((id) => s.models.find((m) => m.id === id)?.primaryModel ?? id);
  if (names.length) return { text: names.join(", "), state: "model" };
  if (gr?.state === "foreign" || gr?.state === "busy") return { text: "other program", state: "foreign" };
  return { text: "", state: "free" };
};

export interface HourBucket {
  at: number;
  requests: number;
  errors: number;
  fresh: number;
  cached: number;
  out: number;
  decodeTokens: number;
  decodeMs: number;
  hist: number[];
}

export const hourBuckets = (rows: HourlyRow[], ttft: TtftHour[], now: number): HourBucket[] => {
  const start = Math.floor(now / 3_600_000) * 3_600_000 - 23 * 3_600_000;
  const out: HourBucket[] = Array.from({ length: 24 }, (_, i) => ({ at: start + i * 3_600_000, requests: 0, errors: 0, fresh: 0, cached: 0, out: 0, decodeTokens: 0, decodeMs: 0, hist: [] }));
  const at = (hour: number) => out[Math.round((hour - start) / 3_600_000)];
  for (const r of rows) {
    const b = at(r.hour);
    if (!b) continue;
    b.requests += r.requests ?? 0;
    b.errors += r.errors ?? 0;
    b.fresh += (r.inputUncached ?? 0) + (r.cacheWrite ?? 0);
    b.cached += r.cacheRead ?? 0;
    b.out += r.output ?? 0;
    b.decodeTokens += r.decodeTokens ?? 0;
    b.decodeMs += r.decodeMs ?? 0;
  }
  for (const t of ttft) {
    const b = at(t.hour);
    if (b) b.hist = (Array.isArray(t.hist) ? t.hist : []).map((x, i) => x + (b.hist[i] ?? 0));
  }
  return out;
};

export const isYours = (r: RecipeRow): boolean => r.origin === "yours" || r.source === "local" || !!r.assigned;

export const localFit = (r: RecipeRow, sel: { s: Snapshot; keys: string[] }[]): string[] | null => {
  if (r.fit === "no-hardware" || sel.length !== (r.machines ?? 1)) return null;
  const stops: string[] = [];
  for (const { s, keys } of sel) {
    const gs = s.gpus.filter((g) => keys.includes(g.key));
    if (gs.length !== r.cards || !gs.every((g) => g.hardwareId === r.hardwareId)) return null;
    for (const g of gs) {
      const h = holder(g, s);
      if (h.state === "foreign") return null;
      if (h.text && !stops.includes(h.text)) stops.push(h.text);
    }
  }
  return stops;
};

export interface EventLine {
  at: number;
  src: string;
  msg: string;
  alert: boolean;
}

export const events = (m: MachineView, health: ControllerHealth | null, live: Record<string, LaunchProgress>, selfId: string | null): EventLine[] => {
  const out: EventLine[] = [];
  for (const e of health?.lastErrors ?? []) out.push({ at: e.at, src: e.where, msg: e.message.split("\n")[0] ?? "", alert: true });
  for (const l of launchesFor(m.snap, live, selfId)) out.push({ at: l.updatedAt, src: l.recipeId, msg: l.error ?? `${l.phase}${l.detail ? ` ${l.detail}` : ""}`, alert: l.phase === "failed" });
  for (const x of m.snap?.models ?? []) if (x.state === "unhealthy") out.push({ at: m.snap!.at, src: x.primaryModel || x.id, msg: x.error ?? "unhealthy", alert: true });
  for (const e of m.snap?.discovery.errors ?? []) out.push({ at: m.snap!.discovery.lastScanAt ?? m.snap!.at, src: "discovery", msg: e, alert: true });
  return out.sort((a, b) => b.at - a.at).slice(0, 8);
};

export const served = (m: RunningModel): string => m.servedModels[0] ?? m.primaryModel ?? m.id;
