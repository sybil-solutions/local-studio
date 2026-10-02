import { LOCAL_STUDIO_CONTROLLER_HEADER, type LocalUsage } from "../../../packages/contracts/src/localStudio.ts";
import type { Config } from "./core.ts";
import type { Endpoint } from "./discovery.ts";
import { type Graph, graphUsage, liveModels, pickAuto, type Route } from "./graph.ts";

export const HOP_HEADER = "x-local-studio-hop";
const PIN_HEADER = "x-local-studio-endpoint";
const FORWARD = ["content-type", "accept", "anthropic-version", "anthropic-beta", "openai-beta", "openai-organization", "openai-project", "x-request-id", "idempotency-key", "user-agent"];
const DROP = new Set(["content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive", "upgrade", "proxy-authenticate", "trailer", "te"]);
const HEADERS_TIMEOUT_MS = 30 * 60_000;

export interface GatewayDeps {
  config: () => Config;
  local: () => Endpoint[];
  usage: () => LocalUsage[];
  graph: () => Promise<Graph>;
  record: (model: string) => void;
}

const apiError = (status: number, type: string, message: string): Response =>
  new Response(JSON.stringify({ error: { type, code: type, message } }), { status, headers: { "content-type": "application/json" } });

export const routes = async (d: GatewayDeps, hop: boolean): Promise<Map<string, Route[]>> =>
  liveModels(d.local(), hop ? { links: [], nodes: [] } : await d.graph());

export const autoModel = async (d: GatewayDeps): Promise<string | null> => {
  const g = await d.graph();
  return pickAuto(liveModels(d.local(), g), graphUsage(d.usage(), g));
};

export const listModels = async (d: GatewayDeps): Promise<Response> => {
  const live = await routes(d, false);
  const data = ["auto", ...[...live.keys()].sort()].map((id) => ({
    id,
    object: "model",
    created: 0,
    owned_by: id === "auto" ? "local-studio" : [...new Set(live.get(id)?.map((r) => r.endpoint.controllerId))].join(","),
  }));
  return new Response(JSON.stringify({ object: "list", data }), { headers: { "content-type": "application/json" } });
};

export const passthrough = async (d: GatewayDeps, req: Request, path: string): Promise<Response> => {
  const raw = await req.arrayBuffer();
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return apiError(400, "invalid_request_error", "request body must be a JSON object");
  }
  const requested = body.model;
  if (typeof requested !== "string" || !requested) return apiError(400, "invalid_request_error", "model is required");
  const hop = req.headers.get(HOP_HEADER) === "1";
  const live = await routes(d, hop);
  const model = requested === "auto" && !hop ? await autoModel(d) : requested;
  if (!model) return apiError(503, "no_live_models", "no live models are reachable for auto");
  const pin = req.headers.get(PIN_HEADER);
  const candidates = (live.get(model) ?? []).filter((r) => !pin || r.endpoint.id === pin);
  if (!candidates.length) return apiError(404, "model_not_found", `model ${model} is not live on any reachable endpoint`);
  const payload = model === requested ? raw : new TextEncoder().encode(JSON.stringify({ ...body, model }));
  const cfg = d.config();
  let lastError = "";
  for (const r of candidates) {
    const headers = new Headers();
    for (const h of FORWARD) {
      const v = req.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (r.peer) {
      headers.set("authorization", `Bearer ${cfg.fleetKey}`);
      headers.set(HOP_HEADER, "1");
      headers.set(PIN_HEADER, r.endpoint.id);
    } else {
      const key = cfg.engineKeys[String(r.endpoint.port)];
      if (key) headers.set("authorization", `Bearer ${key}`);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("upstream headers timeout")), HEADERS_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${r.base}${path}${new URL(req.url).search}`, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.any([req.signal, ac.signal]),
        redirect: "manual",
        decompress: true,
      } as RequestInit);
    } catch (e) {
      clearTimeout(timer);
      if (req.signal.aborted) return new Response(null, { status: 499 });
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
    clearTimeout(timer);
    const out = new Headers();
    res.headers.forEach((v, k) => {
      if (!DROP.has(k.toLowerCase())) out.set(k, v);
    });
    out.set(PIN_HEADER, r.endpoint.id);
    out.set(LOCAL_STUDIO_CONTROLLER_HEADER, cfg.id);
    const count = res.ok && !r.peer;
    if (!res.body) {
      if (count) d.record(model);
      return new Response(null, { status: res.status, statusText: res.statusText, headers: out });
    }
    const reader = res.body.getReader();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            if (count && !cancelled && !req.signal.aborted) d.record(model);
            ctrl.close();
          } else ctrl.enqueue(value);
        } catch (e) {
          ctrl.error(e);
        }
      },
      cancel(reason) {
        cancelled = true;
        ac.abort(reason);
        return reader.cancel(reason);
      },
    });
    return new Response(stream, { status: res.status, statusText: res.statusText, headers: out });
  }
  return apiError(502, "upstream_unreachable", `no endpoint for ${model} answered: ${lastError}`);
};
