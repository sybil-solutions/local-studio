import { readdir, readFile, readlink } from "node:fs/promises";
import type { Gpu, RecipeCatalog } from "@local-studio/contracts";
import type { Ctx } from "../context";

export interface ComputeApp {
  uuid: string;
  pid: number;
  processName: string;
  usedMiB: number | null;
}

export interface GpuScan {
  gpus: Gpu[];
  apps: ComputeApp[];
  error: string | null;
  nodes: Map<string, string>;
}

export type HardwareList = RecipeCatalog["hardware"];

export const normProduct = (s: string): string =>
  s
    .toLowerCase()
    .replace(/nvidia|geforce|intel|amd|radeon|generation|workstation|edition|\d+\s*gb/g, "")
    .replace(/[^a-z0-9]/g, "");

export const displayName = (s: string): string => s.replace(/^(NVIDIA GeForce |NVIDIA |Intel |AMD Radeon |AMD )/, "").trim();

export const matchHardware = (hw: HardwareList | null, backend: string, product: string, totalMiB: number, unified?: boolean): string | null => {
  if (!hw) return null;
  const n = normProduct(product);
  const gap = (h: HardwareList[number]) => Math.abs(h.match.vramGb * 1024 - totalMiB);
  const hit = hw
    .filter((h) => h.match.backend === backend && (h.match.names.includes(n) || normProduct(h.match.name) === n) && (unified || gap(h) <= Math.max(1024, h.match.vramGb * 51)))
    .sort((a, b) => gap(a) - gap(b))[0];
  return hit?.hardwareId ?? `${backend}-${normProduct(product)}`;
};

const systemMem = async (): Promise<{ total: number; used: number } | null> => {
  const t = (await readFile("/proc/meminfo", "utf8").catch(() => "")) as string;
  const kib = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(t)?.[1] ?? Number.NaN);
  const total = kib("MemTotal");
  const avail = kib("MemAvailable");
  return Number.isFinite(total) && Number.isFinite(avail) ? { total: Math.round(total / 1024), used: Math.round((total - avail) / 1024) } : null;
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
  if (q.code !== 0) return { nodes: new Map(), gpus: [], apps: [], error: q.timedOut ? "nvidia-smi timed out" : q.stderr.includes("ENOENT") || q.code === null ? null : `nvidia-smi: ${q.stderr.trim().slice(0, 200)}` };
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
  let sys: { total: number; used: number } | null | undefined;
  for (const line of q.stdout.split("\n")) {
    const f = line.split(",").map((s) => s.trim());
    if (f.length < 10 || f[0] === "") continue;
    const index = Number(f[0]);
    const product = f[1] as string;
    const uuid = f[2] as string;
    const unified = cell(f[5]) === null;
    if (unified && sys === undefined) sys = await systemMem();
    const total = cell(f[5]) ?? sys?.total ?? 0;
    gpus.push({
      key: `nvidia:${index}`,
      backend: "nvidia",
      index,
      uuid,
      busId: f[3] ?? null,
      product,
      name: displayName(product),
      hardwareId: matchHardware(hw, "nvidia", product, total, unified),
      memTotalMiB: total,
      memUsedMiB: unified ? (sys?.used ?? null) : cell(f[4]),
      unified: unified || undefined,
      utilPct: cell(f[6]),
      tempC: cell(f[7]),
      powerW: cell(f[8]),
      powerLimitW: cell(f[9]),
      processes: apps.filter((p) => p.uuid === uuid).map((p) => ({ pid: p.pid, processName: p.processName, usedMiB: p.usedMiB, modelId: null })),
    });
  }
  return { gpus, apps, error: null, nodes: new Map() };
};

const rd = (p: string): Promise<string | null> => readFile(p, "utf8").then((s) => s.trim(), () => null);
const lsdir = (p: string): Promise<string[]> => readdir(p).catch(() => []);
const intelNames = new Map<string, string>();
const intelPrev = new Map<string, { t: number; idle: number | null; energy: number | null }>();
let intelApps: ComputeApp[] = [];
let intelMem = new Map<string, number | null>();

