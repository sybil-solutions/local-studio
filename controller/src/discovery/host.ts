import { readdir, readFile } from "node:fs/promises";
import { cpus, homedir, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import type { DiskRole, HostDisk, HostResources } from "@local-studio/contracts";
import type { Ctx } from "../context";

const DISK_MS = 60_000;
const DOCKER_ROOT_MS = 600_000;
const MIB = 1048576;

const rd = (p: string): Promise<string> => readFile(p, "utf8").catch(() => "");

const physicalCores = async (ctx: Ctx): Promise<number | null> => {
  if (ctx.config.platform === "darwin") {
    const r = await ctx.exec(["sysctl", "-n", "hw.physicalcpu"], { timeoutMs: 3000 });
    const n = Number(r.stdout.trim());
    return r.code === 0 && n > 0 ? n : null;
  }
  const dirs = (await readdir("/sys/devices/system/cpu").catch(() => [] as string[])).filter((d) => /^cpu\d+$/.test(d));
  const sets = new Set<string>();
  for (const d of dirs) {
    const s = (await rd(`/sys/devices/system/cpu/${d}/topology/thread_siblings_list`)).trim();
    const pkg = (await rd(`/sys/devices/system/cpu/${d}/topology/physical_package_id`)).trim();
    if (s) sets.add(`${pkg}/${s}`);
  }
  return sets.size || null;
};

const cpuModel = async (ctx: Ctx): Promise<string> => {
  const m = cpus()[0]?.model?.trim();
  if (m) return m;
  if (ctx.config.platform !== "linux") return "";
  const r = await ctx.exec(["lscpu"], { timeoutMs: 3000, env: { LC_ALL: "C" } });
  const names = [...r.stdout.matchAll(/^Model name:\s*(.+)$/gm)].map((x) => (x[1] ?? "").trim());
  return [...new Set(names)].join(" + ");
};

const linuxMem = async (): Promise<{ totalMiB: number; usedMiB: number | null } | null> => {
  const t = await rd("/proc/meminfo");
  const kib = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(t)?.[1] ?? Number.NaN);
  const total = kib("MemTotal");
  const avail = kib("MemAvailable");
  if (!Number.isFinite(total)) return null;
  return { totalMiB: Math.round(total / 1024), usedMiB: Number.isFinite(avail) ? Math.round((total - avail) / 1024) : null };
};

const darwinMem = async (ctx: Ctx): Promise<{ totalMiB: number; usedMiB: number | null }> => {
  const totalMiB = Math.round(totalmem() / MIB);
  const vm = await ctx.exec(["vm_stat"], { timeoutMs: 3000, env: { LC_ALL: "C" } });
  if (vm.code !== 0) return { totalMiB, usedMiB: null };
  const page = Number(/page size of (\d+) bytes/.exec(vm.stdout)?.[1] ?? 16384);
  const pages = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(vm.stdout)?.[1] ?? 0);
  const used = pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor");
  return { totalMiB, usedMiB: used > 0 ? Math.round((used * page) / MIB) : null };
};

const fsKey = (platform: string, device: string): string => (platform === "darwin" ? device.replace(/(disk\d+)(s\d+)+$/, "$1") : device);

