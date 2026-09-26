import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Harness, HarnessInfo, HarnessJob } from "@local-studio/contracts";
import type { Ctx } from "../context";
import { redact } from "../core/log";
import { selfArgv } from "./tmux";

export type CliHarness = "dsh" | "claude" | "codex" | "pi" | "omp";

export const PACKAGES: Record<CliHarness, { pkg: string; bin: string; runtime: "node" | "bun" }> = {
  dsh: { pkg: "@deepseek-ai/dsh", bin: "dsh", runtime: "node" },
  claude: { pkg: "@anthropic-ai/claude-code", bin: "claude", runtime: "node" },
  codex: { pkg: "@openai/codex", bin: "codex", runtime: "node" },
  pi: { pkg: "@earendil-works/pi-coding-agent", bin: "pi", runtime: "node" },
  omp: { pkg: "@oh-my-pi/pi-coding-agent", bin: "omp", runtime: "bun" },
};

const CLI = Object.keys(PACKAGES) as CliHarness[];
const APPS: Partial<Record<Harness, string>> = { "codex-desktop": "/Applications/Codex.app", "claude-desktop": "/Applications/Claude.app" };
const H = homedir();
const EXTRA = [
  join(H, ".local", "bin"),
  join(H, ".bun", "bin"),
  join(H, ".npm-global", "bin"),
  join(H, ".volta", "bin"),
  join(H, ".local", "share", "mise", "shims"),
  join(H, ".local", "share", "pi-node", "current", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
];
const INSTALL_TIMEOUT_MS = 600_000;
const LATEST_TTL_MS = 3_600_000;

const nvmBins = (): string[] => {
  const d = join(H, ".nvm", "versions", "node");
  try {
    return readdirSync(d)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((v) => join(d, v, "bin"));
  } catch {
    return [];
  }
};

const firstVersion = (s: string) => /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(s)?.[0] ?? null;

const pkgVersion = (bin: string, pkg: string): string | null => {
  try {
    let d = dirname(realpathSync(bin));
    for (let i = 0; i < 8; i++) {
      const p = join(d, "package.json");
      if (existsSync(p)) {
        const j = JSON.parse(readFileSync(p, "utf8")) as { name?: string; version?: string };
        if (j.name === pkg) return j.version ?? null;
      }
      d = dirname(d);
    }
  } catch {}
  return null;
};

const findIn = (bin: string, path: string): string | null => Bun.which(bin, { PATH: path }) ?? null;

export interface HarnessManager {
  list(): Promise<HarnessInfo[]>;
  cached(): HarnessInfo[];
  resolve(h: CliHarness): Promise<{ bin: string; version: string | null; managed: boolean } | null>;
  searchPath(): Promise<string>;
  install(h: CliHarness): HarnessJob;
}

export const createHarnessManager = (ctx: Ctx): HarnessManager => {
  const root = join(ctx.config.home, "harnesses");
  const shimDir = join(root, ".bin");
  const prefix = (h: CliHarness) => join(root, h);
  const managedBin = (h: CliHarness) => join(prefix(h), "bin", PACKAGES[h].bin);
  const jobs = new Map<CliHarness, HarnessJob>();
  const latest = new Map<CliHarness, { v: string | null; at: number }>();
  const versions = new Map<string, string | null>();
  let pathP: Promise<string> | null = null;
  let last: HarnessInfo[] = [];

  const loginPath = async (): Promise<string[]> => {
    const shell = process.env.SHELL || userInfo().shell || "/bin/sh";
    const r = await ctx.exec([shell, "-ilc", 'printf "\\n__LSP__%s__LSP__\\n" "$PATH"'], { timeoutMs: 8000, cwd: H, env: { TERM: "dumb" } });
    const m = /__LSP__(.*?)__LSP__/.exec(r.stdout);
    if (!m) ctx.log.warn(`agents: could not read the login shell PATH from ${shell} (${r.timedOut ? "timed out" : `exit ${r.code}`})`);
    return m ? m[1]!.split(":") : [];
  };

  const bunShim = () => {
    const self = selfArgv();
    if (self.length !== 1) return;
    const p = join(shimDir, "bun");
    const body = `#!/bin/sh\nBUN_BE_BUN=1 exec '${self[0]!.replace(/'/g, `'\\''`)}' "$@"\n`;
    try {
      if (existsSync(p) && readFileSync(p, "utf8") === body) return;
      mkdirSync(shimDir, { recursive: true, mode: 0o700 });
      writeFileSync(p, body, { mode: 0o755 });
      chmodSync(p, 0o755);
    } catch {}
  };

  const searchPath = () =>
    (pathP ??= loginPath().then((login) => {
      bunShim();
      const dirs = [...CLI.map((h) => dirname(managedBin(h))), ...login, ...(process.env.PATH ?? "").split(":"), ...EXTRA, ...nvmBins(), shimDir];
      return [...new Set(dirs.filter(Boolean))].join(":");
    }));

  const versionOf = async (h: CliHarness, bin: string): Promise<string | null> => {
    let key = bin;
    try {
      key = `${bin}:${statSync(realpathSync(bin)).mtimeMs}`;
    } catch {}
    if (versions.has(key)) return versions.get(key)!;
    let v = pkgVersion(bin, PACKAGES[h].pkg);
    if (!v) {
      const r = await ctx.exec([bin, "--version"], { timeoutMs: 8000, env: { PATH: await searchPath() } });
      v = r.code === 0 ? firstVersion(r.stdout) : null;
      if (r.timedOut) return null;
    }
    versions.set(key, v);
    return v;
  };

  const resolve: HarnessManager["resolve"] = async (h) => {
    const m = managedBin(h);
    if (existsSync(m)) return { bin: m, version: await versionOf(h, m), managed: true };
    const path = await searchPath();
    const fallbacks = h === "dsh" ? [process.env.LOCAL_STUDIO_DSH_BIN ?? "", join(H, "dsh-run", "node_modules", ".bin", "dsh")] : [];
    const bin = findIn(PACKAGES[h].bin, path) ?? fallbacks.find((p) => p && existsSync(p)) ?? null;
    return bin ? { bin, version: await versionOf(h, bin), managed: false } : null;
  };

  const fetchLatest = async (h: CliHarness): Promise<string | null> => {
    const c = latest.get(h);
    const now = Date.now();
    if (c && now - c.at < (c.v ? LATEST_TTL_MS : 300_000)) return c.v;
    let v: string | null = null;
    try {
      const r = await ctx.fetch(`https://registry.npmjs.org/${PACKAGES[h].pkg}/latest`, { method: "GET", timeoutMs: 10_000 });
      if (r.ok) v = ((await r.json()) as { version?: string }).version ?? null;
      else await r.body?.cancel();
    } catch {}
    latest.set(h, { v: v ?? c?.v ?? null, at: now });
    return v ?? c?.v ?? null;
  };

  const app = async (harness: "codex-desktop" | "claude-desktop"): Promise<HarnessInfo> => {
    const path = process.platform === "darwin" ? APPS[harness]! : null;
    const ok = !!path && existsSync(path);
    let version: string | null = null;
    if (ok) {
      const r = await ctx.exec(["plutil", "-extract", "CFBundleShortVersionString", "raw", join(path!, "Contents", "Info.plist")], { timeoutMs: 5000 });
      if (r.code === 0) version = r.stdout.trim() || null;
    }
    return { harness, installed: ok, path: ok ? path : null, version, managed: false, package: null, latest: null, job: null, tier: 2, note: "prepare writes config under the Local Studio home; verify by hand" };
  };

  const list = async (): Promise<HarnessInfo[]> => {
    const cli = await Promise.all(
      CLI.map(async (h): Promise<HarnessInfo> => {
        const [r, l] = await Promise.all([resolve(h), fetchLatest(h)]);
        const note = r ? (r.managed ? `managed in ${prefix(h)}` : `found at ${r.bin}`) : "not installed";
        return { harness: h, installed: !!r, path: r?.bin ?? null, version: r?.version ?? null, managed: !!r?.managed, package: PACKAGES[h].pkg, latest: l, job: jobs.get(h) ?? null, tier: 1, note };
      }),
    );
    last = [...cli, ...(await Promise.all([app("codex-desktop"), app("claude-desktop")]))];
    return last;
  };

  const install = (h: CliHarness): HarnessJob => {
    const cur = jobs.get(h);
    if (cur?.state === "running") return cur;
    const job: HarnessJob = { action: existsSync(managedBin(h)) ? "update" : "install", state: "running", startedAt: Date.now(), endedAt: null, detail: "starting", log: [] };
    jobs.set(h, job);
    const finish = (state: HarnessJob["state"], detail: string) => {
      job.state = state;
      job.detail = detail;
      job.endedAt = Date.now();
      ctx.log[state === "done" ? "info" : "warn"](`agents: ${job.action} ${h}: ${detail}`);
    };
    void (async () => {
      const path = await searchPath();
      const { pkg, runtime } = PACKAGES[h];
      const npm = findIn("npm", path);
      const bun = findIn("bun", path);
      mkdirSync(prefix(h), { recursive: true, mode: 0o700 });
      let argv: string[];
      const env: Record<string, string> = { PATH: path, PWD: prefix(h), npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" };
      if (runtime === "node" && npm) argv = [npm, "install", "--global", "--prefix", prefix(h), `${pkg}@latest`];
      else if (bun) {
        argv = [bun, "add", "--global", `${pkg}@latest`];
        env.BUN_INSTALL = prefix(h);
        const g = join(prefix(h), "install", "global");
        mkdirSync(g, { recursive: true, mode: 0o700 });
        if (!existsSync(join(g, "package.json"))) writeFileSync(join(g, "package.json"), `${JSON.stringify({ name: "local-studio-harness", private: true })}\n`);
      } else return finish("failed", runtime === "node" ? "npm not found on the login shell PATH; install Node.js" : "bun not found");
      job.detail = `${basename(argv[0]!)} ${argv.slice(1).join(" ")}`;
      ctx.log.info(`agents: ${job.action} ${h}: ${job.detail}`);
      let proc: ReturnType<typeof Bun.spawn>;
      try {
        proc = Bun.spawn(argv, { cwd: prefix(h), env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      } catch (e) {
        return finish("failed", String(e));
      }
      const timer = setTimeout(() => proc.kill("SIGKILL"), INSTALL_TIMEOUT_MS);
      const pump = async (s: ReadableStream<Uint8Array>) => {
        const dec = new TextDecoder();
        let buf = "";
        for await (const chunk of s) {
          buf += dec.decode(chunk, { stream: true });
          const lines = buf.split(/\r?\n|\r/);
          buf = lines.pop() ?? "";
          for (const l of lines) if (l.trim()) job.log = [...job.log, redact(l).slice(0, 300)].slice(-40);
        }
      };
      await Promise.all([pump(proc.stdout as ReadableStream<Uint8Array>), pump(proc.stderr as ReadableStream<Uint8Array>), proc.exited]);
      clearTimeout(timer);
      if (proc.signalCode === "SIGKILL") return finish("failed", `timed out after ${INSTALL_TIMEOUT_MS / 1000} s`);
      if (proc.exitCode !== 0 || !existsSync(managedBin(h))) return finish("failed", `exit ${proc.exitCode}: ${job.log.slice(-2).join(" ") || "no output"}`);
      latest.delete(h);
      const v = await versionOf(h, managedBin(h));
      finish("done", `${pkg}@${v ?? "?"} in ${prefix(h)}`);
    })().catch((e) => finish("failed", String(e)));
    return job;
  };

  return { list, cached: () => last, resolve, searchPath, install };
};
