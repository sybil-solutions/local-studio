import { cpus, freemem, hostname, loadavg, platform, totalmem } from "node:os";
import * as Effect from "effect/Effect";
import type { LocalGpu, LocalHardware } from "../../../packages/contracts/src/localStudio.ts";
import { exec } from "./core.ts";

export interface RawGpu extends Omit<LocalGpu, "card" | "busy" | "jobId"> {
  apps: number;
}

const num = (s: string | undefined): number | null => {
  const n = Number(s?.trim());
  return s === undefined || Number.isNaN(n) ? null : n;
};

export const readGpus: Effect.Effect<RawGpu[]> = Effect.gen(function* () {
  const q = yield* exec(
    ["nvidia-smi", "--query-gpu=index,uuid,name,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw", "--format=csv,noheader,nounits"],
    8_000,
  );
  if (q.code !== 0) return [];
  const apps = yield* exec(["nvidia-smi", "--query-compute-apps=gpu_uuid,pid", "--format=csv,noheader"], 8_000);
  const busy = new Map<string, number>();
  for (const line of apps.stdout.split("\n")) {
    const uuid = line.split(",")[0]?.trim();
    if (uuid) busy.set(uuid, (busy.get(uuid) ?? 0) + 1);
  }
  return q.stdout
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const f = l.split(",").map((s) => s.trim());
      const uuid = f[1] ?? "";
      return {
        index: num(f[0]) ?? 0,
        uuid,
        name: f[2] ?? "",
        memoryUsedMiB: num(f[3]) ?? 0,
        memoryTotalMiB: num(f[4]) ?? 0,
        utilization: num(f[5]),
        temperatureC: num(f[6]),
        powerW: num(f[7]),
        apps: busy.get(uuid) ?? 0,
      };
    });
});

export const gpuBusy = (g: RawGpu): boolean => g.apps > 0 || g.memoryUsedMiB > 2048;

export const hardware = (gpus: LocalGpu[]): LocalHardware => ({
  hostname: hostname().split(".")[0] ?? "",
  platform: `${platform()}-${process.arch}`,
  cpus: cpus().length,
  loadAvg: loadavg(),
  memTotalBytes: totalmem(),
  memFreeBytes: freemem(),
  gpus,
});
