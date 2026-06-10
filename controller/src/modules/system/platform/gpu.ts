import type { GpuInfo } from "../../models/types";
import { runCommand } from "../../../core/command";
import { getGpuInfoFromAmdSmi, getGpuInfoFromRocmSmi } from "./amd-gpu";
import { getGpuInfoFromIntelSysfs } from "./intel-gpu";
import { resolveRocmSmiTool } from "./rocm-info";
import { resolveForcedGpuMonitoringTool, resolveNvidiaSmiBinary } from "./smi-tools";

export const getGpuInfoFromNvidiaSmi = (): GpuInfo[] => {
  const query = [
    "name",
    "memory.total",
    "memory.used",
    "memory.free",
    "utilization.gpu",
    "temperature.gpu",
    "power.draw",
    "power.limit",
  ].join(",");

  try {
    const nvidiaSmi = resolveNvidiaSmiBinary();
    if (!nvidiaSmi) return [];

    const result = runCommand(
      nvidiaSmi,
      [`--query-gpu=${query}`, "--format=csv,noheader,nounits"],
      5_000
    );
    if (result.status !== 0 || !result.stdout) return [];

    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.map((line, index) => {
      const parts = line.split(",").map((value) => value.trim());
      const [
        name,
        memoryTotal,
        memoryUsed,
        memoryFree,
        utilization,
        temperature,
        powerDraw,
        powerLimit,
      ] = parts;
      const toBytes = (megabytes: string | undefined): number =>
        Math.max(0, Math.round(Number(megabytes ?? 0) * 1024 * 1024));
      const toMb = (megabytes: string | undefined): number =>
        Math.max(0, Math.round(Number(megabytes ?? 0)));
      return {
        index,
        name: name ?? "Unknown",
        memory_total: toBytes(memoryTotal),
        memory_total_mb: toMb(memoryTotal),
        memory_used: toBytes(memoryUsed),
        memory_used_mb: toMb(memoryUsed),
        memory_free: toBytes(memoryFree),
        memory_free_mb: toMb(memoryFree),
        utilization: Number(utilization ?? 0),
        utilization_pct: Number(utilization ?? 0),
        temperature: Number(temperature ?? 0),
        temp_c: Number(temperature ?? 0),
        power_draw: Number(powerDraw ?? 0),
        power_limit: Number(powerLimit ?? 0),
      };
    });
  } catch {
    return [];
  }
};

export const getGpuInfo = (): GpuInfo[] => {
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
