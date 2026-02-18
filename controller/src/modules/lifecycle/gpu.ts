// CRITICAL
import type { GpuInfo, RuntimeGpuMonitoringTool } from "./types";
import { runCommand } from "../../core/command";
import { getGpuInfoFromAmdSmi, getGpuInfoFromRocmSmi } from "./platform/amd-gpu";
import { resolveRocmSmiTool } from "./platform/rocm-info";
import { resolveForcedGpuMonitoringTool, resolveNvidiaSmiBinary } from "./platform/smi-tools";

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

export const resolveGpuMonitoringTool = (): RuntimeGpuMonitoringTool | null => {
  const forced = resolveForcedGpuMonitoringTool();
  if (forced === "nvidia-smi") {
    return "nvidia-smi";
  }
  if (forced === "amd-smi" || forced === "rocm-smi") {
    return forced;
  }

  if (resolveNvidiaSmiBinary()) {
    return "nvidia-smi";
  }

  return resolveRocmSmiTool();
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

  return [];
};

export const estimateModelMemory = (
  modelSizeGb: number,
  quantization?: string,
  dtype?: string,
  tensorParallel = 1
): number => {
  let memoryGb = modelSizeGb;

  if (quantization) {
    const quantLower = quantization.toLowerCase();
    if (quantLower.includes("int4") || quantLower.includes("4bit")) {
      memoryGb *= 0.25;
    } else if (
      quantLower.includes("int8") ||
      quantLower.includes("8bit") ||
      quantLower === "awq" ||
      quantLower === "gptq"
    ) {
      memoryGb *= 0.5;
    } else if (quantLower.includes("fp8")) {
      memoryGb *= 0.5;
    }
  }

  if (dtype) {
    const dtypeLower = dtype.toLowerCase();
    if (dtypeLower.includes("float32") || dtypeLower.includes("fp32")) {
      memoryGb *= 2.0;
    } else if (dtypeLower.includes("int8")) {
      memoryGb *= 0.5;
    }
  }

  if (tensorParallel > 1) {
    memoryGb /= tensorParallel;
  }

  memoryGb *= 1.3;
  return memoryGb;
};

export const canFitModel = (
  modelSizeGb: number,
  quantization?: string,
  dtype?: string,
  tensorParallel = 1
): boolean => {
  const gpus = getGpuInfo();
  if (gpus.length === 0) {
    return true;
  }

  const requiredGb = estimateModelMemory(modelSizeGb, quantization, dtype, tensorParallel);
  const requiredBytes = requiredGb * 1024 ** 3;

  if (gpus.length < tensorParallel) {
    return false;
  }

  for (let index = 0; index < tensorParallel; index += 1) {
    const gpu = gpus[index];
    if (!gpu || gpu.memory_free < requiredBytes) {
      return false;
    }
  }

  return true;
};
