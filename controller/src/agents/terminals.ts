import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "../context";
import { which } from "../core/exec";

export interface Session {
  command: string;
  dir: string;
  name: string;
}

export interface Terminal {
  id: string;
  label: string;
  probe: string;
  command: (s: Session) => string[];
  prepare?: (s: Session) => void;
}

const appleScript = (source: string) => ["osascript", "-e", source];
const asLiteral = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const warpDir = () => join(homedir(), ".warp", "tab_configs");

const macOS: Terminal[] = [
  {
    id: "terminal",
    label: "Terminal",
    probe: "/System/Applications/Utilities/Terminal.app",
    command: (s) => appleScript(`tell application "Terminal" to do script ${asLiteral(s.command)}`),
  },
  {
    id: "iterm",
    label: "iTerm",
    probe: "/Applications/iTerm.app",
    command: (s) => appleScript(`tell application "iTerm" to create window with default profile command ${asLiteral(s.command)}`),
  },
  {
    id: "warp",
    label: "Warp",
    probe: "/Applications/Warp.app",
    prepare: ({ command, dir, name }) => {
      mkdirSync(warpDir(), { recursive: true });
      writeFileSync(
        join(warpDir(), `${slug(name)}.toml`),
        `name = ${JSON.stringify(name)}\ntitle = ${JSON.stringify(name)}\n\n[[panes]]\nid = "main"\ntype = "terminal"\ndirectory = ${JSON.stringify(dir || homedir())}\ncommands = [${JSON.stringify(command)}]\nis_focused = true\n`,
      );
    },
    command: (s) => ["open", `warp://tab_config/${slug(s.name)}`],
  },
  {
    id: "ghostty",
    label: "Ghostty",
    probe: "/Applications/Ghostty.app",
    command: (s) => ["open", "-na", "Ghostty", "--args", "-e", "/bin/bash", "-lc", s.command],
  },
];

const linux: Terminal[] = [
  {
    id: "omarchy",
    label: "Omarchy",
    probe: "omarchy-launch-tui",
    command: (s) => ["omarchy-launch-tui", "--app-id=org.localstudio.agent", "bash", "-lc", s.command],
  },
  { id: "ghostty", label: "Ghostty", probe: "ghostty", command: (s) => ["ghostty", "-e", "bash", "-lc", s.command] },
  { id: "kitty", label: "kitty", probe: "kitty", command: (s) => ["kitty", "bash", "-lc", s.command] },
  { id: "alacritty", label: "Alacritty", probe: "alacritty", command: (s) => ["alacritty", "-e", "bash", "-lc", s.command] },
  { id: "wezterm", label: "WezTerm", probe: "wezterm", command: (s) => ["wezterm", "start", "--cwd", s.dir, "--", "bash", "-lc", s.command] },
  {
    id: "gnome-terminal",
    label: "GNOME Terminal",
    probe: "gnome-terminal",
    command: (s) => ["gnome-terminal", `--working-directory=${s.dir}`, "--", "bash", "-lc", s.command],
  },
  { id: "konsole", label: "Konsole", probe: "konsole", command: (s) => ["konsole", "--workdir", s.dir, "-e", "bash", "-lc", s.command] },
  { id: "xterm", label: "xterm", probe: "xterm", command: (s) => ["xterm", "-e", "bash", "-lc", s.command] },
];

const BY_TERM_PROGRAM: Record<string, string> = {
  WarpTerminal: "warp",
  "iTerm.app": "iterm",
  Apple_Terminal: "terminal",
  ghostty: "ghostty",
  WezTerm: "wezterm",
  kitty: "kitty",
  Alacritty: "alacritty",
};

const EXTRA_BIN = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", join(homedir(), ".local", "bin")];

const installed = async (t: Terminal): Promise<boolean> => (t.probe.startsWith("/") ? existsSync(t.probe) : (await which(t.probe, EXTRA_BIN)) !== null);

export const hasGui = (): boolean => {
  if (process.platform === "darwin") return !process.env.SSH_CONNECTION || !!process.env.TERM_PROGRAM;
  return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
};

export const resolveTerminal = async (preferred?: string | null): Promise<Terminal | null> => {
  if (!hasGui()) return null;
  const table = process.platform === "darwin" ? macOS : linux;
  const want = preferred && preferred !== "auto" ? preferred : process.env.TERM_PROGRAM ? BY_TERM_PROGRAM[process.env.TERM_PROGRAM] : undefined;
  if (want) {
    const t = table.find((x) => x.id === want);
    if (t && (await installed(t))) return t;
  }
  for (const t of table) if (await installed(t)) return t;
  return null;
};

export const openTerminal = async (ctx: Ctx, t: Terminal, s: Session): Promise<{ ok: boolean; detail: string }> => {
  try {
    t.prepare?.(s);
  } catch (e) {
    return { ok: false, detail: `${t.label}: ${String(e)}` };
  }
  const argv = t.command(s);
  if (process.platform === "darwin") {
    const r = await ctx.exec(argv, { timeoutMs: 10_000, cwd: s.dir });
    return r.code === 0 ? { ok: true, detail: t.label } : { ok: false, detail: `${t.label}: ${(r.stderr || r.stdout).trim().slice(0, 200)}` };
  }
  try {
    const p = Bun.spawn(argv, { cwd: s.dir, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    p.unref();
    return { ok: true, detail: t.label };
  } catch (e) {
    return { ok: false, detail: `${t.label}: ${String(e)}` };
  }
};
