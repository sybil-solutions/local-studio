import { homedir } from "node:os";
import { basename } from "node:path";
import { fetchWithTimeout } from "../core/exec";
import { artifactFor } from "./artifact";
import { DeployError, probe, remote, shq, type Probe, type Remote } from "./ssh";
import { findOwned, health, install, pickRunner, pollDown, pollHealth, portBusy, probeHost, serverPid, start, stopOwned, type Layout, type Runner } from "./start";

const USAGE = `local-studio deploy <ssh-host> [--port 8080] [--dir ~/local-studio] [--host <bind>] [--name NAME] [--read-only]
                    [--service] [--no-start] [--replace] [--connect [--allow-actions]] [--local-url http://127.0.0.1:8080]
  --connect binds the remote controller to --host, or to its tailnet IP when --host is not given, and connects it
  with a scoped federation key (read + /v1; --allow-actions also lets this hub launch, stop and export there).
local-studio deploy stop <ssh-host> [--port 8080] [--dir ~/local-studio] [--service]`;

const BOOL_FLAGS = new Set(["read-only", "service", "no-start", "replace", "connect", "allow-actions", "help"]);
const VALUE_FLAGS = new Set(["port", "dir", "host", "name", "local-url"]);

interface Args {
  positional: string[];
  flags: Map<string, string | true>;
}

const parse = (argv: string[]): Args => {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (BOOL_FLAGS.has(name)) flags.set(name, true);
    else if (VALUE_FLAGS.has(name)) {
      const v = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (v === undefined) throw new DeployError(`--${name} needs a value`);
      flags.set(name, v);
    } else throw new DeployError(`unknown flag --${name}`);
  }
  return { positional, flags };
};

const str = (a: Args, k: string): string | undefined => {
  const v = a.flags.get(k);
  return typeof v === "string" ? v : undefined;
};

const remoteDir = (raw: string, p: Probe): string => {
  const local = homedir();
  let d = raw;
  if (d === local || d.startsWith(`${local}/`)) d = `~${d.slice(local.length)}`;
  if (d === "~") d = p.home;
  else if (d.startsWith("~/")) d = `${p.home}/${d.slice(2)}`;
  if (!d.startsWith("/")) d = `${p.home}/${d}`;
  d = d.replace(/\/+$/, "");
  if (d === p.home || d === "/" || !/^[A-Za-z0-9_./-]+$/.test(d)) throw new DeployError(`refusing deploy dir ${d}`);
  return d;
};

const connectHost = (p: Probe): string => {
  if (!p.tailnetIp) throw new DeployError("--connect needs --host <address this machine can reach>; the remote has no tailnet IP to default to");
  return p.tailnetIp;
};

const LOOPBACK_URL = /^https?:\/\/(127\.|localhost|\[::1\]|0\.0\.0\.0)/i;

