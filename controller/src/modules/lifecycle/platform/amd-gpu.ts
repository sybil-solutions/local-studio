// CRITICAL
import type { GpuInfo } from "../types";
import { runCommand } from "../../../core/command";
import { resolveAmdSmiBinary, resolveRocmSmiBinary } from "./smi-tools";

type AmdSmiValue = { value?: number; unit?: string } | "N/A" | null;

type AmdSmiMetricGpu = {
  gpu?: number;
  mem_usage?: {
    total_vram?: AmdSmiValue;
    used_vram?: AmdSmiValue;
    free_vram?: AmdSmiValue;
  };
  usage?: {
    gfx_activity?: AmdSmiValue;
  };
  temperature?: {
    hotspot?: AmdSmiValue;
    edge?: AmdSmiValue;
  };
  power?: {
    socket_power?: AmdSmiValue;
  };
};

type AmdSmiStaticGpu = {
  gpu?: number;
  asic?: {
    market_name?: string;
  };
};

type RocmSmiParsed = {
  index: number;
  name: string;
  memory_total_bytes: number | null;
  memory_used_bytes: number | null;
  utilization_pct: number | null;
  temp_c: number | null;
  power_draw_w: number | null;
  power_limit_w: number | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
};

const readAmdSmiValueMb = (value: AmdSmiValue | undefined): number | null => {
  if (!value || value === "N/A") {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }

  const unit = typeof value["unit"] === "string" ? value["unit"].toLowerCase() : "";
  const rawValue = coerceNumber(value["value"]);
  if (rawValue === null) {
    return null;
  }

  if (!unit || unit === "mb" || unit === "mib") {
    return rawValue;
  }
  if (unit === "gb" || unit === "gib") {
    return rawValue * 1024;
  }
  return rawValue;
};

const readAmdSmiValueNumber = (value: AmdSmiValue | undefined): number | null => {
  if (!value || value === "N/A") return null;
  if (!isRecord(value)) return null;
  return coerceNumber(value["value"]);
};

export const parseAmdSmiMetricJson = (jsonText: string): AmdSmiMetricGpu[] => {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!isRecord(parsed)) return [];
    const gpuData = parsed["gpu_data"];
    if (!Array.isArray(gpuData)) return [];
    return gpuData.filter((entry) => isRecord(entry)) as AmdSmiMetricGpu[];
  } catch {
    return [];
  }
};

export const parseAmdSmiStaticJson = (jsonText: string): AmdSmiStaticGpu[] => {
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!isRecord(parsed)) return [];
    const gpuData = parsed["gpu_data"];
    if (!Array.isArray(gpuData)) return [];
    return gpuData.filter((entry) => isRecord(entry)) as AmdSmiStaticGpu[];
  } catch {
    return [];
  }
};

const parseRocmSmiValue = (raw: string): { value: number; unit: string } | null => {
  const cleaned = raw.trim();
  if (!cleaned) return null;

  const match = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z%]+)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: (match[2] ?? "").trim() };
};

const rocmSmiToBytes = (parsed: { value: number; unit: string } | null): number | null => {
  if (!parsed) return null;
  const unit = parsed.unit.toLowerCase();
  if (!unit || unit === "b") return Math.round(parsed.value);
  if (unit === "kb" || unit === "kib") return Math.round(parsed.value * 1024);
  if (unit === "mb" || unit === "mib") return Math.round(parsed.value * 1024 ** 2);
  if (unit === "gb" || unit === "gib") return Math.round(parsed.value * 1024 ** 3);
  if (unit === "tb" || unit === "tib") return Math.round(parsed.value * 1024 ** 4);
  return null;
};

const enrichUnitFromLabel = (
  parsed: { value: number; unit: string } | null,
  label: string
): { value: number; unit: string } | null => {
  if (!parsed) return null;
  if (parsed.unit) return parsed;
  const match = label.match(/\((kib|mib|gib|tib|kb|mb|gb|tb|b)\)/i);
  if (!match) return parsed;
  return { ...parsed, unit: match[1] ?? "" };
};

