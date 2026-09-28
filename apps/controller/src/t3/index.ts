import { spawn } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import type { T3Environment, T3FleetEntry, T3Pairing, T3State, T3Status } from "@local-studio/contracts";
import { T3PairBody, T3StartBody } from "@local-studio/contracts";
import type { Ctx, Env, Module, Services } from "../context";
import { which } from "../core/exec";
import { errText } from "../core/log";
import { pairing } from "../core/pair";
import { gatewayUrlFor } from "../agents/routes";
import { tailscaleBin } from "../federation/tailnet";
import { HttpError } from "../recipes/util";

export interface T3Service {
  status(): T3Status;
}

interface Desired {
  enabled: boolean;
  host: string | null;
  port: number;
  cwd: string | null;
  pid: number | null;
  startedAt: number | null;
}

const DEFAULT_PORT = Number(process.env.LOCAL_STUDIO_T3_PORT ?? 3773);
const TICK_MS = 10_000;
const PROBE_MS = 2500;
const START_WAIT_MS = 45_000;
const WILDCARD = new Set(["0.0.0.0", "::", ""]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

const urlHost = (h: string) => (h.includes(":") ? `[${h}]` : h);

const alive = (pid: number | null): boolean => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const redact = (s: string) => s.replace(/token=[^\s&"']+/gi, "token=<redacted>").replace(/("credential"\s*:\s*")[^"]+/g, "$1<redacted>");

export const createT3 = (ctx: Ctx, svc: Services): Module<T3Service> => {
  const home = join(ctx.config.home, "t3");
  const baseDir = join(home, "base");
  const stateFile = join(home, "local-studio.json");
  const logFile = join(home, "serve.log");
  mkdirSync(home, { recursive: true, mode: 0o700 });

  const read = (): Desired => {
    try {
      return { enabled: false, host: null, port: DEFAULT_PORT, cwd: null, pid: null, startedAt: null, ...(JSON.parse(readFileSync(stateFile, "utf8")) as Partial<Desired>) };
    } catch {
      return { enabled: false, host: null, port: DEFAULT_PORT, cwd: null, pid: null, startedAt: null };
    }
  };
  let desired = read();
  const save = () => {
    writeFileSync(stateFile, `${JSON.stringify(desired, null, 2)}\n`, { mode: 0o600 });
    chmodSync(stateFile, 0o600);
  };

  let tailIp: string | null | undefined;
  const tailnetIp = async (): Promise<string | null> => {
    if (tailIp !== undefined) return tailIp;
    if (pairing.base) return (tailIp = new URL(pairing.base).hostname);
    const bin = await tailscaleBin();
    const r = bin ? await ctx.exec([bin, "ip", "-4"], { timeoutMs: 5000 }) : null;
    tailIp = r?.code === 0 ? (r.stdout.trim().split("\n")[0] ?? null) : null;
    return tailIp;
  };

  const defaultHost = async (): Promise<string> => {
    const h = ctx.config.host;
    if (!WILDCARD.has(h) && !LOOPBACK.has(h)) return h;
    return (await tailnetIp()) ?? "127.0.0.1";
  };

  const resolveBin = async (): Promise<{ argv: string[]; bin: string } | null> => {
    const candidates = [process.env.LOCAL_STUDIO_T3_BIN, join(ctx.config.home, "bin", "t3"), join(dirname(process.execPath), "t3")].filter((x): x is string => !!x);
    const found = candidates.find((p) => existsSync(p)) ?? (await which("t3", [join(homedir(), ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin"]));
    if (!found) return null;
    if (/\.(mjs|cjs|js)$/.test(found)) {
      const node = await which("node", ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"]);
      return node ? { argv: [node, found], bin: found } : null;
    }
    return { argv: [found], bin: found };
  };

  let bin: string | null = null;
  let state: T3State = "stopped";
  let env: T3Environment | null = null;
  let error: string | null = null;
  let host = desired.host ?? "127.0.0.1";
  let failures = 0;
  let retryAt = 0;

  const probeHost = () => (WILDCARD.has(host) ? "127.0.0.1" : host);
  const localUrl = () => `http://${urlHost(probeHost())}:${desired.port}`;

  const probe = async (): Promise<T3Environment | null> => {
    try {
      const r = await ctx.fetch(`${localUrl()}/.well-known/t3/environment`, { timeoutMs: PROBE_MS });
      if (!r.ok) return null;
      const d = (await r.json()) as Partial<T3Environment>;
      return typeof d.environmentId === "string" ? { environmentId: d.environmentId, label: String(d.label ?? ""), serverVersion: String(d.serverVersion ?? "") } : null;
    } catch {
      return null;
    }
  };

  const logTail = (): string | null => {
    try {
      const size = statSync(logFile).size;
      const text = readFileSync(logFile, "utf8").slice(Math.max(0, size - 4000));
      const lines = text.trim().split("\n").filter(Boolean).slice(-4).join("\n");
      return lines ? redact(lines).slice(-600) : null;
    } catch {
      return null;
    }
  };

  const status = (): T3Status => ({
    machineId: ctx.identity.machineId,
    name: ctx.identity.name,
    state,
    enabled: desired.enabled,
    managed: alive(desired.pid),
    bin,
    host,
    port: desired.port,
    url: localUrl(),
    loopbackOnly: LOOPBACK.has(probeHost()),
    pid: alive(desired.pid) ? desired.pid : null,
    startedAt: alive(desired.pid) ? desired.startedAt : null,
    environment: env,
    error,
  });

  const spawnServe = async (): Promise<void> => {
    const r = await resolveBin();
    bin = r?.bin ?? null;
    if (!r) {
      state = "unavailable";
      error = "no t3 CLI found: set LOCAL_STUDIO_T3_BIN, install it at ~/.local-studio/bin/t3, or put t3 on PATH";
      return;
    }
    mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    const cwd = desired.cwd ?? homedir();
    const fd = openSync(logFile, "a", 0o600);
    chmodSync(logFile, 0o600);
    const childEnv: Record<string, string | undefined> = { ...process.env, LOCAL_STUDIO_GATEWAY_URL: gatewayUrlFor(ctx) };
    delete childEnv.LOCAL_STUDIO_API_KEY;
    try {
      const child = spawn(r.argv[0]!, [...r.argv.slice(1), "serve", "--host", host, "--port", String(desired.port), "--base-dir", baseDir, "--no-browser", cwd], {
        cwd,
        detached: true,
        stdio: ["ignore", "ignore", fd],
        env: childEnv,
      });
      child.on("error", (e) => {
        error = errText(e);
        state = "crashed";
      });
      child.unref();
      desired.pid = child.pid ?? null;
      desired.startedAt = Date.now();
      save();
      state = "starting";
      error = null;
      ctx.log.info(`t3: serve pid=${desired.pid} on ${host}:${desired.port}`);
    } finally {
      closeSync(fd);
    }
  };

  const ownEnvironmentId = (): string | null => {
    try {
      return readFileSync(join(baseDir, "userdata", "environment-id"), "utf8").trim() || null;
    } catch {
      return null;
    }
  };

  const tickNow = async (): Promise<void> => {
    const found = await probe();
    if (found) {
      env = found;
      state = "running";
      const own = ownEnvironmentId();
      error = own && own !== found.environmentId ? `port ${desired.port} serves another T3 environment (${found.label || found.environmentId})` : null;
      failures = 0;
      return;
    }
    env = null;
    if (alive(desired.pid)) {
      state = desired.startedAt && Date.now() - desired.startedAt < START_WAIT_MS * 2 ? "starting" : "crashed";
      if (state === "crashed") error = logTail() ?? "t3 serve is running but does not answer /.well-known/t3/environment";
      return;
    }
    if (!desired.enabled) {
      state = bin || (await resolveBin()) ? "stopped" : "unavailable";
      return;
    }
    if (desired.pid) {
      failures++;
      desired.pid = null;
      save();
      error = logTail() ?? "t3 serve exited";
      state = "crashed";
      retryAt = Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(failures, 6));
      ctx.log.warn(`t3: serve exited (${failures}); retry in ${Math.round((retryAt - Date.now()) / 1000)}s`);
      return;
    }
    if (Date.now() >= retryAt) await spawnServe();
  };

  let inflight: Promise<void> | null = null;
  const tick = (): Promise<void> =>
    (inflight ??= tickNow().finally(() => {
      inflight = null;
    }));

  const waitRunning = async (ms: number): Promise<void> => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await tick();
      if (state === "running" || state === "unavailable" || (state === "crashed" && !alive(desired.pid))) return;
      await Bun.sleep(750);
    }
  };

  const start = async (opts: { host?: string; port?: number; cwd?: string }): Promise<T3Status> => {
    const nextHost = opts.host ?? desired.host ?? (await defaultHost());
    const changed = nextHost !== host || (opts.port !== undefined && opts.port !== desired.port);
    if (changed && alive(desired.pid)) await stopProc();
    host = nextHost;
    desired = { ...desired, enabled: true, host: nextHost, port: opts.port ?? desired.port, cwd: opts.cwd ?? desired.cwd };
    failures = 0;
    retryAt = 0;
    save();
    await waitRunning(START_WAIT_MS);
    return status();
  };

  const stopProc = async (): Promise<void> => {
    const pid = desired.pid;
    if (!alive(pid)) return;
    try {
      process.kill(-pid!, "SIGTERM");
    } catch {
      try {
        process.kill(pid!, "SIGTERM");
      } catch {}
    }
    for (let i = 0; i < 40 && alive(pid); i++) await Bun.sleep(250);
    if (alive(pid))
      try {
        process.kill(-pid!, "SIGKILL");
      } catch {}
    desired.pid = null;
    desired.startedAt = null;
  };

  const stop = async (): Promise<T3Status> => {
    desired.enabled = false;
    await stopProc();
    save();
    env = null;
    await tick();
    return status();
  };

  const pairingBase = async (): Promise<{ baseUrl: string; loopbackOnly: boolean }> => {
    if (!WILDCARD.has(host)) return { baseUrl: `http://${urlHost(host)}:${desired.port}`, loopbackOnly: LOOPBACK.has(host) };
    const ip = await tailnetIp();
    return ip ? { baseUrl: `http://${ip}:${desired.port}`, loopbackOnly: false } : { baseUrl: `http://127.0.0.1:${desired.port}`, loopbackOnly: true };
  };

  const pair = async (opts: { ttlMinutes?: number; label?: string }): Promise<T3Pairing> => {
    if (state !== "running") await start({});
    if (state !== "running") throw new HttpError(503, "T3_NOT_RUNNING", `t3 serve is ${state}${error ? `: ${error}` : ""}`);
    if (error) throw new HttpError(409, "T3_FOREIGN", error);
    const r = await resolveBin();
    if (!r) throw new HttpError(503, "T3_UNAVAILABLE", "no t3 CLI found");
    const { baseUrl, loopbackOnly } = await pairingBase();
    const label = opts.label ?? `local-studio ${ctx.identity.name}`;
    const out = await ctx.exec([...r.argv, "auth", "pairing", "create", "--base-dir", baseDir, "--json", "--ttl", `${opts.ttlMinutes ?? 10}m`, "--label", label, "--base-url", baseUrl], { timeoutMs: 60_000 });
    const text = out.stdout;
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    let issued: { id?: string; credential?: string; expiresAt?: string; pairUrl?: string } = {};
    try {
      issued = JSON.parse(json) as typeof issued;
    } catch {}
    if (out.code !== 0 || !issued.credential || !issued.pairUrl)
      throw new HttpError(502, "T3_PAIR_FAILED", `t3 auth pairing create failed (exit ${out.code}${out.timedOut ? ", timed out" : ""}): ${redact(out.stderr).trim().slice(-400)}`);
    ctx.log.info(`t3: pairing link ${issued.id} issued for ${baseUrl}`);
    return {
      machineId: ctx.identity.machineId,
      name: ctx.identity.name,
      environmentId: env?.environmentId ?? null,
      id: String(issued.id ?? ""),
      pairUrl: issued.pairUrl,
      credential: issued.credential,
      baseUrl,
      expiresAt: String(issued.expiresAt ?? ""),
      loopbackOnly,
    };
  };

  const fleet = async (): Promise<T3FleetEntry[]> => {
    const self: T3FleetEntry = { machineId: ctx.identity.machineId, name: ctx.identity.name, peerId: null, self: true, online: true, status: status(), error: null };
    const peers = await Promise.all(
      svc.peers.list().map(async (p): Promise<T3FleetEntry> => {
        const base = { machineId: p.machineId, name: p.name, peerId: p.id, self: false, online: p.online };
        if (!p.online) return { ...base, status: null, error: p.error ?? "offline" };
        try {
          const r = await svc.peers.fetch(p.id, "/api/t3", { timeoutMs: 5000 });
          if (!r.ok) return { ...base, status: null, error: `HTTP ${r.status}${r.status === 404 ? ": controller has no /api/t3" : ""}` };
          return { ...base, status: (await r.json()) as T3Status, error: null };
        } catch (e) {
          return { ...base, status: null, error: errText(e) };
        }
      }),
    );
    return [self, ...peers];
  };

  const parse = async <T>(c: { req: { json: () => Promise<unknown> } }, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }): Promise<T> => {
    let raw: unknown = {};
    try {
      raw = await c.req.json();
    } catch {}
    const p = schema.safeParse(raw ?? {});
    if (!p.success) throw new HttpError(400, "BAD_REQUEST", p.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; "));
    return p.data;
  };

  const routes = new Hono<Env>();
  routes.get("/api/t3", (c) => c.json(status()));
  routes.get("/api/t3/fleet", async (c) => c.json(await fleet()));
  routes.post("/api/t3/start", async (c) => c.json(await start(await parse(c, T3StartBody))));
  routes.post("/api/t3/stop", async (c) => c.json(await stop()));
  routes.post("/api/t3/pair", async (c) => c.json(await pair(await parse(c, T3PairBody)), 200, { "cache-control": "no-store" }));

  let timer: ReturnType<typeof setInterval> | undefined;
  let busy = false;
  const loop = () => {
    if (busy) return;
    busy = true;
    tick()
      .catch((e) => ctx.log.warn(`t3: ${errText(e)}`, "t3"))
      .finally(() => {
        busy = false;
      });
  };
  return {
    service: { status },
    routes,
    async start() {
      if (desired.host === null && !desired.enabled) host = await defaultHost();
      bin = (await resolveBin())?.bin ?? null;
      loop();
      timer = setInterval(loop, TICK_MS);
    },
    stop() {
      clearInterval(timer);
    },
  };
};
