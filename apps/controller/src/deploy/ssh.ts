import { exec, type ExecResult } from "../core/exec";

const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8"];

export const shq = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

export class DeployError extends Error {}

export interface Remote {
  host: string;
  run(script: string, timeoutMs?: number): Promise<ExecResult>;
  must(script: string, what: string, timeoutMs?: number): Promise<string>;
  copy(localPath: string, remotePath: string, timeoutMs?: number): Promise<void>;
}

const tail = (r: ExecResult): string => {
  if (r.timedOut) return "timed out";
  const lines = (r.stderr || r.stdout).split("\n").filter((l) => l.trim() && !l.startsWith("manpath:"));
  return lines.slice(-4).join(" | ") || `exit ${r.code}`;
};

export const remote = (host: string): Remote => {
  const run = (script: string, timeoutMs = 20_000) =>
    exec(["ssh", ...SSH_OPTS, host, "sh -s"], { timeoutMs, input: `set -u\n${script}\n` });
  return {
    host,
    run,
    async must(script, what, timeoutMs) {
      const r = await run(script, timeoutMs);
      if (r.code !== 0) throw new DeployError(`${what} failed on ${host}: ${tail(r)}`);
      return r.stdout;
    },
    async copy(localPath, remotePath, timeoutMs = 300_000) {
      const r = await exec(["scp", "-q", ...SSH_OPTS, localPath, `${host}:${remotePath}`], { timeoutMs });
      if (r.code !== 0) throw new DeployError(`scp to ${host}:${remotePath} failed: ${tail(r)}`);
    },
  };
};

export interface Probe {
  os: "linux" | "darwin";
  arch: "x64" | "arm64";
  home: string;
  tools: Set<string>;
  tailnetIp: string | null;
}

export const probe = async (r: Remote): Promise<Probe> => {
  const out = await r.must(
    [
      `echo "uname=$(uname -sm)"`,
      `echo "home=$HOME"`,
      `for t in docker nvidia-smi tmux systemctl launchctl curl setsid tailscale ss lsof; do command -v "$t" >/dev/null 2>&1 && echo "tool=$t"; done`,
      `to=""; command -v timeout >/dev/null 2>&1 && to="timeout 3"`,
      `ip=$( (command -v tailscale >/dev/null 2>&1 && $to tailscale ip -4 2>/dev/null) | head -n1); echo "tsip=$ip"`,
    ].join("\n"),
    "probe",
    20_000,
  );
  const kv = out.split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()] as const);
  const get = (k: string) => kv.find(([a]) => a === k)?.[1] ?? "";
  const [sys, machine] = get("uname").split(/\s+/);
  const os = sys === "Darwin" ? "darwin" : sys === "Linux" ? "linux" : null;
  const arch = machine === "x86_64" || machine === "amd64" ? "x64" : machine === "arm64" || machine === "aarch64" ? "arm64" : null;
  if (!os || !arch) throw new DeployError(`unsupported target ${get("uname") || "unknown"} on ${r.host}`);
  const home = get("home");
  if (!home.startsWith("/")) throw new DeployError(`could not read $HOME on ${r.host}`);
  return {
    os,
    arch,
    home,
    tools: new Set(kv.filter(([k]) => k === "tool").map(([, v]) => v)),
    tailnetIp: /^\d+\.\d+\.\d+\.\d+$/.test(get("tsip")) ? get("tsip") : null,
  };
};
