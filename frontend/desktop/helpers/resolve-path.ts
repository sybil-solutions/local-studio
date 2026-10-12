import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// A GUI-launched macOS/Linux app (Finder, Dock, `open`) inherits a minimal
// PATH (/usr/bin:/bin:/usr/sbin:/sbin) that omits Homebrew/nvm/asdf/cargo bin
// dirs where `node`, `npx`, `uvx`, `bun`, etc. live. Recover the user's real
// login-shell PATH once at startup and merge it with the inherited PATH plus a
// set of well-known launcher dirs so those executables resolve.

let cachedPath: string | null = null;

// Ask the user's login shell for its PATH. PATH is commonly assembled across
// both login (~/.zprofile, Homebrew shellenv) and interactive (~/.zshrc, nvm)
// startup files, so run an interactive login shell and fence the value with
// markers to survive any banner/echo noise the rc files print.
function loginShellPath(): string | null {
  if (process.platform === "win32") return null;
  const shell = process.env.SHELL || "/bin/zsh";
  const start = "__VLLM_PATH_START__";
  const end = "__VLLM_PATH_END__";
  try {
    const output = execFileSync(shell, ["-ilc", `printf '%s%s%s' '${start}' "$PATH" '${end}'`], {
      encoding: "utf8",
      timeout: 4_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const from = output.indexOf(start);
    const to = output.indexOf(end);
    if (from === -1 || to === -1 || to <= from) return null;
    return output.slice(from + start.length, to).trim() || null;
  } catch {
    return null;
  }
}

function commonBinDirs(): string[] {
  const home = os.homedir();
  return [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".deno", "bin"),
  ];
}

/**
 * Build a PATH that includes the user's real login-shell PATH, the inherited
 * PATH, and well-known launcher directories. Result is cached for the process
 * lifetime. Safe in dev (terminal launches already have a full PATH; merging is
 * idempotent).
 */
export function resolveAugmentedPath(): string {
  if (cachedPath) return cachedPath;
  const segments: string[] = [];
  const add = (value: string | null | undefined) => {
    if (!value) return;
    for (const part of value.split(path.delimiter)) {
      const trimmed = part.trim();
      if (trimmed && !segments.includes(trimmed)) segments.push(trimmed);
    }
  };
  add(loginShellPath());
  add(process.env.PATH);
  for (const dir of commonBinDirs()) {
    if (existsSync(dir) && !segments.includes(dir)) segments.push(dir);
  }
  cachedPath = segments.join(path.delimiter);
  return cachedPath;
}
