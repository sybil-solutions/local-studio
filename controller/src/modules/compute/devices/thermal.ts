import { readFileSync, readdirSync } from "node:fs";
import { Effect } from "effect";
import type { ThermalInfo } from "../contracts";
import { neverFails, type DeviceProbe } from "./probe";

const HWMON_ROOT = "/sys/class/hwmon";

/** hwmon reports millidegrees; anything outside a plausible range is a stuck sensor. */
const MIN_PLAUSIBLE_C = 1;
const MAX_PLAUSIBLE_C = 150;

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
};

const parseCelsius = (raw: string | null): number | null => {
  if (raw === null) return null;
  const millidegrees = Number(raw);
  if (!Number.isFinite(millidegrees)) return null;
  const celsius = millidegrees / 1000;
  return celsius >= MIN_PLAUSIBLE_C && celsius <= MAX_PLAUSIBLE_C ? Math.round(celsius) : null;
};

const sourceFor = (chip: string): ThermalInfo["source"] => {
  if (/^(?:coretemp|k10temp|zenpower|cpu)/i.test(chip)) return "cpu";
  if (/^(?:amdgpu|nouveau|i915|xe)/i.test(chip)) return "gpu";
  return "chassis";
};

const readChip = (directory: string): readonly ThermalInfo[] => {
  const chip = readText(`${HWMON_ROOT}/${directory}/name`) ?? directory;
  const entries = ((): string[] => {
    try {
      return readdirSync(`${HWMON_ROOT}/${directory}`);
    } catch {
      return [] as string[];
    }
  })();
  const readings: ThermalInfo[] = [];
  for (const entry of entries) {
    if (!/^temp\d+_input$/.test(entry)) continue;
    const celsius = parseCelsius(readText(`${HWMON_ROOT}/${directory}/${entry}`));
    if (celsius === null) continue;
    const label = readText(`${HWMON_ROOT}/${directory}/${entry.replace("_input", "_label")}`);
    readings.push({ label: label ? `${chip} ${label}` : chip, celsius, source: sourceFor(chip) });
  }
  return readings;
};

/**
 * Linux CPU and chassis sensors. GPU temperature comes from the vendor tool instead, so
 * this probe never claims the "temperature" capability for accelerators — only for the
 * host readings it actually produces.
 */
export const thermalProbe: DeviceProbe = {
  id: "thermal",
  detect: (host) => host.platform === "linux",
  run: () =>
    neverFails(
      Effect.sync(() => {
        const directories = ((): string[] => {
          try {
            return readdirSync(HWMON_ROOT);
          } catch {
            return [] as string[];
          }
        })();
        const thermals = directories.flatMap(readChip);
        return {
          fragment: { thermals },
          capabilities: thermals.length > 0 ? ["temperature" as const] : [],
        };
      }),
    ),
};
