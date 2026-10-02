import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { LOCAL_STUDIO_CONTROLLER_HEADER, type LocalEndpoint } from "../../../packages/contracts/src/localStudio.ts";
import { exec, fetchJson, now } from "./core.ts";

export interface Endpoint extends LocalEndpoint {
  base: string;
}

interface Listener {
  host: string;
  port: number;
  pid: number | null;
  process: string | null;
}

const ModelList = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) });
const decodeModels = Schema.decodeUnknownOption(ModelList);

const MAX_PORTS = 512;
const PROBE_MS = 1_500;
const NEGATIVE_MS = 5 * 60_000;
const FORGET_MS = 10 * 60_000;

const probeHost = (addr: string): string | null => {
  const a = addr.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (a.startsWith("127.")) return a;
  if (a === "*" || a === "0.0.0.0" || a === "::" || a === "::1") return "127.0.0.1";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) return a;
  return null;
};

const splitAddr = (s: string): [string, number] => {
  const i = s.lastIndexOf(":");
  return [s.slice(0, i), Number(s.slice(i + 1))];
};

export const parseSs = (out: string): Listener[] =>
  out.split("\n").flatMap((line) => {
    const cols = line.trim().split(/\s+/);
    const local = cols[3];
    if (!local) return [];
    const [addr, port] = splitAddr(local);
    const m = /\(\("([^"]+)",pid=(\d+)/.exec(line);
    return [{ host: addr, port, pid: m ? Number(m[2]) : null, process: m?.[1] ?? null }];
  });

const parseLsof = (out: string): Listener[] => {
  const res: Listener[] = [];
  let pid: number | null = null;
  let cmd: string | null = null;
  for (const line of out.split("\n")) {
    const v = line.slice(1);
    if (line[0] === "p") pid = Number(v);
    else if (line[0] === "c") cmd = v;
    else if (line[0] === "n") {
      const [addr, port] = splitAddr(v);
      res.push({ host: addr, port, pid, process: cmd });
    }
  }
  return res;
};

export const listeners: Effect.Effect<Listener[]> = Effect.gen(function* () {
  const raw =
    process.platform === "linux"
      ? parseSs((yield* exec(["ss", "-H", "-ltnp"], 5_000)).stdout)
      : parseLsof((yield* exec(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], 8_000)).stdout);
  const seen = new Map<number, Listener>();
  for (const l of raw) {
    const host = probeHost(l.host);
    if (!host || !Number.isInteger(l.port) || l.port <= 0) continue;
    const prev = seen.get(l.port);
    if (!prev || (prev.host !== "127.0.0.1" && host === "127.0.0.1")) seen.set(l.port, { ...l, host });
  }
  return [...seen.values()].sort((a, b) => a.port - b.port).slice(0, MAX_PORTS);
});

export interface Scanner {
  scan(exclude: Set<number>, keys: Record<string, string>): Effect.Effect<Endpoint[]>;
  current(): Endpoint[];
}

export const makeScanner = (controllerId: string, jobPort: (port: number) => string | null): Scanner => {
  const negative = new Map<string, number>();
  const known = new Map<number, Endpoint>();
  const probe = (l: Listener, keys: Record<string, string>) =>
    Effect.gen(function* () {
      const tag = `${l.port}:${l.pid ?? ""}`;
      if ((negative.get(tag) ?? 0) > Date.now()) return null;
      const key = keys[String(l.port)];
      const r = yield* Effect.option(fetchJson(`http://${l.host}:${l.port}/v1/models`, PROBE_MS, key ? { authorization: `Bearer ${key}` } : {}));
      const got = r._tag === "Some" ? r.value : null;
      const list = got && got.status === 200 && !got.headers.get(LOCAL_STUDIO_CONTROLLER_HEADER) ? decodeModels(got.body) : null;
      if (!list || list._tag === "None" || !list.value.data.length) {
        if (got && !jobPort(l.port)) negative.set(tag, Date.now() + NEGATIVE_MS);
        return null;
      }
      const ep: Endpoint = {
        id: `${controllerId}:${l.port}`,
        controllerId,
        port: l.port,
        pid: l.pid,
        process: l.process,
        models: [...new Set(list.value.data.map((m) => m.id))].sort(),
        live: true,
        lastSeenAt: now(),
        jobId: jobPort(l.port),
        base: `http://${l.host}:${l.port}`,
      };
      return ep;
    });
  return {
    scan: (exclude, keys) =>
      Effect.gen(function* () {
        const ls = (yield* listeners).filter((l) => !exclude.has(l.port));
        const found = yield* Effect.forEach(ls, (l) => probe(l, keys), { concurrency: 24 });
        const live = new Set<number>();
        for (const ep of found) {
          if (!ep) continue;
          live.add(ep.port);
          known.set(ep.port, ep);
        }
        for (const [p, ep] of known) {
          if (live.has(p)) continue;
          if (Date.now() - Date.parse(ep.lastSeenAt ?? "0") > FORGET_MS) known.delete(p);
          else known.set(p, { ...ep, live: false, jobId: jobPort(p) });
        }
        return [...known.values()].sort((a, b) => a.port - b.port);
      }),
    current: () => [...known.values()].sort((a, b) => a.port - b.port),
  };
};
