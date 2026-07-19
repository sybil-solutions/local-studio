import { existsSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import { Effect } from "effect";
import type { GpuInfo, RuntimeGpuMonitoringTool } from "../../models/types";
import { runCommandAsyncEffect } from "../../../core/command";
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
  available: boolean;
  gpus: GpuInfo[];
  driverVersion: string | null;
};

export const queryNvidiaSmiSnapshot = (): Effect.Effect<NvidiaSmiSnapshot | null> => {
  const nvidiaSmi = resolveNvidiaSmiBinary();
  if (!nvidiaSmi) return Effect.succeed(null);
  return runCommandAsyncEffect(nvidiaSmi, NVIDIA_SMI_ARGS, {
    timeoutMs: NVIDIA_SMI_TIMEOUT_MS,
  }).pipe(
    Effect.map((result) => {
      if (result.status !== 0 || !result.stdout) {
        return { available: result.status === 0, gpus: [], driverVersion: null };
      }
      return {
        available: true,
        gpus: parseNvidiaSmiGpuOutput(result.stdout),
        driverVersion: parseNvidiaSmiDriverVersion(result.stdout),
      };
    }),
    Effect.catch(() => Effect.succeed({ available: false, gpus: [], driverVersion: null })),
  );
};

export const getGpuInfoFromNvidiaSmi = (): Effect.Effect<GpuInfo[]> =>
  queryNvidiaSmiSnapshot().pipe(Effect.map((snapshot) => snapshot?.gpus ?? []));

export const detectGpuMonitoringTool = (): Effect.Effect<RuntimeGpuMonitoringTool | null> =>
  Effect.gen(function* () {
    const forced = resolveForcedGpuMonitoringTool();
    if (forced) return forced;
    if (resolveNvidiaSmiBinary()) return "nvidia-smi";
    const rocmTool = resolveRocmSmiTool();
    if (rocmTool) return rocmTool;
    if ((yield* getGpuInfoFromIntelSysfs()).length > 0) return "intel-sysfs";
    return null;
  });

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

const collectGpuInfo = (): Effect.Effect<GpuInfo[]> =>
  Effect.gen(function* () {
    const forced = resolveForcedGpuMonitoringTool();
    if (forced === "nvidia-smi") {
      return yield* getGpuInfoFromNvidiaSmi();
    }
    if (forced === "amd-smi") {
      return yield* getGpuInfoFromAmdSmi();
    }
    if (forced === "rocm-smi") {
      return yield* getGpuInfoFromRocmSmi();
    }
    if (forced === "intel-sysfs") {
      return yield* getGpuInfoFromIntelSysfs();
    }

    const nvidia = yield* getGpuInfoFromNvidiaSmi();
    if (nvidia.length > 0) {
      return nvidia;
    }

    const rocmTool = resolveRocmSmiTool();
    if (rocmTool === "amd-smi") {
      const amd = yield* getGpuInfoFromAmdSmi();
      if (amd.length > 0) return amd;
      return yield* getGpuInfoFromRocmSmi();
    }
    if (rocmTool === "rocm-smi") {
      const rocm = yield* getGpuInfoFromRocmSmi();
      if (rocm.length > 0) return rocm;
      return yield* getGpuInfoFromAmdSmi();
    }

    const intel = yield* getGpuInfoFromIntelSysfs();
    if (intel.length > 0) {
      return intel;
    }

    return [];
  });

export const getGpuInfo = (): Effect.Effect<GpuInfo[]> =>
  Effect.gen(function* () {
    const gpus = yield* collectGpuInfo();
    if (gpus.length === 0) {
      yield* Effect.sync(warnNoGpuToolingOnce);
    }
    return gpus;
  });
