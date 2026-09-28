import type { MachineId } from "./machine";

export type T3State = "unavailable" | "stopped" | "starting" | "running" | "crashed";

export interface T3Environment {
  environmentId: string;
  label: string;
  serverVersion: string;
}

export interface T3Status {
  machineId: MachineId;
  name: string;
  state: T3State;
  enabled: boolean;
  managed: boolean;
  bin: string | null;
  host: string;
  port: number;
  url: string;
  loopbackOnly: boolean;
  pid: number | null;
  startedAt: number | null;
  environment: T3Environment | null;
  error: string | null;
}

export interface T3Pairing {
  machineId: MachineId;
  name: string;
  environmentId: string | null;
  id: string;
  pairUrl: string;
  credential: string;
  baseUrl: string;
  expiresAt: string;
  loopbackOnly: boolean;
}

export interface T3FleetEntry {
  machineId: MachineId;
  name: string;
  peerId: string | null;
  self: boolean;
  online: boolean;
  status: T3Status | null;
  error: string | null;
}
