import { cpus, freemem, totalmem } from "node:os";
import * as Effect from "effect/Effect";
import type { LocalGpu, LocalHardware } from "../../../packages/contracts/src/localStudio.ts";
import { exec } from "./core.ts";

export type RawGpu = Omit<LocalGpu, "card"> & { uuid: string; wddm: boolean };

export const readGpus: Effect.Effect<RawGpu[]> = Effect.gen(function* () {
  const fields = "index,uuid,name,memory.used,memory.total" + (process.platform === "win32" ? ",driver_model.current" : "");
  const q = yield* exec(["nvidia-smi", `--query-gpu=${fields}`, "--format=csv,noheader,nounits"], 8_000);
  if (q.code !== 0) return [];
  const apps = (yield* exec(["nvidia-smi", "--query-compute-apps=gpu_uuid,pid", "--format=csv,noheader"], 8_000)).stdout.split("\n").map((l) => l.split(",")[0]?.trim());
  return q.stdout
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const [index = "", uuid = "", name = "", used = "", total = "", driver = ""] = l.split(",").map((s) => s.trim());
      const wddm = process.platform === "win32" && driver.toUpperCase() === "WDDM";
      return { index: Number(index) || 0, uuid, name, wddm, memoryUsedMiB: Number(used) || 0, memoryTotalMiB: Number(total) || 0, busy: (!wddm && apps.includes(uuid)) || Number(used) > 2048 };
    });
});

export const hardware = (gpus: LocalGpu[]): LocalHardware => ({ cpus: cpus().length, memTotalBytes: totalmem(), memFreeBytes: freemem(), gpus });
