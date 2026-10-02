import * as Schema from "effect/Schema";
import { LOCAL_STUDIO_CONTROLLER_HEADER, type LocalUsage } from "../../../packages/contracts/src/localStudio.ts";
import { type Config, decodeJson } from "./core.ts";
import type { Endpoint } from "./discovery.ts";
import { type Graph, graphUsage, liveModels, pickAuto } from "./graph.ts";
import { observeUsage } from "./usage.ts";

export const HOP_HEADER = "x-local-studio-hop";
const PIN_HEADER = "x-local-studio-endpoint";
const FORWARD = ["content-type", "accept", "anthropic-version", "anthropic-beta", "openai-beta", "openai-organization", "openai-project", "x-request-id", "idempotency-key", "user-agent"];
const DROP = new Set(["content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive", "upgrade", "proxy-authenticate", "trailer", "te"]);
const Body = Schema.Record(Schema.String, Schema.Unknown);

export interface GatewayDeps {
  config: () => Config;
  local: () => Endpoint[];
  usage: () => LocalUsage[];
  graph: () => Promise<Graph>;
  record: (model: string, tokens?: number | null) => void;
}

const apiError = (status: number, type: string, message: string): Response => Response.json({ error: { type, code: type, message } }, { status });

export const routes = async (d: GatewayDeps, hop = false) => liveModels(d.local(), hop ? { links: [], nodes: [] } : await d.graph());

export const autoModel = async (d: GatewayDeps): Promise<string | null> => {
  const g = await d.graph();
  return pickAuto(liveModels(d.local(), g), graphUsage(d.usage(), g));
};

export const listModels = async (d: GatewayDeps): Promise<Response> => {
  const live = await routes(d);
  const data = ["auto", ...[...live.keys()].sort()].map((id) => ({
    id,
    object: "model",
    created: 0,
    owned_by: id === "auto" ? "local-studio" : [...new Set(live.get(id)?.map((r) => r.endpoint.controllerId))].join(","),
  }));
  return Response.json({ object: "list", data });
};

export const passthrough = async (d: GatewayDeps, req: Request, path: string): Promise<Response> => {
  const raw = await req.text();
  const body = decodeJson(Body, raw);
  if (!body || Array.isArray(body)) return apiError(400, "invalid_request_error", "request body must be a JSON object");
  const requested = body.model;
  if (typeof requested !== "string" || !requested) return apiError(400, "invalid_request_error", "model is required");
  const hop = req.headers.get(HOP_HEADER) === "1";
  const live = await routes(d, hop);
  const model = requested === "auto" && !hop ? await autoModel(d) : requested;
  if (!model) return apiError(503, "no_live_models", "no live models are reachable for auto");
  const pin = req.headers.get(PIN_HEADER);
  const candidates = (live.get(model) ?? []).filter((r) => !pin || r.endpoint.id === pin);
  if (!candidates.length) return apiError(404, "model_not_found", `model ${model} is not live on any reachable endpoint`);
  const payload = model === requested ? raw : JSON.stringify({ ...body, model });
  const cfg = d.config();
  let lastError = "";
  for (const r of candidates) {
    const headers = new Headers(FORWARD.flatMap((h) => { const v = req.headers.get(h); return v ? [[h, v] as [string, string]] : []; }));
    const key = r.peer ? cfg.fleetKey : cfg.engineKeys[String(r.endpoint.port)];
    if (key) headers.set("authorization", `Bearer ${key}`);
    if (r.peer) {
      headers.set(HOP_HEADER, "1");
      headers.set(PIN_HEADER, r.endpoint.id);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error("upstream headers timeout")), 30 * 60_000);
    let res: Response;
    try {
      res = await fetch(`${r.base}${path}${new URL(req.url).search}`, { method: "POST", headers, body: payload, signal: AbortSignal.any([req.signal, ac.signal]), redirect: "manual", decompress: true } as RequestInit);
    } catch (e) {
      if (req.signal.aborted) return new Response(null, { status: 499 });
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    } finally {
      clearTimeout(timer);
    }
    const out = new Headers([...res.headers].filter(([k]) => !DROP.has(k.toLowerCase())));
    out.set(PIN_HEADER, r.endpoint.id);
    out.set(LOCAL_STUDIO_CONTROLLER_HEADER, cfg.id);
    const count = res.ok && !r.peer;
    const usage = count ? observeUsage(res.headers.get("content-type") ?? "", path === "/v1/messages") : null;
    const stream = res.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(value, ctrl) {
        usage?.push(value);
        ctrl.enqueue(value);
      },
      flush() {
        if (count && !req.signal.aborted) d.record(model, usage?.finish());
      },
    }));
    if (!stream && count) d.record(model);
    return new Response(stream ?? null, { status: res.status, statusText: res.statusText, headers: out });
  }
  return apiError(502, "upstream_unreachable", `no endpoint for ${model} answered: ${lastError}`);
};
