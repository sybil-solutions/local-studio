export type GpuBackend = "nvidia" | "metal" | "intel-xpu" | "amd-rocm";

export type GpuKey = string;

export interface GpuProcess {
  pid: number;
  processName: string;
  usedMiB: number | null;
  modelId: string | null;
}

export interface Gpu {
  key: GpuKey;
  backend: GpuBackend;
  index: number;
  uuid: string;
  busId: string | null;
  product: string;
  name: string;
  hardwareId: string | null;
  memTotalMiB: number;
  memUsedMiB: number | null;
  unified?: boolean;
  utilPct: number | null;
  tempC: number | null;
  powerW: number | null;
  powerLimitW: number | null;
  processes: GpuProcess[];
}

export type GpuGroupState = "available" | "running" | "busy" | "foreign";

export type GpuGroupKind = "alone" | "grouped";

export interface GpuGroup {
  id: string;
  gpuKeys: GpuKey[];
  kind: GpuGroupKind;
  state: GpuGroupState;
  modelId: string | null;
  modelIds: string[];
  note: string;
}

export const FOREIGN_USED_MIB = 2048;