export const createHostSampler = (ctx: Ctx) => {
  let prev: { idle: number; total: number } | null = null;
  let staticInfo: { model: string; cores: number | null } | null = null;
  let disks: { at: number; list: HostDisk[] } = { at: 0, list: [] };
  let dockerRoot: { at: number; path: string | null } = { at: 0, path: null };
  let current: HostResources | null = null;
  let busy = false;

  const cpuUtil = (): number | null => {
    const cs = cpus();
    let idle = 0;
    let total = 0;
    for (const c of cs) {
      const t = c.times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    const last = prev;
    prev = { idle, total };
    if (!last || total <= last.total) return null;
    return Math.round(Math.min(100, Math.max(0, (1 - (idle - last.idle) / (total - last.total)) * 100)));
  };

  const findDockerRoot = async (): Promise<string | null> => {
    if (Date.now() - dockerRoot.at < DOCKER_ROOT_MS) return dockerRoot.path;
    let path: string | null = null;
    if (Bun.which("docker")) {
      const r = await ctx.exec(["docker", "info", "--format", "{{.DockerRootDir}}"], { timeoutMs: 4000 });
      const p = r.stdout.trim();
      if (r.code === 0 && p.startsWith("/")) path = p;
    }
    dockerRoot = { at: Date.now(), path };
    return path;
  };

  const scanDisks = async (): Promise<HostDisk[]> => {
    if (Date.now() - disks.at < DISK_MS) return disks.list;
    const hf = process.env.HF_HOME ?? join(homedir(), ".cache", "huggingface");
    const docker = await findDockerRoot();
    const wanted: [string, DiskRole][] = [
      ["/", "root"],
      [homedir(), "home"],
      [ctx.config.modelsDir, "models"],
      [hf, "hf-cache"],
      [ctx.config.dataDir, "data"],
    ];
    if (docker) wanted.push([docker, "docker"]);
    const exists = (await Promise.all(wanted.map(async ([p, r]) => ((await Bun.file(p).stat().catch(() => null)) ? ([p, r] as [string, DiskRole]) : null)))).filter((x): x is [string, DiskRole] => !!x);
    const out = new Map<string, HostDisk>();
    for (const [p, role] of exists) {
      const r = await ctx.exec(["df", "-Pk", p], { timeoutMs: 4000, env: { LC_ALL: "C" } });
      const line = r.stdout.trim().split("\n")[1];
      if (r.code !== 0 || !line) continue;
      const f = line.split(/\s+/);
      const device = f[0] ?? "";
      const total = Number(f[1]);
      const avail = Number(f[3]);
      const mount = f.slice(5).join(" ");
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(avail)) continue;
      const hit = out.get(mount);
      if (hit) {
        if (!hit.roles.includes(role)) hit.roles.push(role);
        continue;
      }
      out.set(mount, { mount, device, roles: [role], totalMiB: Math.round(total / 1024), usedMiB: Math.round((total - avail) / 1024) });
    }
    disks = { at: Date.now(), list: [...out.values()] };
    return disks.list;
  };

  const storage = (list: HostDisk[]): HostResources["storage"] => {
    const byFs = new Map<string, HostDisk>();
    for (const d of list) {
      const k = fsKey(ctx.config.platform, d.device);
      const cur = byFs.get(k);
      if (!cur || d.totalMiB > cur.totalMiB) byFs.set(k, d);
    }
    if (!byFs.size) return null;
    const v = [...byFs.values()];
    return { totalMiB: v.reduce((s, d) => s + d.totalMiB, 0), usedMiB: v.reduce((s, d) => s + d.usedMiB, 0) };
  };

  const sample = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    const t = performance.now();
    try {
      if (!staticInfo) staticInfo = { model: await cpuModel(ctx), cores: await physicalCores(ctx) };
      const utilPct = cpuUtil();
      const mem = (ctx.config.platform === "darwin" ? await darwinMem(ctx) : await linuxMem()) ?? { totalMiB: Math.round(totalmem() / MIB), usedMiB: null };
      const list = await scanDisks();
      const [l1, l5, l15] = loadavg();
      const r2 = (x: number | undefined) => (x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
      current = {
        at: Date.now(),
        cpu: { model: staticInfo.model, cores: staticInfo.cores, threads: cpus().length, utilPct, load1: r2(l1), load5: r2(l5), load15: r2(l15) },
        mem,
        disks: list,
        storage: storage(list),
      };
    } catch (e) {
      ctx.log.warn(`host sample: ${String(e)}`, "scan.host");
    } finally {
      ctx.obs.observe("scan.host_ms", performance.now() - t);
      busy = false;
    }
  };

  return { sample, get: (): HostResources | null => current };
};
