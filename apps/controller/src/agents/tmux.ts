import { basename, resolve } from "node:path";
import type { Ctx } from "../context";
import { which } from "../core/exec";

const EXTRA_BIN = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

export const shq = (s: string) => (/^[A-Za-z0-9_./:@%+-][A-Za-z0-9_./:=@%+-]*$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export const TMUX_SOCKET = ["-L", "local-studio-agents", "-f", "/dev/null"];

export const sessionName = (harness: string, id: string) => `ls-${harness}-${id.slice(3)}`;

export const selfArgv = (): string[] => {
  const exe = process.execPath;
  const name = basename(exe);
  if (name === "bun" || name === "bun.exe" || name.startsWith("bun-")) return [exe, resolve(import.meta.dir, "../main.ts")];
  return [exe];
};

export const agentRunCommand = (home: string, id: string): string => [...selfArgv(), "agent", "run", id, "--home", home].map(shq).join(" ");

export const tmuxBin = async (): Promise<string | null> => which("tmux", EXTRA_BIN);

export const startSession = async (ctx: Ctx, tmux: string, name: string, dir: string, command: string): Promise<string | null> => {
  const r = await ctx.exec([tmux, ...TMUX_SOCKET, "start-server", ";", "set-option", "-g", "remain-on-exit", "on", ";", "new-session", "-d", "-s", name, "-c", dir, command], {
    timeoutMs: 10_000,
    cwd: dir,
  });
  return r.code === 0 ? null : (r.stderr || r.stdout).trim().slice(0, 300) || `tmux exited ${r.code}`;
};

export interface PaneState {
  name: string;
  dead: boolean;
  pid: number;
}

export const panes = async (ctx: Ctx, tmux: string): Promise<PaneState[]> => {
  const r = await ctx.exec([tmux, ...TMUX_SOCKET, "list-panes", "-a", "-F", "#{session_name}|#{pane_dead}|#{pane_pid}"], { timeoutMs: 5000 });
  if (r.code !== 0) return [];
  return r.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [name = "", dead = "0", pid = "0"] = l.split("|");
      return { name, dead: dead === "1", pid: Number(pid) };
    });
};

export const capture = async (ctx: Ctx, tmux: string, name: string): Promise<string> => {
  const r = await ctx.exec([tmux, ...TMUX_SOCKET, "capture-pane", "-p", "-t", `=${name}:`], { timeoutMs: 5000 });
  return r.stdout.split("\n").filter((l) => l.trim()).slice(-6).join("\n");
};

export const childArgs = async (ctx: Ctx, pid: number, depth = 0): Promise<string | null> => {
  const c = await ctx.exec(["pgrep", "-P", String(pid)], { timeoutMs: 5000 });
  const child = c.stdout.trim().split("\n")[0];
  if (!child) return null;
  const a = await ctx.exec(["ps", "-o", "args=", "-p", child], { timeoutMs: 5000 });
  const args = a.stdout.trim().slice(0, 300) || null;
  return args && / agent run ag_/.test(args) && depth < 2 ? childArgs(ctx, Number(child), depth + 1) : args;
};

export const killSession = async (ctx: Ctx, tmux: string, name: string): Promise<boolean> =>
  (await ctx.exec([tmux, ...TMUX_SOCKET, "kill-session", "-t", `=${name}`], { timeoutMs: 5000 })).code === 0;

export const attachCommand = (tmux: string, name: string) => [tmux, ...TMUX_SOCKET, "attach-session", "-t", `=${name}`].map(shq).join(" ");
