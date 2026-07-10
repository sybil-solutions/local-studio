import { existsSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import type { GpuInfo, RuntimeGpuMonitoringTool } from "../../models/types";
import { runCommand, runCommandAsync } from "../../../core/command";
import { getGpuInfoFromAmdSmi, getGpuInfoFromRocmSmi } from "./amd-gpu";
import { getGpuInfoFromIntelSysfs } from "./intel-gpu";
import { resolveRocmSmiTool } from "./rocm-info";
import {
  resolveAmdSmiBinary,
  resolveForcedGpuMonitoringTool,
  resolveNvidiaSmiBinary,
  resolveRocmSmiBinary,
} from "./smi-tools";

const NVIDIA_SMI_GPU_FIELDS = [
  "uuid",
  "pci.bus_id",
  "name",
  "memory.total",
  "memory.used",
  "memory.free",
  "utilization.gpu",
  "temperature.gpu",
  "power.draw",
  "power.limit",
] as const;

// driver_version is appended after the GPU fields so one nvidia-smi invocation
// can feed GPU info, CUDA driver info, and the monitoring probe.
const NVIDIA_SMI_SNAPSHOT_QUERY = [...NVIDIA_SMI_GPU_FIELDS, "driver_version"].join(",");
const NVIDIA_SMI_ARGS = [
  `--query-gpu=${NVIDIA_SMI_SNAPSHOT_QUERY}`,
  "--format=csv,noheader,nounits",
];
const NVIDIA_SMI_TIMEOUT_MS = 5_000;

const parseNvidiaSmiGpuLine = (line: string, index: number): GpuInfo => {
  const parts = line.split(",").map((value) => value.trim());
  const [
    rawUuid,
    rawPciBusId,
    rawName,
    memoryTotal,
    memoryUsed,
    memoryFree,
    utilization,
    temperature,
    powerDraw,
    powerLimit,
  ] = parts;
  const name = rawName ?? "Unknown";
  const identity = (value: string | undefined): string | undefined => {
    if (!value || /^(?:N\/A|\[Not Supported\])$/i.test(value)) return undefined;
    return value;
  };
  const uuid = identity(rawUuid);
  const pciBusId = identity(rawPciBusId);
  const toFiniteNumber = (value: string | undefined): number => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const toMb = (megabytes: string | undefined): number =>
    Math.max(0, Math.round(toFiniteNumber(megabytes)));
  const reportedTotalMb = toMb(memoryTotal);
  const isUnifiedMemoryNvidia = reportedTotalMb === 0 && /\b(?:GB10|Grace)\b/i.test(name);
  const fallbackTotalMb = isUnifiedMemoryNvidia ? Math.round(totalmem() / 1024 / 1024) : 0;
  const fallbackFreeMb = isUnifiedMemoryNvidia ? Math.round(freemem() / 1024 / 1024) : 0;
  const fallbackUsedMb = Math.max(0, fallbackTotalMb - fallbackFreeMb);
  const memoryTotalMb = reportedTotalMb || fallbackTotalMb;
  const memoryUsedMb = toMb(memoryUsed) || fallbackUsedMb;
  const memoryFreeMb = toMb(memoryFree) || fallbackFreeMb;
  return {
    ...(uuid ? { uuid } : {}),
    ...(pciBusId ? { pci_bus_id: pciBusId } : {}),
    index,
    name,
    memory_total_mb: memoryTotalMb,
    memory_used_mb: memoryUsedMb,
    memory_free_mb: memoryFreeMb,
    utilization_pct: toFiniteNumber(utilization),
    temp_c: toFiniteNumber(temperature),
    power_draw: toFiniteNumber(powerDraw),
    power_limit: toFiniteNumber(powerLimit),
  };
};

const splitSmiLines = (stdout: string): string[] =>
  stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const parseNvidiaSmiGpuOutput = (stdout: string): GpuInfo[] =>
  splitSmiLines(stdout).map(parseNvidiaSmiGpuLine);

const parseNvidiaSmiDriverVersion = (stdout: string): string | null => {
  const firstLine = splitSmiLines(stdout)[0];
  if (!firstLine) return null;
  const driver = firstLine.split(",")[NVIDIA_SMI_GPU_FIELDS.length]?.trim();
  return driver || null;
};

export type NvidiaSmiSnapshot = {
  /** nvidia-smi exists and the query command exited 0. */
  available: boolean;
  gpus: GpuInfo[];
  driverVersion: string | null;
};

/**
 * Single async nvidia-smi invocation whose parsed output feeds GPU info, the
 * CUDA driver version, and the GPU-monitoring probe. Returns null when
 * nvidia-smi is not resolvable at all.
 */
export const queryNvidiaSmiSnapshot = async (): Promise<NvidiaSmiSnapshot | null> => {
  const nvidiaSmi = resolveNvidiaSmiBinary();
  if (!nvidiaSmi) return null;
  try {
    const result = await runCommandAsync(nvidiaSmi, NVIDIA_SMI_ARGS, {
      timeoutMs: NVIDIA_SMI_TIMEOUT_MS,
    });
    if (result.status !== 0 || !result.stdout) {
      return { available: result.status === 0, gpus: [], driverVersion: null };
    }
    return {
      available: true,
      gpus: parseNvidiaSmiGpuOutput(result.stdout),
      driverVersion: parseNvidiaSmiDriverVersion(result.stdout),
    };
  } catch {
    return { available: false, gpus: [], driverVersion: null };
  }
};

export const getGpuInfoFromNvidiaSmi = (): GpuInfo[] => {
  try {
    const nvidiaSmi = resolveNvidiaSmiBinary();
    if (!nvidiaSmi) return [];

    const result = runCommand(nvidiaSmi, NVIDIA_SMI_ARGS, NVIDIA_SMI_TIMEOUT_MS);
    if (result.status !== 0 || !result.stdout) return [];

    return parseNvidiaSmiGpuOutput(result.stdout);
  } catch {
    return [];
  }
};

/** Tool the cascade in getGpuInfo would use, without running any query commands. */
export const detectGpuMonitoringTool = (): RuntimeGpuMonitoringTool | null => {
  const forced = resolveForcedGpuMonitoringTool();
  if (forced) return forced;
  if (resolveNvidiaSmiBinary()) return "nvidia-smi";
  const rocmTool = resolveRocmSmiTool();
  if (rocmTool) return rocmTool;
  if (getGpuInfoFromIntelSysfs().length > 0) return "intel-sysfs";
  return null;
};

// Logged once per process so CPU-only and missing-driver hosts are distinguishable
// from "zero GPUs" without spamming every poll.
let warnedNoGpuTooling = false;

const warnNoGpuToolingOnce = (): void => {
  if (warnedNoGpuTooling) return;
  warnedNoGpuTooling = true;
  const attempted = [
    `nvidia-smi=${resolveNvidiaSmiBinary() ? "found" : "not found"}`,
    `amd-smi=${resolveAmdSmiBinary() ? "found" : "not found"}`,
    `rocm-smi=${resolveRocmSmiBinary() ? "found" : "not found"}`,
    `intel-sysfs=${existsSync("/sys/bus/pci/devices") ? "no compute GPUs" : "unavailable"}`,
  ].join(" ");
  console.warn(`No GPUs reported by any monitoring tool; attempted: ${attempted}`);
};

const collectGpuInfo = (): GpuInfo[] => {
  const forced = resolveForcedGpuMonitoringTool();
  if (forced === "nvidia-smi") {
    return getGpuInfoFromNvidiaSmi();
  }
  if (forced === "amd-smi") {
    return getGpuInfoFromAmdSmi();
  }
  if (forced === "rocm-smi") {
    return getGpuInfoFromRocmSmi();
  }
  if (forced === "intel-sysfs") {
    return getGpuInfoFromIntelSysfs();
  }

  const nvidia = getGpuInfoFromNvidiaSmi();
  if (nvidia.length > 0) {
    return nvidia;
  }

  const rocmTool = resolveRocmSmiTool();
  if (rocmTool === "amd-smi") {
    const amd = getGpuInfoFromAmdSmi();
    if (amd.length > 0) return amd;
    return getGpuInfoFromRocmSmi();
  }
  if (rocmTool === "rocm-smi") {
    const rocm = getGpuInfoFromRocmSmi();
    if (rocm.length > 0) return rocm;
    return getGpuInfoFromAmdSmi();
  }

  const intel = getGpuInfoFromIntelSysfs();
  if (intel.length > 0) {
    return intel;
  }

  return [];
};

export const getGpuInfo = (): GpuInfo[] => {
  const gpus = collectGpuInfo();
  if (gpus.length === 0) {
    warnNoGpuToolingOnce();
  }
  return gpus;
};
