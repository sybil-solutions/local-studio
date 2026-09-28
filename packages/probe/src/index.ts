import { readdir, readFile, readlink } from "node:fs/promises";
import type { Gpu } from "@local-studio/contracts";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface Sys {
  platform: string;
  exec(argv: string[], opts: { timeoutMs: number; env?: Record<string, string> }): Promise<ExecResult>;
}

export type Match = (backend: Gpu["backend"], product: string, memMiB: number) => string | null;

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

export const displayName = (s: string): string => s.replace(/^(NVIDIA GeForce |NVIDIA |Intel |AMD Radeon |AMD )/, "").trim();

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

const scanNvidia = async (sys: Sys, match: Match): Promise<GpuScan> => {
  const q = await sys.exec(
    [
      "nvidia-smi",
      "--query-gpu=index,name,uuid,pci.bus_id,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw,power.limit",
      "--format=csv,noheader,nounits",
    ],
    { timeoutMs: 5000 },
  );
  if (q.code !== 0) return { nodes: new Map(), gpus: [], apps: [], error: q.timedOut ? "nvidia-smi timed out" : q.stderr.includes("ENOENT") || q.code === null ? null : `nvidia-smi: ${q.stderr.trim().slice(0, 200)}` };
  const a = await sys.exec(["nvidia-smi", "--query-compute-apps=gpu_uuid,pid,process_name,used_memory", "--format=csv,noheader,nounits"], { timeoutMs: 5000 });
  const apps: ComputeApp[] = [];
  if (a.code === 0) {
    for (const line of a.stdout.split("\n")) {
      const f = line.split(",").map((s) => s.trim());
      if (f.length < 4 || !f[0]) continue;
      apps.push({ uuid: f[0] as string, pid: Number(f[1]), processName: f[2] as string, usedMiB: cell(f[3]) ?? 0 });
    }
  }
  const gpus: Gpu[] = [];
  let smem: { total: number; used: number } | null | undefined;
  for (const line of q.stdout.split("\n")) {
    const f = line.split(",").map((s) => s.trim());
    if (f.length < 10 || f[0] === "") continue;
    const index = Number(f[0]);
    const product = f[1] as string;
    const uuid = f[2] as string;
    const unified = cell(f[5]) === null;
    if (unified && smem === undefined) smem = await systemMem();
    const total = cell(f[5]) ?? smem?.total ?? 0;
    gpus.push({
      key: `nvidia:${index}`,
      backend: "nvidia",
      index,
      uuid,
      busId: f[3] ?? null,
      product,
      name: displayName(product),
      hardwareId: match("nvidia", product, total),
      memTotalMiB: total,
      memUsedMiB: unified ? (smem?.used ?? null) : cell(f[4]),
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

const intelName = async (sys: Sys, bus: string, dev: string): Promise<string> => {
  const hit = intelNames.get(bus);
  if (hit) return hit;
  const r = await sys.exec(["lspci", "-mm", "-s", bus], { timeoutMs: 3000 });
  const name = /\[([^\]]+)\]"/.exec(r.stdout)?.[1];
  const product = name ? `Intel ${name}` : `Intel GPU 8086:${dev.replace(/^0x/, "")}`;
  if (r.code === 0) intelNames.set(bus, product);
  return product;
};

const scanIntel = async (sys: Sys, match: Match): Promise<GpuScan> => {
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
    const product = await intelName(sys, f.bus, (await rd(`${f.dev}/device`)) ?? "");
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
      hardwareId: match("intel-xpu", product, total),
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

export const containerDrm = async (sys: Sys, containerId: string): Promise<{ bus: string; client: string; kib: number }[] | null> => {
  const hit = vramCache.get(containerId);
  if (hit && Date.now() - hit.at < 15_000) return hit.clients;
  const r = await sys.exec(["docker", "exec", containerId, "sh", "-c", "grep -sHE '^(drm-pdev|drm-client-id|drm-total-vram0):' /proc/[0-9]*/fdinfo/*"], { timeoutMs: 4000 });
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

const scanApple = async (sys: Sys, match: Match): Promise<GpuScan> => {
  if (!appleCache) {
    const [m, c] = await Promise.all([
      sys.exec(["sysctl", "-n", "hw.memsize"], { timeoutMs: 3000 }),
      sys.exec(["sysctl", "-n", "machdep.cpu.brand_string"], { timeoutMs: 3000 }),
    ]);
    const bytes = Number(m.stdout.trim());
    if (m.code !== 0 || !Number.isFinite(bytes)) return { gpus: [], apps: [], error: "sysctl hw.memsize failed", nodes: new Map() };
    appleCache = { product: c.stdout.trim() || "Apple Silicon", totalMiB: Math.round(bytes / 1048576) };
  }
  const { product, totalMiB } = appleCache;
  const vm = await sys.exec(["vm_stat"], { timeoutMs: 3000, env: { LC_ALL: "C" } });
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
        backend: "metal",
        index: 0,
        uuid: "apple:0",
        busId: null,
        product,
        name: product.replace(/^Apple /, ""),
        hardwareId: match("metal", product, totalMiB),
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

const hwmonOf = async (dev: string): Promise<string | null> => {
  const h = (await lsdir(`${dev}/hwmon`))[0];
  return h ? `${dev}/hwmon/${h}` : null;
};

const scanAmd = async (sys: Sys, match: Match): Promise<GpuScan> => {
  const cards = (await lsdir("/sys/class/drm")).filter((c) => /^card\d+$/.test(c)).sort();
  const gpus: Gpu[] = [];
  for (const card of cards) {
    const dev = `/sys/class/drm/${card}/device`;
    if ((await rd(`${dev}/vendor`)) !== "0x1002") continue;
    const total = Number(await rd(`${dev}/mem_info_vram_total`));
    if (!Number.isFinite(total) || total < 1024 ** 3) continue;
    const bus = (await readlink(dev).catch(() => "")).split("/").pop() ?? "";
    const r = await sys.exec(["lspci", "-mm", "-s", bus], { timeoutMs: 3000 });
    const name = /\[([^\]]+)\]"/.exec(r.stdout)?.[1];
    const product = name ? `AMD ${name}` : `AMD GPU 1002:${((await rd(`${dev}/device`)) ?? "").replace(/^0x/, "")}`;
    const used = Number(await rd(`${dev}/mem_info_vram_used`));
    const busy = Number(await rd(`${dev}/gpu_busy_percent`));
    const hm = await hwmonOf(dev);
    const power = hm ? Number((await rd(`${hm}/power1_average`)) ?? (await rd(`${hm}/power1_input`))) : Number.NaN;
    const cap = hm ? Number(await rd(`${hm}/power1_cap`)) : Number.NaN;
    const temp = hm ? Number(await rd(`${hm}/temp1_input`)) : Number.NaN;
    const index = gpus.length;
    const memTotalMiB = Math.round(total / 1048576);
    gpus.push({
      key: `amd:${index}`,
      backend: "amd-rocm",
      index,
      uuid: `amd:${bus}`,
      busId: bus,
      product,
      name: displayName(product),
      hardwareId: match("amd-rocm", product, memTotalMiB),
      memTotalMiB,
      memUsedMiB: Number.isFinite(used) ? Math.round(used / 1048576) : null,
      utilPct: Number.isFinite(busy) ? busy : null,
      tempC: Number.isFinite(temp) ? Math.round(temp / 1000) : null,
      powerW: Number.isFinite(power) ? Math.round(power / 1e6) : null,
      powerLimitW: Number.isFinite(cap) && cap > 0 ? Math.round(cap / 1e6) : null,
      processes: [],
    });
  }
  return { gpus, apps: [], error: null, nodes: new Map() };
};

export const scanGpus = async (sys: Sys, match: Match): Promise<GpuScan> => {
  if (sys.platform === "darwin") return scanApple(sys, match);
  const soft = (what: string) => (e: unknown): GpuScan => ({ gpus: [], apps: [], nodes: new Map(), error: `${what} gpu scan: ${String(e)}` });
  const [nv, intel, amd] = await Promise.all([scanNvidia(sys, match), scanIntel(sys, match).catch(soft("intel")), scanAmd(sys, match).catch(soft("amd"))]);
  return { gpus: [...nv.gpus, ...intel.gpus, ...amd.gpus], apps: [...nv.apps, ...intel.apps], error: nv.error ?? intel.error ?? amd.error, nodes: intel.nodes };
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

export interface FabricPort {
  hca: string;
  ifname: string;
  ip: string;
  gid: number | null;
}

const gidFor = async (hca: string, ip: string): Promise<number | null> => {
  const hex = ip.split(".").map((x) => Number(x).toString(16).padStart(2, "0"));
  const tail = `${hex[0]}${hex[1]}:${hex[2]}${hex[3]}`;
  for (let i = 0; i < 32; i++) {
    const gid = await rd(`/sys/class/infiniband/${hca}/ports/1/gids/${i}`);
    if (gid === null) break;
    const type = (await rd(`/sys/class/infiniband/${hca}/ports/1/gid_attrs/types/${i}`)) ?? "";
    if (/v2/i.test(type) && gid.endsWith(tail)) return i;
  }
  return null;
};

export const fabricPorts = async (): Promise<FabricPort[]> => {
  const out: FabricPort[] = [];
  const { networkInterfaces } = await import("node:os");
  const nics = networkInterfaces();
  for (const hca of (await lsdir("/sys/class/infiniband")).sort()) {
    for (const ifname of await lsdir(`/sys/class/infiniband/${hca}/device/net`)) {
      if ((await rd(`/sys/class/net/${ifname}/operstate`)) !== "up") continue;
      const ip = (nics[ifname] ?? []).find((a) => a.family === "IPv4" && !a.internal)?.address;
      if (ip) out.push({ hca, ifname, ip, gid: await gidFor(hca, ip) });
    }
  }
  return out.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
};
