import { readFileSync } from "node:fs";
import type { Ctx } from "../context";

export interface Proc {
  pid: number;
  ppid: number;
  uid: number;
  rssKiB: number;
  start: string;
  args: string;
}

export interface ProcTable {
  byPid: Map<number, Proc>;
  children: Map<number, number[]>;
}

export interface Listener {
  port: number;
  bind: string;
  pid: number | null;
  process: string | null;
}

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d+:\d+:\d+\s+\d{4})\s+(.*)$/;

export const listProcs = async (ctx: Ctx): Promise<ProcTable> => {
  const r = await ctx.exec(["ps", "-eo", "pid=,ppid=,uid=,rss=,lstart=,args="], { timeoutMs: 5000, env: { LC_ALL: "C", LANG: "C" } });
  if (r.timedOut || !r.stdout.trim()) throw new Error(r.timedOut ? "ps timed out" : `ps exited ${r.code}`);
  const byPid = new Map<number, Proc>();
  const children = new Map<number, number[]>();
  for (const line of r.stdout.split("\n")) {
    const m = PS_LINE.exec(line);
    if (!m) continue;
    const p: Proc = { pid: Number(m[1]), ppid: Number(m[2]), uid: Number(m[3]), rssKiB: Number(m[4]), start: (m[5] as string).replace(/\s+/g, " "), args: m[6] as string };
    byPid.set(p.pid, p);
    const list = children.get(p.ppid);
    if (list) list.push(p.pid);
    else children.set(p.ppid, [p.pid]);
  }
  return { byPid, children };
};

export const ancestors = (t: ProcTable, pid: number): number[] => {
  const out: number[] = [];
  const seen = new Set<number>();
  let cur: number | undefined = pid;
  while (cur !== undefined && cur > 1 && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    const ppid: number | undefined = t.byPid.get(cur)?.ppid ?? procStatusPpid(cur);
    cur = ppid;
  }
  return out;
};

const procStatusPpid = (pid: number): number | undefined => {
  if (process.platform !== "linux") return undefined;
  try {
    const m = /^PPid:\s*(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
    return m ? Number(m[1]) : undefined;
  } catch {
    return undefined;
  }
};

export const descendants = (t: ProcTable, root: number): number[] => {
  const out: number[] = [];
  const queue = [root];
  const seen = new Set<number>();
  while (queue.length) {
    const p = queue.shift() as number;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    for (const c of t.children.get(p) ?? []) queue.push(c);
  }
  return out;
};

export const cmdline = (t: ProcTable, pid: number): string[] => {
  if (process.platform === "linux") {
    try {
      const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      const parts = raw.split("\0").filter((s, i, a) => s !== "" || i < a.length - 1);
      if (parts.length) return parts;
    } catch {}
  }
  const args = t.byPid.get(pid)?.args ?? "";
  return args ? args.split(/\s+/) : [];
};

const splitHostPort = (s: string): { host: string; port: number } | null => {
  const i = s.lastIndexOf(":");
  if (i < 0) return null;
  const port = Number(s.slice(i + 1));
  if (!Number.isInteger(port)) return null;
  return { host: s.slice(0, i).replace(/^\[|\]$/g, "").replace(/%.*$/, ""), port };
};

const parseSs = (out: string): Listener[] => {
  const res: Listener[] = [];
  for (const line of out.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 4) continue;
    const local = f[0] === "LISTEN" ? f[3] : f[2];
    const hp = local ? splitHostPort(local) : null;
    if (!hp) continue;
    const users = /users:\(\("([^"]*)",pid=(\d+)/.exec(line);
    res.push({ port: hp.port, bind: hp.host, pid: users ? Number(users[2]) : null, process: users ? (users[1] as string) : null });
  }
  return res;
};

const parseLsof = (out: string): Listener[] => {
  const res: Listener[] = [];
  let pid: number | null = null;
  let cmd: string | null = null;
  for (const line of out.split("\n")) {
    const tag = line[0];
    const v = line.slice(1);
    if (tag === "p") pid = Number(v);
    else if (tag === "c") cmd = v;
    else if (tag === "n") {
      const hp = splitHostPort(v);
      if (hp) res.push({ port: hp.port, bind: hp.host === "*" ? "0.0.0.0" : hp.host, pid, process: cmd });
    }
  }
  return res;
};

export const listListeners = async (ctx: Ctx): Promise<Listener[]> => {
  const darwin = ctx.config.platform === "darwin";
  const r = await ctx.exec(darwin ? ["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-FpcnT"] : ["ss", "-ltnpH"], { timeoutMs: 5000 });
  if (r.timedOut) throw new Error(`${darwin ? "lsof" : "ss"} timed out`);
  const raw = darwin ? parseLsof(r.stdout) : parseSs(r.stdout);
  const byPort = new Map<number, Listener>();
  const rank = (l: Listener): number => (l.pid ? 4 : 0) + (l.bind.includes(":") ? 0 : 2) + (l.bind === "0.0.0.0" || l.bind === "127.0.0.1" ? 1 : 0);
  for (const l of raw) {
    const cur = byPort.get(l.port);
    if (!cur || rank(l) > rank(cur)) byPort.set(l.port, l);
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
};

export const probeHost = (bind: string): string => {
  if (!bind || bind === "0.0.0.0" || bind === "*" || bind === "::" || bind === "127.0.0.1") return "127.0.0.1";
  if (bind === "::1") return "[::1]";
  if (bind.includes(":")) return `[${bind}]`;
  return bind;
};