export const parseRocmSmiText = (text: string): RocmSmiParsed[] => {
  const byIndex = new Map<number, Partial<RocmSmiParsed>>();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/GPU\[(\d+)\]\s*:\s*([^:]+?)\s*:\s*(.*)$/i);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isFinite(index)) continue;

    const label = (match[2] ?? "").trim().toLowerCase();
    const valueText = (match[3] ?? "").trim();
    const existing = byIndex.get(index) ?? { index, name: "AMD GPU" };
    const entry = { ...existing, index, name: existing.name ?? "AMD GPU" };

    if (label.includes("card model")) {
      if (valueText) entry.name = valueText;
    } else if (label.includes("card series") && entry.name === "AMD GPU") {
      if (valueText) entry.name = valueText;
    } else if (label.includes("total vram")) {
      entry.memory_total_bytes = rocmSmiToBytes(
        enrichUnitFromLabel(parseRocmSmiValue(valueText), label)
      );
    } else if (label.includes("used vram")) {
      entry.memory_used_bytes = rocmSmiToBytes(
        enrichUnitFromLabel(parseRocmSmiValue(valueText), label)
      );
    } else if (label.includes("gpu use")) {
      const parsed = parseRocmSmiValue(valueText.replace("%", "").trim());
      entry.utilization_pct = parsed ? parsed.value : null;
    } else if (label.includes("temperature") && label.includes("(c)")) {
      const parsed = parseRocmSmiValue(valueText.replace(/c$/i, "").trim());
      entry.temp_c = parsed ? parsed.value : null;
    } else if (label.includes("average") && label.includes("power") && label.includes("(w)")) {
      const parsed = parseRocmSmiValue(valueText.replace(/w$/i, "").trim());
      entry.power_draw_w = parsed ? parsed.value : null;
    } else if ((label.includes("power cap") || label.includes("max")) && label.includes("(w)")) {
      const parsed = parseRocmSmiValue(valueText.replace(/w$/i, "").trim());
      entry.power_limit_w = parsed ? parsed.value : null;
    }

    byIndex.set(index, entry);
  }

  return Array.from(byIndex.values())
    .map((entry) => {
      const parsed: RocmSmiParsed = {
        index: typeof entry.index === "number" ? entry.index : -1,
        name: entry.name ?? "AMD GPU",
        memory_total_bytes: entry.memory_total_bytes ?? null,
        memory_used_bytes: entry.memory_used_bytes ?? null,
        utilization_pct: entry.utilization_pct ?? null,
        temp_c: entry.temp_c ?? null,
        power_draw_w: entry.power_draw_w ?? null,
        power_limit_w: entry.power_limit_w ?? null,
      };
      return parsed.index >= 0 ? parsed : null;
    })
    .filter((value): value is RocmSmiParsed => Boolean(value))
    .sort((a, b) => a.index - b.index);
};

