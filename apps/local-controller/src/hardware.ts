import { cpus, freemem, totalmem } from "node:os";
import * as Effect from "effect/Effect";
import type { LocalGpu, LocalHardware } from "../../../packages/contracts/src/localStudio.ts";
import { exec } from "./core.ts";

export type RawGpu = Omit<LocalGpu, "card"> & { uuid: string };

export const readGpus: Effect.Effect<RawGpu[]> = Effect.gen(function* () {
  const q = yield* exec(["nvidia-smi", "--query-gpu=index,uuid,name,memory.used,memory.total", "--format=csv,noheader,nounits"], 8_000);
  if (q.code !== 0) return [];
  const apps = (yield* exec(["nvidia-smi", "--query-compute-apps=gpu_uuid,pid", "--format=csv,noheader"], 8_000)).stdout.split("\n").map((l) => l.split(",")[0]?.trim());
  return q.stdout
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const [index = "", uuid = "", name = "", used = "", total = ""] = l.split(",").map((s) => s.trim());
      return { index: Number(index) || 0, uuid, name, memoryUsedMiB: Number(used) || 0, memoryTotalMiB: Number(total) || 0, busy: apps.includes(uuid) || Number(used) > 2048 };
    });
});

export const hardware = (gpus: LocalGpu[]): LocalHardware => ({ cpus: cpus().length, memTotalBytes: totalmem(), memFreeBytes: freemem(), gpus });
