import type { Activity, EngineRates, FleetSnapshot, Gpu, LaunchProgress, ModelCardStats, RecipeRow, RunningModel, Snapshot } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";

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
  machineId: string;
  peerId: string | null;
  modelId: string | null;
  launchId: string | null;
  embedding: boolean;
  stopBlocked: string | null;
  name: string;
  family: Family;
  gpu: string;
  mem: string;
  line: number[];
  chips: Chip[];
  ready: boolean;
  sub: string;
  subAlert: boolean;
  progress: number | null;
  readOnly: boolean;
  watchdog: string | null;
  servedModel: string | null;
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

const memLine = (cards: Gpu[]): string => {
  if (!cards.length) return "";
  const total = cards.reduce((t, g) => t + g.memTotalMiB, 0);
  const known = cards.every((g) => g.memUsedMiB !== null);
  const used = cards.reduce((t, g) => t + (g.memUsedMiB ?? 0), 0);
  return `${known ? `${Math.round(used / 1024)} / ` : ""}${fmt.gb(total)}`;
};

const gpuLine = (cards: Gpu[]): string => (cards.length > 1 ? `${cards.length} × ${shortGpu(cards[0]!)}` : cards[0] ? shortGpu(cards[0]) : "GPU");

const statsFor = (s: Snapshot, id: string): ModelCardStats | null => s.cards.find((c) => c.modelId === id) ?? null;

export const engineFor = (s: Snapshot, id: string, live: Record<string, EngineRates>, self: boolean): EngineRates | null => (self ? live[id] : undefined) ?? s.engines.find((e) => e.modelId === id) ?? null;

const speedChip = (st: ModelCardStats | null, engine: EngineRates | null): Chip[] => {
  if (st?.decodeTps != null) return [{ icon: "speed", text: `${fmt.tps(st.decodeTps)} tok/s` }];
  if (engine?.decodeTps != null) return [{ icon: "speed", text: `${fmt.tps(engine.decodeTps)} tok/s engine` }];
  return [];
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
    machineId: mv.id,
    peerId: mv.peerId,
    modelId: m.id,
    launchId: launch?.launchId ?? null,
    embedding: m.embedding,
    stopBlocked: m.stopBlocked,
    name: m.primaryModel || m.id,
    family: family(m.primaryModel),
    gpu: cards.length ? gpuLine(cards) : `${m.engine} · :${m.port}`,
    mem: ready || m.state === "unhealthy" ? memLine(cards) : "",
    line: st?.line ?? [],
    chips: !ready
      ? []
      : m.embedding
        ? [{ text: "embedding" }]
        : [...speedChip(st, engine), ...(st?.allTokens ? [{ icon: "tokens", text: fmt.k(st.allTokens) }] : [])],
    ready,
    sub: ready ? "" : sub,
    subAlert: m.state === "unhealthy",
    progress: !ready && m.state === "loading" && pct !== null ? pct : null,
    readOnly: mv.readOnly,
    watchdog: m.watchdog,
    servedModel: m.servedModels[0] ?? m.primaryModel,
  };
};

const launchCard = (mv: MachineView, s: Snapshot, l: LaunchProgress, recipes: RecipeRow[] | null): CardView => {
  const r = recipes?.find((x) => x.id === l.recipeId);
  return {
    key: `${mv.id}/launch/${l.launchId}`,
    machineId: mv.id,
    peerId: mv.peerId,
    modelId: null,
    launchId: l.launchId,
    embedding: false,
    stopBlocked: null,
    name: r?.name ?? l.recipeId,
    family: family(r?.family ?? r?.name ?? l.recipeId),
    gpu: r ? `${r.cards > 1 ? `${r.cards} × ` : ""}${shortGpu(s.gpus.find((g) => g.hardwareId === r.hardwareId) ?? s.gpus[0]!) }` : "",
    mem: "",
    line: [],
    chips: [],
    ready: false,
    sub: `${l.phase}${l.detail ? ` · ${l.detail}` : ""}${l.percent !== null ? ` · ${Math.round(l.percent)}%` : ""}`,
    subAlert: false,
    progress: l.percent,
    readOnly: mv.readOnly,
    watchdog: null,
    servedModel: r?.servedName ?? null,
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

export const recipeChips = (r: RecipeRow): Chip[] =>
  [{ text: fmtFormat(r.format) }, r.ctxTokens ? { icon: "context", text: fmt.ctx(r.ctxTokens) } : null, r.sizeGb ? { icon: "weights", text: `${Math.round(r.sizeGb)} GB` } : null].filter(
    (x): x is Chip => !!x && !!x.text,
  );

export interface GpuRowView {
  key: string;
  name: string;
  pct: number | null;
  mem: string;
  temp: string;
  right: string;
  status: string;
  statusAlert: boolean;
}

export const gpuRow = (g: Gpu, s: Snapshot | null, extra = false): GpuRowView => {
  const used = g.memUsedMiB !== null ? g.memUsedMiB / 1024 : null;
  const total = g.memTotalMiB;
  const mem = `${used !== null ? `${used.toFixed(1)} / ` : ""}${fmt.gb(total)}`;
  const temp = g.tempC !== null ? `${Math.round(g.tempC)}°` : "";
  const gr = s?.groups.find((x) => x.gpuKeys.includes(g.key));
  const names = (gr?.modelIds ?? []).map((id) => s?.models.find((m) => m.id === id)?.primaryModel ?? id);
  const verb = gr?.state === "busy" ? "busy" : "running";
  const grouped = gr && gr.gpuKeys.length > 1 ? ` · group of ${gr.gpuKeys.length}` : "";
  const status = names.length ? `${verb} ${names.join(", ")}${grouped}` : gr?.state === "foreign" ? "in use by another program" : "";
  const bits = [mem, temp];
  if (extra) bits.push(g.utilPct !== null ? `${Math.round(g.utilPct)}%` : "", g.powerW !== null ? `${Math.round(g.powerW)} W` : "");
  return {
    key: g.key,
    name: shortGpu(g),
    pct: g.memUsedMiB !== null && total > 0 ? Math.min(100, (g.memUsedMiB / total) * 100) : null,
    mem,
    temp,
    right: bits.filter(Boolean).join("  "),
    status,
    statusAlert: gr?.state === "foreign",
  };
};

export const homeDir = (d: string): string => d.replace(/^\/(home|Users)\/[^/]+/, "~");
