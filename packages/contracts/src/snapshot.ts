import type { HarnessInfo, Workspace } from "./agent";
import type { Gpu, GpuGroup } from "./gpu";
import type { Machine, Peer } from "./machine";
import type { Activity, EngineRates, ModelCardStats, RequestRecord } from "./metrics";
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

export type ControllerEventType = ControllerEvent["type"];
