import type { Gpu, RecipeCatalog } from "@local-studio/contracts";
import type { Ctx } from "../context";

export interface ComputeApp {
  uuid: string;
  pid: number;
  processName: string;
  usedMiB: number;
}

export interface GpuScan {
  gpus: Gpu[];
  apps: ComputeApp[];
  error: string | null;
}

export type HardwareList = RecipeCatalog["hardware"];

export const normProduct = (s: string): string =>
  s
    .toLowerCase()
    .replace(/nvidia|geforce|intel|amd|radeon|generation|workstation|edition|\d+\s*gb/g, "")
    .replace(/[^a-z0-9]/g, "");

export const displayName = (s: string): string => s.replace(/^(NVIDIA GeForce |NVIDIA |Intel |AMD Radeon |AMD )/, "").trim();

export const matchHardware = (hw: HardwareList | null, backend: string, product: string, totalMiB: number): string | null => {
  if (!hw) return null;
  const n = normProduct(product);
  const hit = hw.find(
    (h) =>
      h.match.backend === backend &&
      (h.match.names.includes(n) || normProduct(h.match.name) === n) &&
      Math.abs(h.match.vramGb * 1024 - totalMiB) <= 1024,
  );
  return hit?.hardwareId ?? null;
};

const cell = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const v = s.trim();
  if (!v || /N\/A|Not Supported|\[/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const scanNvidia = async (ctx: Ctx, hw: HardwareList | null): Promise<GpuScan> => {
  const q = await ctx.exec(
    [
      "nvidia-smi",
      "--query-gpu=index,name,uuid,pci.bus_id,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw,power.limit",
      "--format=csv,noheader,nounits",
    ],
    { timeoutMs: 5000 },
  );
  if (q.code !== 0) return { gpus: [], apps: [], error: q.timedOut ? "nvidia-smi timed out" : q.stderr.includes("ENOENT") || q.code === null ? null : `nvidia-smi: ${q.stderr.trim().slice(0, 200)}` };
  const a = await ctx.exec(["nvidia-smi", "--query-compute-apps=gpu_uuid,pid,process_name,used_memory", "--format=csv,noheader,nounits"], { timeoutMs: 5000 });
  const apps: ComputeApp[] = [];
  if (a.code === 0) {
    for (const line of a.stdout.split("\n")) {
      const f = line.split(",").map((s) => s.trim());
      if (f.length < 4 || !f[0]) continue;
      apps.push({ uuid: f[0] as string, pid: Number(f[1]), processName: f[2] as string, usedMiB: cell(f[3]) ?? 0 });
    }
  }
  const gpus: Gpu[] = [];
  for (const line of q.stdout.split("\n")) {
    const f = line.split(",").map((s) => s.trim());
    if (f.length < 10 || f[0] === "") continue;
    const index = Number(f[0]);
    const product = f[1] as string;
    const uuid = f[2] as string;
    const total = cell(f[5]) ?? 0;
    gpus.push({
      key: `nvidia:${index}`,
      backend: "nvidia",
      index,
      uuid,
      busId: f[3] ?? null,
      product,
      name: displayName(product),
      hardwareId: matchHardware(hw, "nvidia", product, total),
      memTotalMiB: total,
      memUsedMiB: cell(f[4]),
      utilPct: cell(f[6]),
      tempC: cell(f[7]),
      powerW: cell(f[8]),
      powerLimitW: cell(f[9]),
      processes: apps.filter((p) => p.uuid === uuid).map((p) => ({ pid: p.pid, processName: p.processName, usedMiB: p.usedMiB, modelId: null })),
    });
  }
  return { gpus, apps, error: null };
};

let appleCache: { product: string; totalMiB: number } | null = null;

const scanApple = async (ctx: Ctx, hw: HardwareList | null): Promise<GpuScan> => {
  if (!appleCache) {
    const [m, c] = await Promise.all([
      ctx.exec(["sysctl", "-n", "hw.memsize"], { timeoutMs: 3000 }),
      ctx.exec(["sysctl", "-n", "machdep.cpu.brand_string"], { timeoutMs: 3000 }),
    ]);
    const bytes = Number(m.stdout.trim());
    if (m.code !== 0 || !Number.isFinite(bytes)) return { gpus: [], apps: [], error: "sysctl hw.memsize failed" };
    appleCache = { product: c.stdout.trim() || "Apple Silicon", totalMiB: Math.round(bytes / 1048576) };
  }
  const { product, totalMiB } = appleCache;
  const vm = await ctx.exec(["vm_stat"], { timeoutMs: 3000, env: { LC_ALL: "C" } });
  let memUsedMiB: number | null = null;
  if (vm.code === 0) {
    const page = Number(/page size of (\d+) bytes/.exec(vm.stdout)?.[1] ?? 16384);
    const pages = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(vm.stdout)?.[1] ?? 0);
    const used = pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor");
    if (used > 0) memUsedMiB = Math.round((used * page) / 1048576);
  }
  return {
    gpus: [
      {
        key: "apple:0",
        backend: "apple",
        index: 0,
        uuid: "apple:0",
        busId: null,
        product,
        name: product.replace(/^Apple /, ""),
        hardwareId: matchHardware(hw, "apple", product, totalMiB),
        memTotalMiB: totalMiB,
        memUsedMiB,
        utilPct: null,
        tempC: null,
        powerW: null,
        powerLimitW: null,
        processes: [],
      },
    ],
    apps: [],
    error: null,
  };
};

export const scanGpus = (ctx: Ctx, hw: HardwareList | null): Promise<GpuScan> =>
  ctx.config.platform === "darwin" ? scanApple(ctx, hw) : scanNvidia(ctx, hw);

export const resolveGpuRefs = (refs: string[], gpus: Gpu[]): Gpu[] => {
  if (refs.some((r) => r.trim().toLowerCase() === "all")) return gpus;
  const out: Gpu[] = [];
  for (const raw of refs) {
    const r = raw.trim();
    if (!r || r.toLowerCase() === "none" || r.toLowerCase() === "void") continue;
    const g = /^\d+$/.test(r) ? gpus.find((x) => x.index === Number(r)) : gpus.find((x) => x.uuid === r || x.uuid.startsWith(r));
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
};
