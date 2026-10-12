import { statfsSync, statSync } from "node:fs";
import { Effect } from "effect";
import type { VolumeInfo } from "../contracts";
import { neverFails, type DeviceProbe } from "./probe";
import { hostPlatform } from "./host";

/**
 * `statfsSync` works on all three platforms, so free space needs no shellout and no
 * per-OS parser. Disk model and rotational-ness do need vendor tools; they are reported
 * as null here rather than shelling out on every sample.
 */
const readVolume = (mount: string): { key: string; volume: VolumeInfo } | null => {
  try {
    const device = statSync(mount).dev;
    const stats = statfsSync(mount);
    const blockSize = Number(stats.bsize);
    const total = Number(stats.blocks) * blockSize;
    const free = Number(stats.bavail) * blockSize;
    if (!Number.isFinite(total) || total <= 0) return null;
    return {
      key: String(device),
      volume: {
        mount,
        totalBytes: total,
        freeBytes: Number.isFinite(free) && free >= 0 ? free : 0,
        filesystem: null,
        model: null,
        rotational: null,
      },
    };
  } catch {
    return null;
  }
};

export const systemRoot = (): string => (hostPlatform() === "win32" ? "C:\\" : "/");

/** Sample the system root plus whichever paths matter to this install (model store,
 *  data root). Duplicate mounts collapse, so passing several paths on one volume is free. */
export const readVolumes = (paths: readonly string[]): readonly VolumeInfo[] => {
  const seen = new Map<string, VolumeInfo>();
  for (const path of [systemRoot(), ...paths]) {
    const reading = readVolume(path);
    if (!reading) continue;
    if (!seen.has(reading.key)) seen.set(reading.key, reading.volume);
  }
  return [...seen.values()];
};

export const storageProbe = (paths: readonly string[]): DeviceProbe => ({
  id: "storage",
  detect: () => true,
  run: () =>
    neverFails(
      Effect.sync(() => {
        const storage = readVolumes(paths);
        return { fragment: { storage }, capabilities: storage.length > 0 ? ["storage" as const] : [] };
      }),
    ),
});
