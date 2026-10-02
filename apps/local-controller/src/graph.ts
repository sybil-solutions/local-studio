import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { type LocalControllerLink, type LocalEndpoint, LocalNode, type LocalUsage } from "../../../packages/contracts/src/localStudio.ts";
import { type Config, fetchJson, home, now, readJson, writeJson } from "./core.ts";

const MAX_DEPTH = 4;
const MAX_NODES = 32;
const TTL_MS = 5_000;
const decodeNode = Schema.decodeUnknownOption(LocalNode);

export const normUrl = (u: string): string => u.trim().replace(/\/+$/, "");

const isLoopback = (u: string): boolean => /^https?:\/\/(localhost|127\.[\d.]+|\[::1\])(:|$)/.test(u);

export interface Graph {
  links: LocalControllerLink[];
  nodes: { url: string; depth: number; node: LocalNode }[];
}

const usagePath = join(home, "usage.json");
const UsageFile = Schema.Record(Schema.String, Schema.Struct({ requests: Schema.Number, lastAt: Schema.NullOr(Schema.String) }));

export const makeUsage = () => {
  const counts = new Map(Object.entries(readJson(usagePath, UsageFile, {})));
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    record: (model: string) => {
      const c = counts.get(model);
      counts.set(model, { requests: (c?.requests ?? 0) + 1, lastAt: now() });
      timer ??= setTimeout(() => {
        timer = null;
        writeJson(usagePath, Object.fromEntries(counts));
      }, 1_000);
    },
    list: (): LocalUsage[] => [...counts].map(([model, c]) => ({ model, ...c })).sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model)),
  };
};

export const makeGraph = (config: () => Config, self: () => LocalNode) => {
  let cache: { at: number; value: Graph } | null = null;
  let inflight: Promise<Graph> | null = null;

  const fetchNode = (url: string) =>
    fetchJson(`${url}/api/node`, 3_000, { authorization: `Bearer ${config().fleetKey}` }).pipe(
      Effect.flatMap((r) => {
        if (r.status !== 200) return Effect.fail(`HTTP ${r.status}`);
        const n = decodeNode(r.body);
        return n._tag === "Some" ? Effect.succeed(n.value) : Effect.fail("not a Local Studio controller");
      }),
      Effect.result,
    );

  const walk = Effect.gen(function* () {
    const me = self();
    const ids = new Set([me.controller.id]);
    const urls = new Set([normUrl(me.controller.url)]);
    const links: LocalControllerLink[] = [{ ...me.controller, self: true, reachable: true, depth: 0, error: null }];
    const nodes: Graph["nodes"] = [];
    let frontier = config().peers.map(normUrl);
    for (let depth = 1; depth <= MAX_DEPTH && frontier.length && nodes.length < MAX_NODES; depth++) {
      const batch = [...new Set(frontier)].filter((u) => !urls.has(u)).slice(0, MAX_NODES - nodes.length);
      for (const u of batch) urls.add(u);
      const got = yield* Effect.forEach(batch, (u) => fetchNode(u).pipe(Effect.map((r) => [u, r] as const)), { concurrency: 8 });
      frontier = [];
      for (const [url, r] of got) {
        if (r._tag === "Failure") {
          links.push({ id: null, name: null, url, self: false, reachable: false, depth, error: r.failure });
          continue;
        }
        const n = r.success;
        if (ids.has(n.controller.id)) continue;
        ids.add(n.controller.id);
        nodes.push({ url, depth, node: n });
        links.push({ id: n.controller.id, name: n.controller.name, url, self: false, reachable: true, depth, error: null });
        frontier.push(...n.peers.map(normUrl).filter((p) => isLoopback(url) || !isLoopback(p)));
      }
    }
    return { links, nodes };
  });

  return {
    get: (): Promise<Graph> => {
      if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value);
      inflight ??= Effect.runPromise(walk).then((value) => {
        cache = { at: Date.now(), value };
        inflight = null;
        return value;
      });
      return inflight;
    },
    invalidate: () => {
      cache = null;
    },
  };
};

export interface Route {
  endpoint: LocalEndpoint;
  base: string;
  peer: string | null;
}

export const liveModels = (local: LocalEndpoint[], g: Graph): Map<string, Route[]> => {
  const out = new Map<string, Route[]>();
  const add = (ep: LocalEndpoint, base: string, peer: string | null) => {
    if (!ep.live) return;
    for (const m of ep.models) out.set(m, [...(out.get(m) ?? []), { endpoint: ep, base, peer }]);
  };
  for (const ep of local) add(ep, (ep as LocalEndpoint & { base: string }).base, null);
  for (const n of [...g.nodes].sort((a, b) => a.depth - b.depth || a.node.controller.id.localeCompare(b.node.controller.id)))
    for (const ep of n.node.endpoints) add(ep, n.url, n.url);
  return out;
};

export const graphUsage = (local: LocalUsage[], g: Graph): Map<string, number> => {
  const total = new Map<string, number>();
  for (const u of [local, ...g.nodes.map((n) => n.node.usage)].flat()) total.set(u.model, (total.get(u.model) ?? 0) + u.requests);
  return total;
};

export const pickAuto = (live: Map<string, Route[]>, usage: Map<string, number>): string | null =>
  [...live.keys()].filter((m) => m !== "auto").sort((a, b) => (usage.get(b) ?? 0) - (usage.get(a) ?? 0) || a.localeCompare(b))[0] ?? null;
