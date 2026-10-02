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
}

const decodeModels = Schema.decodeUnknownOption(Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) }));
const NEGATIVE_MS = 5 * 60_000;
const FORGET_MS = 10 * 60_000;

const listener = (addr: string, pid: number | null): Listener[] => {
  const i = addr.lastIndexOf(":");
  const a = addr.slice(0, i).replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const host = ["*", "0.0.0.0", "::", "::1"].includes(a) ? "127.0.0.1" : /^\d+\.\d+\.\d+\.\d+$/.test(a) ? a : null;
  const port = Number(addr.slice(i + 1));
  return host && Number.isInteger(port) && port > 0 ? [{ host, port, pid }] : [];
};

const parseSs = (out: string): Listener[] =>
  out.split("\n").flatMap((line) => {
    const local = line.trim().split(/\s+/)[3];
    const pid = /pid=(\d+)/.exec(line)?.[1];
    return local ? listener(local, pid ? Number(pid) : null) : [];
  });

const parseLsof = (out: string): Listener[] => {
  let pid: number | null = null;
  return out.split("\n").flatMap((line) => {
    if (line[0] === "p") pid = Number(line.slice(1));
    return line[0] === "n" ? listener(line.slice(1), pid) : [];
  });
};

export const listeners: Effect.Effect<Listener[]> = Effect.gen(function* () {
  const raw =
    process.platform === "linux"
      ? parseSs((yield* exec(["ss", "-H", "-ltnp"], 5_000)).stdout)
      : parseLsof((yield* exec(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"], 8_000)).stdout);
  const seen = new Map<number, Listener>();
  for (const l of raw) {
    const prev = seen.get(l.port);
    if (!prev || (prev.host !== "127.0.0.1" && l.host === "127.0.0.1")) seen.set(l.port, l);
  }
  return [...seen.values()].sort((a, b) => a.port - b.port).slice(0, 512);
});

export const makeScanner = (controllerId: string, jobPort: (port: number) => string | null) => {
  const negative = new Map<string, number>();
  const known = new Map<number, Endpoint>();
  const current = () => [...known.values()].sort((a, b) => a.port - b.port);
  const probe = (l: Listener, keys: Record<string, string>) =>
    Effect.gen(function* () {
      const tag = `${l.port}:${l.pid ?? ""}`;
      if ((negative.get(tag) ?? 0) > Date.now()) return;
      const key = keys[String(l.port)];
      const r = yield* Effect.option(fetchJson(`http://${l.host}:${l.port}/v1/models`, 1_500, key ? { authorization: `Bearer ${key}` } : {}));
      const got = r._tag === "Some" ? r.value : null;
      const list = got && got.status === 200 && !got.headers.get(LOCAL_STUDIO_CONTROLLER_HEADER) ? decodeModels(got.body) : null;
      if (!list || list._tag === "None" || !list.value.data.length) {
        if (got && !jobPort(l.port)) negative.set(tag, Date.now() + NEGATIVE_MS);
        return;
      }
      const models = [...new Set(list.value.data.map((m) => m.id))].sort();
      known.set(l.port, { id: `${controllerId}:${l.port}`, controllerId, port: l.port, pid: l.pid, models, live: true, lastSeenAt: now(), jobId: jobPort(l.port), base: `http://${l.host}:${l.port}` });
      return l.port;
    });
  return {
    current,
    scan: (exclude: Set<number>, keys: Record<string, string>) =>
      Effect.gen(function* () {
        const ls = (yield* listeners).filter((l) => !exclude.has(l.port));
        const live = new Set(yield* Effect.forEach(ls, (l) => probe(l, keys), { concurrency: 24 }));
        for (const [p, ep] of known) {
          if (live.has(p)) continue;
          if (Date.now() - Date.parse(ep.lastSeenAt ?? "0") > FORGET_MS) known.delete(p);
          else known.set(p, { ...ep, live: false, jobId: jobPort(p) });
        }
      }),
  };
};
