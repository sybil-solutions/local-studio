import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { type LocalControllerLink, type LocalEndpoint, LocalNode, LocalUsage } from "../../../packages/contracts/src/localStudio.ts";
import { type Config, fetchJson, home, now, readJson, writeJson } from "./core.ts";

const MAX_DEPTH = 4;
const MAX_NODES = 32;
const decodeNode = Schema.decodeUnknownOption(LocalNode);

export const normUrl = (u: string): string => u.trim().replace(/\/+$/, "");

const isLoopback = (u: string): boolean => /^https?:\/\/(localhost|127\.[\d.]+|\[::1\])(:|$)/.test(u);

export interface Graph {
  links: LocalControllerLink[];
  nodes: { url: string; depth: number; node: LocalNode }[];
}

const usagePath = join(home, "usage.json");
const { model: _model, ...usageFields } = LocalUsage.fields;

export const makeUsage = () => {
  const counts = new Map(Object.entries(readJson(usagePath, Schema.Record(Schema.String, Schema.Struct(usageFields)), {})));
  return {
    record: (model: string, tokens: number | null = null) => {
      const c = counts.get(model);
      const lastAt = now();
      const day = lastAt.slice(0, 10);
      counts.set(model, { requests: (c?.requests ?? 0) + 1, lastAt,
        measuredRequests: (c?.measuredRequests ?? 0) + Number(tokens !== null),
        tokens: { ...c?.tokens, ...(tokens === null ? {} : { [day]: (c?.tokens?.[day] ?? 0) + tokens }) },
      });
      try {
        writeJson(usagePath, Object.fromEntries(counts));
      } catch (error) { console.error("Usage persistence failed", String(error)); }
    },
    list: (): LocalUsage[] => [...counts].map(([model, c]) => ({ model, ...c })).sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model)),
  };
};

export const makeGraph = (config: () => Config, self: () => LocalNode) => {
  let cache: { at: number; value: Promise<Graph> } | null = null;

  const fetchNode = (url: string) =>
    fetchJson(`${url}/api/node`, 3_000, { authorization: `Bearer ${config().fleetKey}` }).pipe(
      Effect.flatMap((r) => {
        const n = decodeNode(r.body);
        return r.status !== 200 ? Effect.fail(`HTTP ${r.status}`) : n._tag === "Some" ? Effect.succeed(n.value) : Effect.fail("not a Local Studio controller");
      }),
      Effect.result,
    );

  const walk = Effect.gen(function* () {
    const me = self();
    const ids = new Set([me.controller.id]);
    const urls = new Set([normUrl(me.controller.url)]);
    const links: LocalControllerLink[] = [{ ...me.controller, self: true, reachable: true, error: null, usage: me.usage }];
    const nodes: Graph["nodes"] = [];
    let frontier = config().peers.map(normUrl);
    for (let depth = 1; depth <= MAX_DEPTH && frontier.length && nodes.length < MAX_NODES; depth++) {
      const batch = [...new Set(frontier)].filter((u) => !urls.has(u)).slice(0, MAX_NODES - nodes.length);
      for (const u of batch) urls.add(u);
      const got = yield* Effect.forEach(batch, (u) => fetchNode(u).pipe(Effect.map((r) => [u, r] as const)), { concurrency: 8 });
      frontier = [];
      for (const [url, r] of got) {
        if (r._tag === "Failure") {
          links.push({ id: null, name: null, url, self: false, reachable: false, error: r.failure });
          continue;
        }
        const n = r.success;
        if (ids.has(n.controller.id)) continue;
        ids.add(n.controller.id);
        nodes.push({ url, depth, node: n });
        links.push({ id: n.controller.id, name: n.controller.name, url, self: false, reachable: true, error: null, usage: n.usage });
        frontier.push(...n.peers.map(normUrl).filter((p) => isLoopback(url) || !isLoopback(p)));
      }
    }
    return { links, nodes };
  });

  return {
    get: (): Promise<Graph> => {
      if (!cache || Date.now() - cache.at >= 5_000) cache = { at: Date.now(), value: Effect.runPromise(walk) };
      return cache.value;
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

export const liveModels = (local: (LocalEndpoint & { base: string })[], g: Graph): Map<string, Route[]> => {
  const out = new Map<string, Route[]>();
  const add = (ep: LocalEndpoint, base: string, peer: string | null) => {
    if (ep.live) for (const m of ep.models) out.set(m, [...(out.get(m) ?? []), { endpoint: ep, base, peer }]);
  };
  for (const ep of local) add(ep, ep.base, null);
  for (const n of [...g.nodes].sort((a, b) => a.depth - b.depth || a.node.controller.id.localeCompare(b.node.controller.id)))
    for (const ep of n.node.endpoints) add(ep, n.url, n.url);
  return out;
};

export const graphUsage = (local: LocalUsage[], g: Graph): Map<string, LocalUsage> => {
  const total = new Map<string, LocalUsage>();
  for (const u of [local, ...g.nodes.map((n) => n.node.usage)].flat()) {
    const previous = total.get(u.model);
    const tokens = { ...previous?.tokens };
    for (const [day, count] of Object.entries(u.tokens ?? {})) tokens[day] = (tokens[day] ?? 0) + count;
    total.set(u.model, { model: u.model, requests: (previous?.requests ?? 0) + u.requests,
      lastAt: [previous?.lastAt, u.lastAt].filter((at): at is string => !!at).sort().at(-1) ?? null,
      measuredRequests: (previous?.measuredRequests ?? 0) + (u.measuredRequests ?? 0), tokens,
    });
  }
  return total;
};

export const pickAuto = (live: Map<string, Route[]>, usage: Map<string, LocalUsage>): string | null =>
  [...live.keys()].filter((m) => m !== "auto").sort((a, b) => (usage.get(b)?.requests ?? 0) - (usage.get(a)?.requests ?? 0) || a.localeCompare(b))[0] ?? null;
