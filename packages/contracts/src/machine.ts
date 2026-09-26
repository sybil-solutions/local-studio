export const SERVICE = "local-studio" as const;
export const API_VERSION = 1 as const;

export type MachineId = string;

export interface Health {
  status: "ok";
  service: typeof SERVICE;
  version: string;
  machineId: MachineId;
  name: string;
  api: typeof API_VERSION;
  readOnly: boolean;
}

export type Platform = "linux" | "darwin";

export interface Machine {
  machineId: MachineId;
  name: string;
  hostname: string;
  platform: Platform;
  version: string;
  url: string;
  self: boolean;
  online: boolean;
  lastSeenAt: number | null;
  readOnly: boolean;
  watchdogs: Watchdog[];
}

export interface Watchdog {
  name: string;
  pid: number | null;
  note: string;
}

export interface Peer {
  id: string;
  machineId: MachineId;
  name: string;
  baseUrl: string;
  addedAt: number;
  lastSeenAt: number | null;
  online: boolean;
  version: string | null;
  error: string | null;
}

export interface TailnetCandidate {
  dnsName: string;
  hostName: string;
  os: string;
  url: string;
  kind: "local-studio" | "legacy-controller" | "none";
  machineId: MachineId | null;
  alreadyConnected: boolean;
}
