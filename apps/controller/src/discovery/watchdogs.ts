import type { Watchdog } from "@local-studio/contracts";
import { ancestors, type ProcTable } from "./procs";

const SHELL = /^(\S*\/)?(bash|sh|zsh|dash|tmux|screen|timeout|nohup|env)(\s|$)/;

export const findWatchdogs = (t: ProcTable, patterns: string[]): Watchdog[] => {
  if (!patterns.length) return [];
  const self = process.pid;
  const hits: { pid: number; name: string; args: string }[] = [];
  for (const p of t.byPid.values()) {
    if (p.pid === self || /\b(pgrep|grep|ps)\b/.test(p.args.split(/\s+/)[0] ?? "")) continue;
    const name = patterns.find((pat) => p.args.includes(pat));
    if (name) hits.push({ pid: p.pid, name, args: p.args });
  }
  const pids = new Set(hits.map((h) => h.pid));
  const out: Watchdog[] = [];
  for (const h of hits) {
    const hasMatchingChild = SHELL.test(h.args) && hits.some((o) => o.pid !== h.pid && ancestors(t, o.pid).includes(h.pid));
    if (hasMatchingChild) continue;
    const parentAlsoHit = ancestors(t, h.pid)
      .slice(1)
      .some((a) => pids.has(a) && !SHELL.test(t.byPid.get(a)?.args ?? ""));
    if (parentAlsoHit) continue;
    out.push({ name: h.name, pid: h.pid, note: h.args.length > 200 ? `${h.args.slice(0, 200)}…` : h.args });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || (a.pid ?? 0) - (b.pid ?? 0));
};