const intelName = async (ctx: Ctx, bus: string, dev: string): Promise<string> => {
  const hit = intelNames.get(bus);
  if (hit) return hit;
  const r = await ctx.exec(["lspci", "-mm", "-s", bus], { timeoutMs: 3000 });
  const name = /\[([^\]]+)\]"/.exec(r.stdout)?.[1];
  const product = name ? `Intel ${name}` : `Intel GPU 8086:${dev.replace(/^0x/, "")}`;
  if (r.code === 0) intelNames.set(bus, product);
  return product;
};

const scanIntel = async (ctx: Ctx, hw: HardwareList | null): Promise<GpuScan> => {
  const cards = (await lsdir("/sys/class/drm")).filter((c) => /^card\d+$/.test(c));
  const found: { dev: string; bus: string; card: string; render: string | null }[] = [];
  for (const card of cards) {
    const dev = `/sys/class/drm/${card}/device`;
    if ((await rd(`${dev}/vendor`)) !== "0x8086") continue;
    const driver = await readlink(`${dev}/driver`).catch(() => "");
    if (!driver.endsWith("/xe")) continue;
    const bus = (await readlink(dev).catch(() => "")).split("/").pop() ?? "";
    const render = (await lsdir(`${dev}/drm`)).find((x) => x.startsWith("renderD")) ?? null;
    found.push({ dev, bus, card, render });
  }
  found.sort((a, b) => a.bus.localeCompare(b.bus));
  const nodes = new Map<string, string>();
  const gpus: Gpu[] = [];
  for (const [index, f] of found.entries()) {
    const uuid = `intel:${f.bus}`;
    nodes.set(`/dev/dri/${f.card}`, uuid);
    if (f.render) nodes.set(`/dev/dri/${f.render}`, uuid);
    const product = await intelName(ctx, f.bus, (await rd(`${f.dev}/device`)) ?? "");
    const bars = ((await rd(`${f.dev}/resource`)) ?? "").split("\n").map((l) => {
      const [a, b] = l.trim().split(/\s+/).map((x) => Number.parseInt(x ?? "", 16));
      return a && b ? (b - a + 1) / 1048576 : 0;
    });
    const bar = Math.max(0, ...bars);
    const total = bar >= 1024 ? Math.round(bar) : 0;
    const hwmon = (await lsdir(`${f.dev}/hwmon`))[0];
    const hm = hwmon ? `${f.dev}/hwmon/${hwmon}` : null;
    const hmFiles = hm ? await lsdir(hm) : [];
    const labelled = async (kind: string, label: string): Promise<number | null> => {
      for (const x of hmFiles.filter((n) => n.startsWith(kind) && n.endsWith("_label")))
        if ((await rd(`${hm}/${x}`)) === label) return Number(await rd(`${hm}/${x.replace("_label", "_input")}`));
      return null;
    };
    const temp = await labelled("temp", "pkg");
    const energy = (await labelled("energy", "card")) ?? (await labelled("energy", "pkg"));
    const cap = hm ? Number(await rd(`${hm}/power1_cap`)) : Number.NaN;
    let idle: number | null = null;
    for (const tile of (await lsdir(f.dev)).filter((x) => /^tile\d+$/.test(x)))
      for (const gt of await lsdir(`${f.dev}/${tile}`)) {
        const base = `${f.dev}/${tile}/${gt}/gtidle`;
        if (!((await rd(`${base}/name`)) ?? "").includes("-rc")) continue;
        const v = Number(await rd(`${base}/idle_residency_ms`));
        if (Number.isFinite(v)) idle = (idle ?? 0) + v;
      }
    const now = Date.now();
    const prev = intelPrev.get(uuid);
    intelPrev.set(uuid, { t: now, idle, energy });
    const dt = prev ? now - prev.t : 0;
    const util = prev && dt > 200 && idle !== null && prev.idle !== null ? Math.round(Math.min(100, Math.max(0, 100 * (1 - (idle - prev.idle) / dt)))) : null;
    const power = prev && dt > 200 && energy !== null && prev.energy !== null && energy >= prev.energy ? Math.round((energy - prev.energy) / dt / 1000) : null;
    gpus.push({
      key: `intel:${index}`,
      backend: "intel-xpu",
      index,
      uuid,
      busId: f.bus,
      product,
      name: displayName(product),
      hardwareId: matchHardware(hw, "intel-xpu", product, total),
      memTotalMiB: total,
      memUsedMiB: intelMem.has(uuid) ? (intelMem.get(uuid) ?? null) : null,
      utilPct: util,
      tempC: temp !== null && Number.isFinite(temp) ? Math.round(temp / 1000) : null,
      powerW: power,
      powerLimitW: Number.isFinite(cap) && cap > 0 ? Math.round(cap / 1e6) : null,
      processes: intelApps.filter((a) => a.uuid === uuid).map((a) => ({ pid: a.pid, processName: a.processName, usedMiB: a.usedMiB, modelId: null })),
    });
  }
  return { gpus, apps: intelApps.filter((a) => gpus.some((g) => g.uuid === a.uuid)), error: null, nodes };
};

