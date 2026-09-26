import { basename, resolve } from "node:path";
import type { Ctx } from "../context";
import { which } from "../core/exec";

const EXTRA_BIN = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

export const shq = (s: string) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export const TMUX_SOCKET = ["-L", "local-studio-agents", "-f", "/dev/null"];

export const sessionName = (wsId: string) => `ls-${wsId}`;

export const selfArgv = (): string[] => {
  const exe = process.execPath;
  const name = basename(exe);
  if (name === "bun" || name === "bun.exe" || name.startsWith("bun-")) return [exe, resolve(import.meta.dir, "../main.ts")];
  return [exe];
};

export const agentRunCommand = (home: string, wsId: string, resume: boolean): string =>
  [...selfArgv(), "agent", "run", wsId, "--home", home, ...(resume ? ["--resume"] : [])].map(shq).join(" ");

export const tmuxBin = async (): Promise<string | null> => which("tmux", EXTRA_BIN);

export const hasSession = async (ctx: Ctx, tmux: string, name: string): Promise<boolean> => {
  const r = await ctx.exec([tmux, ...TMUX_SOCKET, "has-session", "-t", `=${name}`], { timeoutMs: 5000 });
  return r.code === 0;
};

export const startSession = async (
  ctx: Ctx,
  tmux: string,
  name: string,
  dir: string,
  command: string,
): Promise<{ created: boolean; error: string | null }> => {
  if (await hasSession(ctx, tmux, name)) return { created: false, error: null };
  const r = await ctx.exec([tmux, ...TMUX_SOCKET, "new-session", "-d", "-A", "-s", name, "-c", dir, command], { timeoutMs: 10_000, cwd: dir });
  if (r.code !== 0) return { created: false, error: (r.stderr || r.stdout).trim().slice(0, 300) || `tmux exited ${r.code}` };
  return { created: true, error: null };
};

export const attachCommand = (tmux: string, name: string, dir: string, command: string) =>
  [tmux, ...TMUX_SOCKET, "new-session", "-A", "-s", name, "-c", dir, command].map(shq).join(" ");