export const getGpuInfoFromAmdSmi = (): GpuInfo[] => {
  try {
    const amdSmi = resolveAmdSmiBinary();
    if (!amdSmi) return [];

    const metricResult = runCommand(amdSmi, ["metric", "--json", "-g", "all"], 5_000);
    if (metricResult.status !== 0 || !metricResult.stdout) return [];

    const staticResult = runCommand(amdSmi, ["static", "--json", "-g", "all"], 5_000);
    if (staticResult.status !== 0 || !staticResult.stdout) return [];

    const metrics = parseAmdSmiMetricJson(metricResult.stdout);
    const statics = parseAmdSmiStaticJson(staticResult.stdout);
    const staticByGpu = new Map<number, AmdSmiStaticGpu>();

    for (const entry of statics) {
      const index = typeof entry.gpu === "number" ? entry.gpu : null;
      if (index !== null) {
        staticByGpu.set(index, entry);
      }
    }

    return metrics
      .map((metric) => {
        const index = typeof metric.gpu === "number" ? metric.gpu : null;
        if (index === null) return null;

        const staticEntry = staticByGpu.get(index) ?? null;
        const name = staticEntry?.asic?.market_name ?? "AMD GPU";

        const totalMb = readAmdSmiValueMb(metric.mem_usage?.total_vram) ?? 0;
        const usedMb = readAmdSmiValueMb(metric.mem_usage?.used_vram) ?? 0;
        const freeMb =
          readAmdSmiValueMb(metric.mem_usage?.free_vram) ?? Math.max(0, totalMb - usedMb);

        const toBytes = (mb: number): number => Math.max(0, Math.round(mb * 1024 * 1024));
        const utilization = Math.max(
          0,
          Math.round(readAmdSmiValueNumber(metric.usage?.gfx_activity) ?? 0)
        );
        const temperature = Math.max(
          0,
          Math.round(
            readAmdSmiValueNumber(metric.temperature?.hotspot) ??
              readAmdSmiValueNumber(metric.temperature?.edge) ??
              0
          )
        );
        const powerDraw = Math.max(0, Number(readAmdSmiValueNumber(metric.power?.socket_power) ?? 0));

        return {
          index,
          name,
          memory_total: toBytes(totalMb),
          memory_total_mb: Math.max(0, Math.round(totalMb)),
          memory_used: toBytes(usedMb),
          memory_used_mb: Math.max(0, Math.round(usedMb)),
          memory_free: toBytes(freeMb),
          memory_free_mb: Math.max(0, Math.round(freeMb)),
          utilization,
          utilization_pct: utilization,
          temperature,
          temp_c: temperature,
          power_draw: powerDraw,
          power_limit: 0,
        } satisfies GpuInfo;
      })
      .filter((entry): entry is GpuInfo => Boolean(entry));
  } catch {
    return [];
  }
};

export const getGpuInfoFromRocmSmi = (): GpuInfo[] => {
  try {
    const rocmSmi = resolveRocmSmiBinary();
    if (!rocmSmi) return [];

    const args = [
      "--showproductname",
      "--showmeminfo",
      "vram",
      "--showuse",
      "--showtemp",
      "--showpower",
    ];
    let result = runCommand(rocmSmi, args, 5_000);
    if (result.status !== 0) {
      result = runCommand(rocmSmi, [], 5_000);
    }

    const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
    if (!combined.trim()) return [];

    const parsed = parseRocmSmiText(combined);
    if (parsed.length === 0) return [];

    const toMb = (bytes: number): number => Math.max(0, Math.round(bytes / 1024 ** 2));
    return parsed.map((gpu) => {
      const totalBytes = gpu.memory_total_bytes ?? 0;
      const usedBytes = gpu.memory_used_bytes ?? 0;
      const freeBytes = Math.max(0, totalBytes - usedBytes);
      const utilization = Math.max(0, Math.round(gpu.utilization_pct ?? 0));
      const temperatureC = Math.max(0, Math.round(gpu.temp_c ?? 0));
      const powerDraw = Math.max(0, Number(gpu.power_draw_w ?? 0));
      const powerLimit = Math.max(0, Number(gpu.power_limit_w ?? 0));

      return {
        index: gpu.index,
        name: gpu.name || "AMD GPU",
        memory_total: totalBytes,
        memory_total_mb: toMb(totalBytes),
        memory_used: usedBytes,
        memory_used_mb: toMb(usedBytes),
        memory_free: freeBytes,
        memory_free_mb: toMb(freeBytes),
        utilization,
        utilization_pct: utilization,
        temperature: temperatureC,
        temp_c: temperatureC,
        power_draw: powerDraw,
        power_limit: powerLimit,
      } satisfies GpuInfo;
    });
  } catch {
    return [];
  }
};
