import type { AgentSession, HarnessInfo } from "./agent";
import type { Gpu, GpuGroup } from "./gpu";
import type { HostResources, Machine, Peer } from "./machine";
import type { Activity, EngineRates, ModelCardStats, Percentiles, RequestRecord } from "./metrics";
import type { Endpoint, RunningModel } from "./model";
import type { LaunchProgress } from "./recipe";

export interface Snapshot {
  at: number;
  machine: Machine;
  host: HostResources | null;
  gpus: Gpu[];
  groups: GpuGroup[];
  models: RunningModel[];
  endpoints: Endpoint[];
  launches: LaunchProgress[];
  cards: ModelCardStats[];
  engines: EngineRates[];
  activity: Activity;
  discovery: { lastScanAt: number | null; scanMs: number | null; docker: "ok" | "unavailable" | "absent"; errors: string[] };
}

export interface FleetSnapshot {
  at: number;
  self: string;
  machines: { machineId: string; peerId: string | null; online: boolean; error: string | null; snapshot: Snapshot | null }[];
  peers: Peer[];
  activity: Activity;
  harnesses: HarnessInfo[];
  sessions: AgentSession[];
  totals?: FleetTotals;
}

export interface ResourceTotals {
  machines: number;
  online: number;
  gpus: number;
  vramTotalMiB: number;
  vramUsedMiB: number;
  vramUnmeasured: number;
  unifiedMiB: number;
  ramTotalMiB: number;
  ramUsedMiB: number;
  storageTotalMiB: number;
  storageUsedMiB: number;
  cpuCores: number;
  cpuThreads: number;
}

export interface PodTotals {
  id: string;
  name: string;
  machineIds: string[];
  totals: ResourceTotals;
}

export interface FleetTotals {
  all: ResourceTotals;
  pods: PodTotals[];
}

export const podOf = (name: string): string | null => /^(.+)-[0-9a-f]{3,4}$/.exec(name)?.[1] ?? null;

export const resourceTotals = (list: { online: boolean; snapshot: Snapshot | null }[]): ResourceTotals => {
  const t: ResourceTotals = { machines: 0, online: 0, gpus: 0, vramTotalMiB: 0, vramUsedMiB: 0, vramUnmeasured: 0, unifiedMiB: 0, ramTotalMiB: 0, ramUsedMiB: 0, storageTotalMiB: 0, storageUsedMiB: 0, cpuCores: 0, cpuThreads: 0 };
  for (const { online, snapshot: s } of list) {
    if (!s) continue;
    t.machines++;
    if (online) t.online++;
    for (const g of s.gpus) {
      t.gpus++;
      t.vramTotalMiB += g.memTotalMiB;
      if (g.unified) t.unifiedMiB += g.memTotalMiB;
      if (online && g.memUsedMiB !== null) t.vramUsedMiB += g.memUsedMiB;
      else t.vramUnmeasured++;
    }
    const h = s.host;
    if (!h) continue;
    t.ramTotalMiB += h.mem.totalMiB;
    if (online) t.ramUsedMiB += h.mem.usedMiB ?? 0;
    t.storageTotalMiB += h.storage?.totalMiB ?? 0;
    if (online) t.storageUsedMiB += h.storage?.usedMiB ?? 0;
    t.cpuCores += h.cpu.cores ?? h.cpu.threads;
    t.cpuThreads += h.cpu.threads;
  }
  return t;
};

export const fleetTotals = (machines: FleetSnapshot["machines"]): FleetTotals => {
  const byPod = new Map<string, FleetSnapshot["machines"]>();
  for (const m of machines) {
    const k = m.snapshot ? podOf(m.snapshot.machine.name) : null;
    if (k) byPod.set(k, [...(byPod.get(k) ?? []), m]);
  }
  const pods = [...byPod]
    .filter(([, ms]) => ms.length > 1)
    .map(([k, ms]) => ({ id: `pod:${k}`, name: `${k} pod`, machineIds: ms.map((m) => m.machineId), totals: resourceTotals(ms) }));
  return { all: resourceTotals(machines), pods };
};

export type ControllerEvent =
  | { type: "snapshot"; data: Snapshot }
  | { type: "fleet"; data: FleetSnapshot }
  | { type: "request"; data: RequestRecord }
  | { type: "engine"; data: EngineRates }
  | { type: "launch"; data: LaunchProgress }
  | { type: "peer"; data: Peer }
  | { type: "log"; data: { level: "info" | "warn" | "error"; msg: string; at: number } };

export interface ControllerHealth {
  at: number;
  uptimeS: number;
  pid: number;
  memory: { rssMiB: number; heapUsedMiB: number; heapTotalMiB: number; externalMiB: number };
  eventLoopLagMaxMs: number;
  gauges: Record<string, number>;
  counters: Record<string, number>;
  timings: Record<string, Percentiles & { n: number; last: number | null }>;
  lastErrors: { at: number; where: string; message: string }[];
}

export type ControllerEventType = ControllerEvent["type"];

export const emptyActivity = (): Activity => ({ start: "", today: 0, days: [], requests: 0, total: 0, week: 0, since: null, last: null });

const list = <T>(x: T[] | null | undefined): T[] => (Array.isArray(x) ? x : []);
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);

export const normalizeSnapshot = (s: Snapshot | null | undefined): Snapshot | null => {
  if (!s || typeof s !== "object" || !s.machine || typeof s.machine.machineId !== "string") return null;
  const a: Partial<Activity> = s.activity && typeof s.activity === "object" ? s.activity : {};
  return {
    ...s,
    at: num(s.at) || Date.now(),
    gpus: list(s.gpus).filter((g) => g && typeof g.key === "string").map((g) => ({ ...g, processes: list(g.processes) })),
    models: list(s.models)
      .filter((m) => m && typeof m.id === "string" && typeof m.primaryModel === "string")
      .map((m) => ({ ...m, gpuKeys: list(m.gpuKeys), servedModels: list(m.servedModels).filter((x) => typeof x === "string") })),
    groups: list(s.groups).filter(Boolean).map((g) => ({ ...g, gpuKeys: list(g.gpuKeys), modelIds: list(g.modelIds) })),
    engines: list(s.engines).filter(Boolean),
    launches: list(s.launches).filter(Boolean),
    cards: list(s.cards).filter(Boolean).map((c) => ({ ...c, line: list(c.line) })),
    endpoints: list(s.endpoints).filter(Boolean),
    activity: { ...emptyActivity(), ...a, days: list(a.days), today: num(a.today), requests: num(a.requests), total: num(a.total), week: num(a.week) },
    discovery: { ...({ lastScanAt: null, scanMs: null, docker: "absent" } as const), ...s.discovery, errors: list(s.discovery?.errors) },
    machine: { ...s.machine, watchdogs: list(s.machine.watchdogs) },
    host: s.host && typeof s.host === "object" && s.host.cpu && s.host.mem ? { ...s.host, disks: list(s.host.disks) } : null,
  };
};
