import type { HarnessInfo, Workspace } from "./agent";
import type { Gpu, GpuGroup } from "./gpu";
import type { Machine, Peer } from "./machine";
import type { Activity, EngineRates, ModelCardStats, Percentiles, RequestRecord } from "./metrics";
import type { Endpoint, RunningModel } from "./model";
import type { LaunchProgress } from "./recipe";

export interface Snapshot {
  at: number;
  machine: Machine;
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
  workspaces: Workspace[];
}

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
  };
};