const layoutFrom = (a: Args, p: Probe): Layout => {
  const port = Number(str(a, "port") ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new DeployError(`bad --port ${str(a, "port")}`);
  return {
    dir: remoteDir(str(a, "dir") ?? "~/local-studio", p),
    port,
    host: str(a, "host") ?? (a.flags.has("connect") ? connectHost(p) : "127.0.0.1"),
    name: str(a, "name") ?? null,
    readOnly: a.flags.has("read-only"),
  };
};

const publicUrl = (host: string, l: Layout, p: Probe): string => {
  const h = l.host === "0.0.0.0" || l.host === "::" ? (p.tailnetIp ?? host) : l.host;
  return `http://${h}:${l.port}`;
};

const out = (s: string) => console.log(s);
const note = (s: string) => console.error(`deploy: ${s}`);

const readKey = async (r: Remote, l: Layout, actions: boolean): Promise<string> => {
  const res = await r.run(
    `set -a; . ${shq(`${l.dir}/env`)}; set +a\n${shq(`${l.dir}/local-studio`)} key --federation${actions ? " --actions" : ""} --home ${shq(`${l.dir}/home`)} 2>/dev/null`,
    30_000,
  );
  const key = res.stdout.trim().split("\n").pop()?.trim() ?? "";
  if (res.code !== 0 || !/^[A-Za-z0-9_-]{16,}$/.test(key)) throw new DeployError(`could not issue a federation key on ${r.host}`);
  return key;
};

const connect = async (localUrl: string, url: string, key: string, name: string): Promise<void> => {
  if (LOOPBACK_URL.test(url)) throw new DeployError(`refusing to connect ${url}: a loopback address would point the local controller at itself; pass --host`);
  const base = localUrl.replace(/\/+$/, "");
  let h: { service?: string } | null = null;
  try {
    const res = await fetchWithTimeout(`${base}/health`, { timeoutMs: 2000 });
    h = (await res.json()) as { service?: string };
  } catch {
    h = null;
  }
  if (h?.service !== "local-studio") throw new DeployError(`no local controller at ${base}; start it (local-studio serve) and rerun with --connect`);
  const res = await fetchWithTimeout(`${base}/api/machines`, {
    method: "POST",
    timeoutMs: 15_000,
    headers: { "content-type": "application/json", ...(process.env.LOCAL_STUDIO_API_KEY ? { authorization: `Bearer ${process.env.LOCAL_STUDIO_API_KEY}` } : {}) },
    body: JSON.stringify({ url, key, name }),
  });
  const text = (await res.text()).split(key).join("[redacted]");
  if (!res.ok) throw new DeployError(`connect failed: ${res.status} ${text.slice(0, 300)}`);
  out(`connected ${name} ${url} to ${base}`);
};

const deploy = async (host: string, a: Args): Promise<number> => {
  const r = remote(host);
  const p = await probe(r);
  const l = layoutFrom(a, p);
  const service = a.flags.has("service");
  const url = publicUrl(host, l, p);
  const name = l.name ?? host;
  note(`${host}: ${p.os}-${p.arch}, dir ${l.dir}, port ${l.port}, tools ${[...p.tools].sort().join(",")}`);

  const current = await health(r, l);
  const owned = await findOwned(r, l);
  let replacing = false;
  if (current) {
    if (current.service !== "local-studio") throw new DeployError(`port ${l.port} on ${host} answers /health but is not local-studio; pick another --port`);
    if (!a.flags.has("replace")) {
      out(`already running ${host} ${url} version ${current.version ?? "?"} (${owned?.runner ?? "unmanaged"}${owned?.detail ? ` ${owned.detail}` : ""})`);
      if (a.flags.has("connect")) await connect(str(a, "local-url") ?? "http://127.0.0.1:8080", url, await readKey(r, l, a.flags.has("allow-actions")), name);
      return 0;
    }
    if (!owned) throw new DeployError(`port ${l.port} is served by a local-studio this deploy did not start; stop it by hand`);
    replacing = true;
  } else if (await portBusy(r, p, l.port)) {
    throw new DeployError(`port ${l.port} on ${host} is already in use by something else; pick another --port`);
  }

  const art = await artifactFor(p, note);
  note(`${art.built ? "built" : "reusing"} ${basename(art.tarball)}`);
  await r.must(`mkdir -p ${shq(l.dir)} && chmod 0700 ${shq(l.dir)}`, "mkdir");
  const tarName = `.upload-${art.version}-${art.pair}.tar.gz`;
  await r.copy(art.tarball, `${l.dir}/${tarName}`);

  if (replacing && owned) {
    await stopOwned(r, l, owned);
    if (!(await pollDown(r, l))) throw new DeployError(`old controller on ${l.port} did not stop`);
    note(`stopped ${owned.runner} ${owned.detail}`.trim());
  }
  await install(r, l, tarName);

  if (a.flags.has("no-start")) {
    out(`installed ${host} ${l.dir} version ${art.version} (not started)`);
    return 0;
  }
  const runner: Runner = replacing && owned && (owned.runner === "systemd" || owned.runner === "launchd") ? owned.runner : pickRunner(p, service);
  const warning = await start(r, p, l, runner);
  if (warning) note(`WARNING ${warning}`);
  const h = await pollHealth(r, l);
  if (!h) {
    const log = await r.run(`tail -n 15 ${shq(`${l.dir}/controller.log`)} 2>/dev/null`, 15_000);
    throw new DeployError(`controller did not answer ${probeHost(l.host)}:${l.port}/health within 30 s\n${log.stdout.trim()}`);
  }
  const pid = await serverPid(r, l);
  out(`deployed ${host} ${url} version ${h.version ?? art.version} (${runner}${pid ? ` pid ${pid}` : ""})`);
  if (a.flags.has("connect")) await connect(str(a, "local-url") ?? "http://127.0.0.1:8080", url, await readKey(r, l, a.flags.has("allow-actions")), name);
  return 0;
};

const stop = async (host: string, a: Args): Promise<number> => {
  const r = remote(host);
  const p = await probe(r);
  const l = layoutFrom(a, p);
  const owned = await findOwned(r, l);
  if (!owned) {
    const h = await health(r, l);
    out(h ? `not stopped ${host}:${l.port}: local-studio there was not started by deploy` : `not running ${host}:${l.port}`);
    return h ? 1 : 0;
  }
  if (a.flags.has("service") && owned.runner !== "systemd" && owned.runner !== "launchd") note(`no service on ${l.port}; stopping ${owned.runner}`);
  await stopOwned(r, l, owned);
  const down = await pollDown(r, l);
  out(down ? `stopped ${host}:${l.port} (${owned.runner}${owned.detail ? ` ${owned.detail}` : ""})` : `stop sent to ${host}:${l.port} but /health still answers`);
  return down ? 0 : 1;
};

export const runDeployCli = async (argv: string[]): Promise<number> => {
  try {
    const a = parse(argv);
    if (a.flags.has("help") || a.positional.length === 0) {
      console.log(USAGE);
      return a.flags.has("help") ? 0 : 2;
    }
    const [first, second] = a.positional;
    if (first === "stop") {
      if (!second) throw new DeployError("deploy stop needs <ssh-host>");
      return await stop(second, a);
    }
    if (a.positional.length > 1) throw new DeployError(`unexpected argument ${a.positional[1]}`);
    return await deploy(first!, a);
  } catch (e) {
    console.error(`deploy: ${e instanceof DeployError ? e.message : String(e)}`);
    return 1;
  }
};
