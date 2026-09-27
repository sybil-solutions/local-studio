import type { Activity, EngineRates, FleetSnapshot, Gpu, HourlyRow, TtftHour, LaunchProgress, ModelCardStats, RecipeRow, RunningModel, Snapshot } from "@local-studio/contracts/client";
import { fmt, kvDtypeOf, quantOf } from "@local-studio/contracts/client";

export type Mark = "" | "ready" | "busy" | "failed";
export type Family = "qwen" | "lfm" | "hf" | null;
export interface Chip {
  icon?: string;
  text: string;
}

export interface MachineView {
  id: string;
  peerId: string | null;
  name: string;
  self: boolean;
  online: boolean;
  readOnly: boolean;
  watchdogs: string[];
  gpuCount: number;
  gpuSummary: string;
  mark: Mark;
  error: string | null;
  snap: Snapshot | null;
}

export interface CardView {
  key: string;
  machine: string;
  machineId: string;
  peerId: string | null;
  modelId: string | null;
  launchId: string | null;
  embedding: boolean;
  modality: "chat" | "embedding" | "stt" | "tts";
  endpoint: string | null;
  stopBlocked: string | null;
  name: string;
  family: Family;
  gpu: string;
  mem: string;
  line: number[];
  chips: Chip[];
  figs: { total: string; decode: string; prefill: string } | null;
  ready: boolean;
  sub: string;
  subAlert: boolean;
  progress: number | null;
  readOnly: boolean;
  watchdog: string | null;
  servedModel: string | null;
  stack: string;
  stackFrom: string | null;
}

export interface LifeView {
  tokens: string;
  requests: string;
  since: string;
  months: { col: number; label: string }[];
  cells: number[];
  labels: string[];
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ACTIVE: LaunchProgress["phase"][] = ["planning", "weights", "pulling", "starting", "loading"];

export const family = (name: string | null | undefined): Family => {
  const n = (name ?? "").toLowerCase();
  if (n.includes("qwen")) return "qwen";
  if (n.includes("lfm")) return "lfm";
  return null;
};

export const parseDay = (s: string | number | null | undefined): Date | null => {
  if (s === null || s === undefined || s === "") return null;
  if (typeof s === "number") return new Date(s < 1e12 ? s * 1000 : s);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
};

export const dayLabel = (s: string | number | null | undefined): string => {
  const d = parseDay(s);
  if (!d) return typeof s === "string" ? s : "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
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

const gpuCountLine = (gpus: Gpu[]): string => {
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
      watchdogs: (s?.machine.watchdogs ?? []).map((w) => w.name),
      gpuCount: s?.gpus.length ?? 0,
      gpuSummary: s ? gpuCountLine(s.gpus) || "no GPU" : "–",
      mark: markOf(s, launchesFor(s, live, f?.self ?? null)),
      error: m.error ?? peer?.error ?? null,
      snap: s,
    };
  });

export const sumActivity = (f: FleetSnapshot | null): Activity | null => {
  if (!f) return null;
  if (f.activity && f.activity.requests > 0) return f.activity;
  const list = f.machines.map((m) => m.snapshot?.activity).filter((a): a is Activity => !!a && a.requests > 0);
  if (!list.length) return f.activity ?? null;
  const base = list[0]!;
  const same = list.filter((a) => a.start === base.start && a.days.length === base.days.length);
  const days = base.days.map((_, i) => same.reduce((t, a) => t + (a.days[i] ?? 0), 0));
  const sinces = same.map((a) => a.since).filter((x): x is string => !!x).sort();
  const lasts = same.map((a) => a.last).filter((x): x is number => x !== null);
  return {
    ...base,
    days,
    requests: same.reduce((t, a) => t + a.requests, 0),
    total: same.reduce((t, a) => t + a.total, 0),
    week: same.reduce((t, a) => t + a.week, 0),
    since: sinces[0] ?? null,
    last: lasts.length ? Math.max(...lasts) : null,
  };
};