export interface DrmClient {
  uuid: string;
  pid: number;
  client: string;
  kib: number;
}

export const drmKiB = (v: string): number => {
  const m = /^\s*(\d+)\s*(KiB|MiB|GiB)?/.exec(v);
  return m ? Number(m[1]) * (m[2] === "GiB" ? 1048576 : m[2] === "MiB" ? 1024 : m[2] === "KiB" ? 1 : 1 / 1024) : 0;
};

export const drmClients = async (pids: number[], nodes: Map<string, string>): Promise<DrmClient[]> => {
  const out: DrmClient[] = [];
  for (const pid of pids)
    for (const fd of await lsdir(`/proc/${pid}/fd`)) {
      const uuid = nodes.get(await readlink(`/proc/${pid}/fd/${fd}`).catch(() => ""));
      if (!uuid) continue;
      const info = (await rd(`/proc/${pid}/fdinfo/${fd}`)) ?? "";
      out.push({ uuid, pid, client: /drm-client-id:\s*(\d+)/.exec(info)?.[1] ?? `${pid}/${fd}`, kib: drmKiB(/drm-total-vram0:([^\n]*)/.exec(info)?.[1] ?? "") });
    }
  return out;
};

export const sumClients = (cs: { key: string; kib: number }[]): number => {
  const m = new Map<string, number>();
  for (const c of cs) m.set(c.key, Math.max(m.get(c.key) ?? 0, c.kib));
  return [...m.values()].reduce((s, v) => s + v, 0) / 1024;
};

export const intelClients = (clients: DrmClient[], pids: number[], names: Map<number, string>): ComputeApp[] => {
  const out: ComputeApp[] = [];
  for (const pid of pids)
    for (const uuid of new Set(clients.filter((c) => c.pid === pid).map((c) => c.uuid)))
      out.push({ uuid, pid, processName: names.get(pid) ?? String(pid), usedMiB: Math.round(sumClients(clients.filter((c) => c.pid === pid && c.uuid === uuid).map((c) => ({ key: c.client, kib: c.kib })))) });
  return out;
};

const vramCache = new Map<string, { at: number; clients: { bus: string; client: string; kib: number }[] | null }>();

