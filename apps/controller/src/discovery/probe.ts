import type { Engine, EndpointKind } from "@local-studio/contracts";
import type { Ctx } from "../context";
import { parseJson } from "./util";

export const PROBE_TIMEOUT_MS = 1500;
export const PROBE_CONCURRENCY = 8;
export const PROBE_MAX = 64;
export const NEG_TTL_MS = 5 * 60 * 1000;

export interface ModelEntry {
  id: string;
  maxModelLen: number | null;
  root: string | null;
  ownedBy: string | null;
  raw: Record<string, unknown>;
}

export type Fingerprint =
  | {
      kind: "model";
      engine: Engine;
      version: string | null;
      models: ModelEntry[];
      metricsPrefix: string | null;
      propsCtx: number | null;
      propsVision: boolean | null;
    }
  | { kind: "openai"; models: ModelEntry[] }
  | { kind: "endpoint"; ekind: EndpointKind; note: string }
  | { kind: "down"; status: number | null; note: string };

interface Got {
  status: number | null;
  body: string;
}

export const get = async (ctx: Ctx, url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<Got> => {
  try {
    const r = await ctx.fetch(url, { method: "GET", timeoutMs, headers: { accept: "application/json, text/plain, */*" } });
    const body = await Promise.race([r.text(), new Promise<string>((res) => setTimeout(() => res(""), timeoutMs))]);
    return { status: r.status, body };
  } catch (e) {
    return { status: null, body: String(e) };
  }
};

export const parseModels = (body: string): ModelEntry[] | null => {
  const j = parseJson<{ data?: unknown }>(body);
  if (!j || !Array.isArray(j.data)) return null;
  return j.data
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && typeof (d as { id?: unknown }).id === "string")
    .map((d) => ({
      id: d.id as string,
      maxModelLen: typeof d.max_model_len === "number" ? d.max_model_len : typeof d.context_length === "number" ? d.context_length : null,
      root: typeof d.root === "string" ? d.root : null,
      ownedBy: typeof d.owned_by === "string" ? d.owned_by : null,
      raw: d,
    }));
};

const METRIC_PREFIX = /^(vllm|sglang|llamacpp):/m;

export const fingerprint = async (ctx: Ctx, base: string, argvHint: string | null): Promise<Fingerprint> => {
  const m = await get(ctx, `${base}/v1/models`);
  if (m.status === null) return { kind: "down", status: null, note: "no connection" };
  if (m.status === 401 || m.status === 403) return { kind: "endpoint", ekind: "auth-proxy", note: `${m.status} on /v1/models` };
  const models = m.status === 200 ? parseModels(m.body) : null;
  if (!models) {
    if (m.status >= 500) return { kind: "down", status: m.status, note: `${m.status} on /v1/models` };
    return { kind: "endpoint", ekind: "unknown-http", note: `${m.status} on /v1/models` };
  }
  const [ver, sgl, props, tabby, metrics] = await Promise.all([
    get(ctx, `${base}/version`),
    get(ctx, `${base}/get_server_info`),
    get(ctx, `${base}/props`),
    get(ctx, `${base}/v1/model`),
    get(ctx, `${base}/metrics`),
  ]);
  const prefix = metrics.status === 200 ? (METRIC_PREFIX.exec(metrics.body)?.[1] ?? null) : null;
  const owned = models[0]?.ownedBy ?? "";
  const verJson = ver.status === 200 ? parseJson<{ version?: string }>(ver.body) : null;
  const sglJson = sgl.status === 200 ? parseJson<{ version?: string }>(sgl.body) : null;
  const propsJson = props.status === 200 ? parseJson<{ build_info?: string; default_generation_settings?: { n_ctx?: number }; n_ctx?: number; modalities?: { vision?: boolean } }>(props.body) : null;
  const hinted = argvHint && /vllm-mlx|mlx_lm/.test(argvHint) ? "mlx" : null;
  let engine: Engine | null = null;
  if (hinted) engine = "mlx";
  else if (sglJson || prefix === "sglang" || owned === "sglang") engine = "sglang";
  else if (propsJson || prefix === "llamacpp" || owned === "llamacpp") engine = "llamacpp";
  else if (tabby.status === 200 && parseJson(tabby.body)) engine = "tabby";
  else if (prefix === "vllm" || owned === "vllm" || verJson?.version) engine = "vllm";
  if (!engine) return { kind: "openai", models };
  const version =
    engine === "sglang" ? (sglJson?.version ?? verJson?.version ?? null) : engine === "llamacpp" ? (propsJson?.build_info ?? null) : (verJson?.version ?? null);
  return {
    kind: "model",
    engine,
    version,
    models,
    metricsPrefix: prefix,
    propsCtx: propsJson?.default_generation_settings?.n_ctx ?? propsJson?.n_ctx ?? null,
    propsVision: typeof propsJson?.modalities?.vision === "boolean" ? propsJson.modalities.vision : null,
  };
};

export interface Health {
  ok: boolean;
  models: ModelEntry[] | null;
  note: string;
}

export const healthCheck = async (ctx: Ctx, base: string, light = false, engine: Engine | null = null): Promise<Health> => {
  const h = engine === "sglang" ? { status: 404 } : await get(ctx, `${base}/health`);
  if (h.status === null) return { ok: false, models: null, note: "no connection" };
  if (h.status !== 200 && h.status !== 404) return { ok: false, models: null, note: `/health ${h.status}` };
  if (light && h.status === 200) return { ok: true, models: null, note: "" };
  const m = await get(ctx, `${base}/v1/models`);
  const models = m.status === 200 ? parseModels(m.body) : null;
  if (!models || !models.length) return { ok: false, models, note: `/v1/models ${m.status ?? "no connection"}` };
  return { ok: true, models, note: "" };
};

interface NegEntry {
  at: number;
  fp: Fingerprint;
}

export const createProbeCache = () => {
  const neg = new Map<string, NegEntry>();
  const pos = new Map<string, Fingerprint>();
  return {
    getNeg(port: number, owner: string | number | null): Fingerprint | null {
      const e = neg.get(`${port}:${owner ?? ""}`);
      if (!e) return null;
      if (Date.now() - e.at > NEG_TTL_MS) {
        neg.delete(`${port}:${owner ?? ""}`);
        return null;
      }
      return e.fp;
    },
    setNeg(port: number, owner: string | number | null, fp: Fingerprint) {
      neg.set(`${port}:${owner ?? ""}`, { at: Date.now(), fp });
    },
    getPos: (key: string) => pos.get(key) ?? null,
    setPos: (key: string, fp: Fingerprint) => pos.set(key, fp),
    prune(liveKeys: Set<string>) {
      for (const k of pos.keys()) if (!liveKeys.has(k)) pos.delete(k);
    },
  };
};

export type ProbeCache = ReturnType<typeof createProbeCache>;