export const life = (a: Activity): LifeView => {
  const days = a.days ?? [];
  const top = Math.max(1, ...days);
  const start = parseDay(a.start) ?? new Date();
  const months: { col: number; label: string }[] = [];
  let last = -1;
  for (let c = 0; c * 7 < days.length; c++) {
    const d = new Date(start);
    d.setDate(d.getDate() + c * 7);
    const m = d.getMonth();
    if (m !== last) months.push({ col: c, label: MONTHS[m]! });
    last = m;
  }
  if (months.length > 1 && months[1]!.col < 3) months.shift();
  return {
    tokens: `${fmt.k(a.total)} tokens`,
    requests: `${fmt.k(a.requests)} ${a.requests === 1 ? "request" : "requests"}`,
    since: a.since ? `since ${dayLabel(a.since)}` : "",
    months,
    cells: days.map((v, i) => (i > a.today ? -1 : v > 0 ? Math.min(4, Math.ceil((v / top) * 4)) : 0)),
    labels: days.map((v, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}  ${v > 0 ? `${fmt.k(v)} tokens` : "no tokens"}`;
    }),
  };
};

/** Used VRAM in MiB. Unknown usage on a GPU that nothing holds (no process, no model, not foreign) counts as 0. */
export const usedMiB = (g: Gpu, s: Snapshot | null): number | null => {
  if (g.memUsedMiB !== null) return g.memUsedMiB;
  const gr = s?.groups.find((x) => x.gpuKeys.includes(g.key));
  return !g.unified && g.processes.length === 0 && (!gr || gr.state === "available") ? 0 : null;
};

const memLine = (cards: Gpu[], s: Snapshot): string => {
  if (!cards.length) return "";
  const total = cards.reduce((t, g) => t + g.memTotalMiB, 0);
  const used = cards.map((g) => usedMiB(g, s));
  const known = used.every((x) => x !== null);
  return `${known ? (used.reduce<number>((t, x) => t + (x ?? 0), 0) / 1024).toFixed(1) : "?"} / ${fmt.gb(total)}`;
};

const gpuLine = (cards: Gpu[]): string => (cards.length > 1 ? `${cards.length} × ${shortGpu(cards[0]!)}` : cards[0] ? shortGpu(cards[0]) : "GPU");

const statsFor = (s: Snapshot, id: string): ModelCardStats | null => s.cards.find((c) => c.modelId === id) ?? null;

export const engineFor = (s: Snapshot, id: string, live: Record<string, EngineRates>, self: boolean): EngineRates | null => (self ? live[id] : undefined) ?? s.engines.find((e) => e.modelId === id) ?? null;

const speedChip = (st: ModelCardStats | null, engine: EngineRates | null): Chip[] => {
  if (st?.decodeTps != null) return [{ icon: "speed", text: `${fmt.tps(st.decodeTps)} tok/s` }];
  if (engine?.decodeTps != null) return [{ icon: "speed", text: `${fmt.tps(engine.decodeTps)} tok/s engine` }];
  return [];
};

export const stackOf = (m: RunningModel): string => {
  const q = quantOf(m);
  const kv = kvDtypeOf(m);
  return [`${m.engine}${m.engineVersion ? ` ${m.engineVersion.split("+")[0]}` : ""}`, q.label ?? "quant –", `kv ${kv ?? "–"}`].join(" · ");
};

export const stackSource = (m: RunningModel): string | null => {
  const q = quantOf(m);
  return q.from ? `quant from ${q.from === "flag" ? "--quantization" : q.from === "config" ? "config.json" : "the model name"}` : null;
};

export interface Res {
  free: number | null;
  total: number | null;
}

export interface MachineRes {
  vram: Res | null;
  unified: Res | null;
  ram: Res;
  disk: Res;
}

export const resOf = (m: MachineView): MachineRes => {
  const s = m.snap;
  const on = m.online;
  const gs = s?.gpus ?? [];
  const dis = gs.filter((g) => !g.unified);
  const uni = gs.filter((g) => g.unified);
  const h = s?.host ?? null;
  const known = dis.filter((g) => usedMiB(g, s) !== null);
  const u = uni[0];
  const ram: Res = h
    ? { total: h.mem.totalMiB, free: on && h.mem.usedMiB !== null ? h.mem.totalMiB - h.mem.usedMiB : null }
    : u
      ? { total: u.memTotalMiB, free: on && u.memUsedMiB !== null ? u.memTotalMiB - u.memUsedMiB : null }
      : { total: null, free: null };
  return {
    vram: dis.length ? { total: dis.reduce((t, g) => t + g.memTotalMiB, 0), free: on && known.length ? known.reduce((t, g) => t + g.memTotalMiB - (usedMiB(g, s) ?? 0), 0) : null } : null,
    unified: uni.length ? ram : null,
    ram,
    disk: { total: h?.storage?.totalMiB ?? null, free: on && h?.storage ? h.storage.totalMiB - h.storage.usedMiB : null },
  };
};

export const sumRes = (rs: (Res | null)[]): Res & { known: number; of: number } => {
  const all = rs.filter((r): r is Res => !!r && r.total !== null);
  const k = all.filter((r) => r.free !== null);
  return { free: k.length ? k.reduce((t, r) => t + r.free!, 0) : null, total: k.length ? k.reduce((t, r) => t + r.total!, 0) : null, known: k.length, of: all.length };
};

export const resText = (r: Res | null): string => {
  if (!r || r.total === null || r.total <= 0) return "–";
  const tb = r.total >= 1024 * 1024;
  const u = (x: number) => (tb ? x / 1024 / 1024 : x / 1024);
  const n = (x: number) => (tb || u(x) < 10 ? u(x).toFixed(1) : String(Math.round(u(x))));
  return `${r.free === null ? "–" : n(r.free)} / ${n(r.total)} ${tb ? "TB" : "GB"}`;
};

/** Headline "free / total" figure for VRAM, RAM or disk across machines. */
export const resFig = (ms: MachineView[], k: keyof MachineRes): { v: string; k: string } => {
  const t = sumRes(ms.map((m) => resOf(m)[k]));
  return { v: resText(t), k: `${k} free${t.known < t.of ? ` · ${t.known}/${t.of}` : ""}` };
};

export const cardOf = (mv: MachineView, s: Snapshot, m: RunningModel, launch: LaunchProgress | null, engine: EngineRates | null = null): CardView => {
  const cards = s.gpus.filter((g) => m.gpuKeys.includes(g.key));
  const st = statsFor(s, m.id);
  const ready = m.state === "ready";
  const pct = launch?.percent ?? null;
  const sub =
    m.state === "unhealthy"
      ? `not answering${m.error ? ` · ${m.error}` : ""}`
      : m.state === "stopping"
        ? "stopping"
        : `${launch?.detail || "loading"}${pct !== null ? ` · ${Math.round(pct)}%` : ""}`;
  return {
    key: `${mv.id}/${m.id}`,
    machine: mv.name,
    machineId: mv.id,
    peerId: mv.peerId,
    modelId: m.id,
    launchId: launch?.launchId ?? null,
    embedding: m.embedding,
    modality: m.modality ?? (m.embedding ? "embedding" : "chat"),
    endpoint: m.baseUrl ?? null,
    stopBlocked: m.stopBlocked,
    name: m.primaryModel || m.id,
    family: family(m.primaryModel),
    gpu: cards.length ? gpuLine(cards) : `${m.engine} · :${m.port}`,
    mem: ready || m.state === "unhealthy" ? memLine(cards, s) : "",
    line: st?.line ?? [],
    chips: !ready
      ? []
      : m.embedding
        ? [{ text: "embedding" }]
        : [...speedChip(st, engine), ...(st?.allTokens ? [{ icon: "tokens", text: fmt.k(st.allTokens) }] : [])],
    figs: ready
      ? {
          total: st?.allTokens ? fmt.k(st.allTokens) : "–",
          decode: (st?.decodeTps ?? engine?.decodeTps) != null ? fmt.tps((st?.decodeTps ?? engine?.decodeTps)!) : "–",
          prefill: (st?.prefillTps ?? engine?.prefillTps) != null ? fmt.tps((st?.prefillTps ?? engine?.prefillTps)!) : "–",
        }
      : null,
    ready,
    sub: ready ? "" : sub,
    subAlert: m.state === "unhealthy",
    progress: !ready && m.state === "loading" && pct !== null ? pct : null,
    readOnly: mv.readOnly,
    watchdog: m.watchdog,
    servedModel: m.servedModels[0] ?? m.primaryModel,
    stack: stackOf(m),
    stackFrom: stackSource(m),
  };
};

const launchCard = (mv: MachineView, s: Snapshot, l: LaunchProgress, recipes: RecipeRow[] | null): CardView => {
  const r = recipes?.find((x) => x.id === l.recipeId);
  return {
    key: `${mv.id}/launch/${l.launchId}`,
    machine: mv.name,
    machineId: mv.id,
    peerId: mv.peerId,
    modelId: null,
    launchId: l.launchId,
    embedding: false,
    modality: "chat",
    endpoint: null,
    stopBlocked: null,
    name: r?.name ?? l.recipeId,
    family: family(r?.family ?? r?.name ?? l.recipeId),
    gpu: r ? `${r.cards > 1 ? `${r.cards} × ` : ""}${shortGpu(s.gpus.find((g) => g.hardwareId === r.hardwareId) ?? s.gpus[0]!) }` : "",
    mem: "",
    line: [],
    chips: [],
    figs: null,
    ready: false,
    sub: `${l.phase}${l.detail ? ` · ${l.detail}` : ""}${l.percent !== null ? ` · ${Math.round(l.percent)}%` : ""}`,
    subAlert: false,
    progress: l.percent,
    readOnly: mv.readOnly,
    watchdog: null,
    servedModel: r?.servedName ?? null,
    stack: "",
    stackFrom: null,
  };
};

export const homeCards = (
  ms: MachineView[],
  live: Record<string, LaunchProgress>,
  selfId: string | null,
  recipes: Record<string, RecipeRow[] | null>,
  engines: Record<string, EngineRates> = {},
): CardView[] => {
  const ready: CardView[] = [];
  const working: CardView[] = [];
  for (const mv of ms) {
    const s = mv.snap;
    if (!s || !mv.online) continue;
    const ls = launchesFor(s, live, selfId);
    for (const m of s.models) {
      const l = ls.find((x) => x.modelId === m.id && ACTIVE.includes(x.phase)) ?? null;
      (m.state === "ready" ? ready : working).push(cardOf(mv, s, m, l, engineFor(s, m.id, engines, mv.self)));
    }
    for (const l of ls) if (ACTIVE.includes(l.phase) && !s.models.some((m) => m.id === l.modelId) && s.gpus.length) working.push(launchCard(mv, s, l, recipes[mv.id] ?? null));
  }
  return [...ready, ...working];
};

export interface GpuRowView {
  key: string;
  name: string;
  pct: number | null;
  mem: string;
  temp: string;
  status: string;
  statusAlert: boolean;
}

export const gpuRow = (g: Gpu, s: Snapshot | null): GpuRowView => {
  const u = usedMiB(g, s);
  const used = u !== null ? u / 1024 : null;
  const total = g.memTotalMiB;
  const mem = total <= 0 ? "–" : `${used !== null ? used.toFixed(1) : "?"} / ${fmt.gb(total)}`;
  const temp = g.tempC !== null ? `${Math.round(g.tempC)}°` : "";
  const gr = s?.groups.find((x) => x.gpuKeys.includes(g.key));
  const names = (gr?.modelIds ?? []).map((id) => s?.models.find((m) => m.id === id)?.primaryModel ?? id);
  const verb = gr?.state === "busy" ? "busy" : "running";
  const grouped = gr && gr.gpuKeys.length > 1 ? ` · group of ${gr.gpuKeys.length}` : "";
  const status = names.length ? `${verb} ${names.join(", ")}${grouped}` : gr?.state === "foreign" ? "other program" : "";
  return {
    key: g.key,
    name: shortGpu(g),
    pct: u !== null && total > 0 ? Math.min(100, (u / total) * 100) : null,
    mem,
    temp,
    status,
    statusAlert: gr?.state === "foreign",
  };
};

export const homeDir = (d: string): string => d.replace(/^\/(home|Users)\/[^/]+/, "~");

export interface Agg {
  gpus: number;
  memUsed: number | null;
  memTotal: number;
  powerW: number | null;
  util: number | null;
  models: string[];
  tps: number | null;
}

const total = (xs: (number | null)[]): number | null => (xs.some((x) => x !== null) ? xs.reduce<number>((t, x) => t + (x ?? 0), 0) : null);

export const aggOf = (ms: MachineView[], live: Record<string, EngineRates>): Agg => {
  const gs = ms.flatMap((m) => m.snap?.gpus ?? []);
  const utils = gs.map((g) => g.utilPct).filter((x): x is number => x !== null);
  const rates = ms.flatMap((m) => (m.snap ? m.snap.models.filter((x) => x.state === "ready").map((x) => engineFor(m.snap!, x.id, live, m.self)) : []));
  return {
    gpus: gs.length,
    memUsed: gs.length && gs.every((g) => g.memUsedMiB !== null) ? gs.reduce((t, g) => t + (g.memUsedMiB ?? 0), 0) : null,
    memTotal: gs.reduce((t, g) => t + g.memTotalMiB, 0),
    powerW: total(gs.map((g) => g.powerW)),
    util: utils.length ? utils.reduce((t, x) => t + x, 0) / utils.length : null,
    models: ms.flatMap((m) => (m.snap?.models ?? []).map((x) => x.primaryModel || x.id)),
    tps: total(rates.map((r) => r?.generationTpsWall ?? r?.decodeTps ?? null)),
  };
};

export interface HourBucket {
  at: number;
  requests: number;
  errors: number;
  fresh: number;
  cached: number;
  out: number;
  known: number;
  decodeTokens: number;
  decodeMs: number;
  prefillTokens: number;
  prefillMs: number;
  hist: number[];
  by: Record<string, { tokens: number; requests: number }>;
}

export type BreakBy = "model" | "machine" | "client";

export const hourBuckets = (rows: HourlyRow[], ttft: TtftHour[], now: number, by: BreakBy = "model", names: Record<string, string> = {}): HourBucket[] => {
  const start = Math.floor(now / 3_600_000) * 3_600_000 - 23 * 3_600_000;
  const out: HourBucket[] = Array.from({ length: 24 }, (_, i) => ({
    at: start + i * 3_600_000, requests: 0, errors: 0, fresh: 0, cached: 0, out: 0, known: 0, decodeTokens: 0, decodeMs: 0, prefillTokens: 0, prefillMs: 0, hist: [], by: {},
  }));
  const at = (hour: number) => out[Math.round((hour - start) / 3_600_000)];
  for (const r of rows) {
    const b = at(r.hour);
    if (!b) continue;
    const prompt = (r.inputUncached ?? 0) + (r.cacheRead ?? 0) + (r.cacheWrite ?? 0);
    b.requests += r.requests ?? 0;
    b.errors += r.errors ?? 0;
    b.fresh += prompt - (r.cacheRead ?? 0);
    b.cached += r.cacheRead ?? 0;
    b.out += r.output ?? 0;
    b.known += prompt - (r.cacheUnknownPrompt ?? 0);
    b.decodeTokens += r.decodeTokens ?? 0;
    b.decodeMs += r.decodeMs ?? 0;
    b.prefillTokens += r.prefillTokens ?? 0;
    b.prefillMs += r.prefillMs ?? 0;
    const k = by === "machine" ? (names[r.machineId] ?? r.machineId) : by === "client" ? r.client : r.model;
    const e = (b.by[k] ??= { tokens: 0, requests: 0 });
    e.tokens += prompt + (r.output ?? 0);
    e.requests += r.requests ?? 0;
  }
  for (const t of ttft) {
    const b = at(t.hour);
    if (b) b.hist = (Array.isArray(t.hist) ? t.hist : []).map((x, i) => x + (b.hist[i] ?? 0));
  }
  return out;
};

export interface RecipeView {
  id: string;
  r: RecipeRow;
  per: { m: MachineView; row: RecipeRow }[];
}

export const mergeRecipes = (ms: MachineView[], recipes: Record<string, RecipeRow[] | null>): RecipeView[] => {
  const by = new Map<string, RecipeView>();
  for (const m of ms)
    for (const row of recipes[m.id] ?? []) {
      const v = by.get(row.id) ?? { id: row.id, r: row, per: [] };
      v.per.push({ m, row });
      by.set(row.id, v);
    }
  return [...by.values()];
};