export const containerDrm = async (ctx: Ctx, containerId: string): Promise<{ bus: string; client: string; kib: number }[] | null> => {
  const hit = vramCache.get(containerId);
  if (hit && Date.now() - hit.at < 15_000) return hit.clients;
  const r = await ctx.exec(["docker", "exec", containerId, "sh", "-c", "grep -sHE '^(drm-pdev|drm-client-id|drm-total-vram0):' /proc/[0-9]*/fdinfo/*"], { timeoutMs: 4000 });
  let clients: { bus: string; client: string; kib: number }[] | null = null;
  if (!r.timedOut && (r.code === 0 || r.code === 1 || r.code === 2) && !r.stderr.trim()) {
    const files = new Map<string, { bus?: string; client?: string; kib?: number }>();
    for (const line of r.stdout.split("\n")) {
      const m = /^(.+?):(drm-pdev|drm-client-id|drm-total-vram0):\s*(.*)$/.exec(line);
      if (!m) continue;
      const f = files.get(m[1] ?? "") ?? {};
      if (m[2] === "drm-pdev") f.bus = m[3]?.trim();
      else if (m[2] === "drm-client-id") f.client = m[3]?.trim();
      else f.kib = drmKiB(m[3] ?? "");
      files.set(m[1] ?? "", f);
    }
    clients = [...files.values()].filter((f) => f.bus && f.client).map((f) => ({ bus: f.bus!, client: f.client!, kib: f.kib ?? 0 }));
  }
  vramCache.set(containerId, { at: Date.now(), clients });
  return clients;
};

export const intelMemUsed = (uuids: string[], host: DrmClient[], containers: { uuids: string[]; clients: { bus: string; client: string; kib: number }[] | null }[]): Map<string, number | null> => {
  const out = new Map<string, number | null>();
  for (const uuid of uuids) {
    if (containers.some((c) => c.clients === null && c.uuids.includes(uuid))) {
      out.set(uuid, null);
      continue;
    }
    const bus = uuid.slice("intel:".length);
    const keys = [...host.filter((c) => c.uuid === uuid).map((c) => ({ key: c.client, kib: c.kib })), ...containers.flatMap((c) => (c.clients ?? []).filter((x) => x.bus === bus).map((x) => ({ key: x.client, kib: x.kib })))];
    out.set(uuid, Math.round(sumClients(keys)));
  }
  return out;
};

export const setIntelApps = (gs: GpuScan, apps: ComputeApp[], mem: Map<string, number | null>): void => {
  intelApps = apps;
  intelMem = mem;
  gs.apps = [...gs.apps.filter((a) => !a.uuid.startsWith("intel:")), ...apps];
  for (const g of gs.gpus) {
    if (g.backend !== "intel-xpu") continue;
    const mine = apps.filter((a) => a.uuid === g.uuid);
    g.processes = mine.map((a) => ({ pid: a.pid, processName: a.processName, usedMiB: a.usedMiB, modelId: null }));
    g.memUsedMiB = mem.has(g.uuid) ? (mem.get(g.uuid) ?? null) : null;
  }
};

let appleCache: { product: string; totalMiB: number } | null = null;

const scanApple = async (ctx: Ctx, hw: HardwareList | null): Promise<GpuScan> => {
  if (!appleCache) {
    const [m, c] = await Promise.all([
      ctx.exec(["sysctl", "-n", "hw.memsize"], { timeoutMs: 3000 }),
      ctx.exec(["sysctl", "-n", "machdep.cpu.brand_string"], { timeoutMs: 3000 }),
    ]);
    const bytes = Number(m.stdout.trim());
    if (m.code !== 0 || !Number.isFinite(bytes)) return { gpus: [], apps: [], error: "sysctl hw.memsize failed", nodes: new Map() };
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
        hardwareId: matchHardware(hw, "apple", product, totalMiB, true),
        memTotalMiB: totalMiB,
        memUsedMiB,
        unified: true,
        utilPct: null,
        tempC: null,
        powerW: null,
        powerLimitW: null,
        processes: [],
      },
    ],
    apps: [],
    error: null,
    nodes: new Map(),
  };
};

export const scanGpus = async (ctx: Ctx, hw: HardwareList | null): Promise<GpuScan> => {
  if (ctx.config.platform === "darwin") return scanApple(ctx, hw);
  const [nv, intel] = await Promise.all([scanNvidia(ctx, hw), scanIntel(ctx, hw).catch((e) => ({ gpus: [], apps: [], nodes: new Map(), error: `intel gpu scan: ${String(e)}` }))]);
  return { gpus: [...nv.gpus, ...intel.gpus], apps: [...nv.apps, ...intel.apps], error: nv.error ?? intel.error, nodes: intel.nodes };
};

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
