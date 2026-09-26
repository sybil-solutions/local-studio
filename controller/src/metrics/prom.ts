import type { EngineCounters, EngineGauges } from "@local-studio/contracts";

export interface Series {
  labels: Record<string, string>;
  value: number;
}

export type Prom = Map<string, Series[]>;

const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

export const parseProm = (text: string): Prom => {
  const out: Prom = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const brace = line.indexOf("{");
    const space = line.indexOf(" ");
    let name: string;
    let labels: Record<string, string> = {};
    let rest: string;
    if (brace >= 0 && (space < 0 || brace < space)) {
      const close = line.lastIndexOf("}");
      if (close < brace) continue;
      name = line.slice(0, brace);
      for (const m of line.slice(brace + 1, close).matchAll(LABEL)) labels[m[1]!] = m[2]!.replace(/\\(.)/g, (_s, c: string) => (c === "n" ? "\n" : c));
      rest = line.slice(close + 1).trim();
    } else {
      if (space < 0) continue;
      name = line.slice(0, space);
      rest = line.slice(space + 1).trim();
    }
    if (name.endsWith("_created")) continue;
    const v = rest.split(/\s+/)[0] ?? "";
    const value = v === "+Inf" ? Infinity : v === "-Inf" ? -Infinity : Number(v);
    if (Number.isNaN(value)) continue;
    let list = out.get(name);
    if (!list) out.set(name, (list = []));
    list.push({ labels, value });
  }
  return out;
};

export const sum = (p: Prom, name: string, filter?: Record<string, string>): number | null => {
  const list = p.get(name);
  if (!list) return null;
  let total = 0;
  let hit = false;
  for (const s of list) {
    if (filter && Object.entries(filter).some(([k, v]) => s.labels[k] !== v)) continue;
    total += s.value;
    hit = true;
  }
  return hit ? total : null;
};

export const byLabel = (p: Prom, name: string, label: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const s of p.get(name) ?? []) {
    const k = s.labels[label] ?? "";
    out[k] = (out[k] ?? 0) + s.value;
  }
  return out;
};

export const detectEngine = (p: Prom): "vllm" | "sglang" | "llamacpp" | null => {
  for (const k of p.keys()) {
    if (k.startsWith("vllm:")) return "vllm";
    if (k.startsWith("sglang:")) return "sglang";
    if (k.startsWith("llamacpp:")) return "llamacpp";
  }
  return null;
};

const emptyCounters = (): EngineCounters => ({
  promptTokens: null, generationTokens: null, promptTokensCached: null, promptTokensLocalCompute: null, prefixCacheQueries: null,
  prefixCacheHits: null, externalPrefixCacheQueries: null, externalPrefixCacheHits: null, requestsSuccess: {}, httpStatus: {},
  preemptions: null, ttftSum: null, ttftCount: null, queueSum: null, queueCount: null, prefillSum: null, prefillCount: null,
  decodeSum: null, decodeCount: null, e2eSum: null, e2eCount: null, genTokensHistSum: null, specDrafts: null, specDraftTokens: null, specAccepted: null,
});

const emptyGauges = (): EngineGauges => ({ kvCacheUsage: null, running: null, waiting: null, sglangCacheHitRate: null, sglangGenThroughput: null });

const hist = (p: Prom, base: string): [number | null, number | null] => [sum(p, `${base}_sum`), sum(p, `${base}_count`)];

export const normalise = (p: Prom): { engine: "vllm" | "sglang" | "llamacpp" | null; counters: EngineCounters; gauges: EngineGauges } => {
  const engine = detectEngine(p);
  const c = emptyCounters();
  const g = emptyGauges();
  const http = byLabel(p, "http_requests_total", "status");
  c.httpStatus = http;
  if (engine === "vllm") {
    c.promptTokens = sum(p, "vllm:prompt_tokens_total");
    c.generationTokens = sum(p, "vllm:generation_tokens_total");
    c.promptTokensCached = sum(p, "vllm:prompt_tokens_by_source_total", { source: "local_cache_hit" }) ?? sum(p, "vllm:prompt_tokens_cached_total");
    c.promptTokensLocalCompute = sum(p, "vllm:prompt_tokens_by_source_total", { source: "local_compute" });
    c.prefixCacheQueries = sum(p, "vllm:prefix_cache_queries_total");
    c.prefixCacheHits = sum(p, "vllm:prefix_cache_hits_total");
    c.externalPrefixCacheQueries = sum(p, "vllm:external_prefix_cache_queries_total");
    c.externalPrefixCacheHits = sum(p, "vllm:external_prefix_cache_hits_total");
    c.requestsSuccess = byLabel(p, "vllm:request_success_total", "finished_reason");
    c.preemptions = sum(p, "vllm:num_preemptions_total");
    [c.ttftSum, c.ttftCount] = hist(p, "vllm:time_to_first_token_seconds");
    [c.queueSum, c.queueCount] = hist(p, "vllm:request_queue_time_seconds");
    [c.prefillSum, c.prefillCount] = hist(p, "vllm:request_prefill_time_seconds");
    [c.decodeSum, c.decodeCount] = hist(p, "vllm:request_decode_time_seconds");
    [c.e2eSum, c.e2eCount] = hist(p, "vllm:e2e_request_latency_seconds");
    c.genTokensHistSum = sum(p, "vllm:request_generation_tokens_sum");
    c.specDrafts = sum(p, "vllm:spec_decode_num_drafts_total");
    c.specDraftTokens = sum(p, "vllm:spec_decode_num_draft_tokens_total");
    c.specAccepted = sum(p, "vllm:spec_decode_num_accepted_tokens_total");
    g.kvCacheUsage = sum(p, "vllm:kv_cache_usage_perc") ?? sum(p, "vllm:gpu_cache_usage_perc");
    g.running = sum(p, "vllm:num_requests_running");
    g.waiting = sum(p, "vllm:num_requests_waiting");
  } else if (engine === "sglang") {
    c.promptTokens = sum(p, "sglang:prompt_tokens_total");
    c.generationTokens = sum(p, "sglang:generation_tokens_total");
    c.promptTokensCached = sum(p, "sglang:cached_tokens_total");
    const total = sum(p, "sglang:num_requests_total");
    const aborted = sum(p, "sglang:num_aborted_requests_total");
    if (total !== null) c.requestsSuccess = { finished: total - (aborted ?? 0), abort: aborted ?? 0 };
    [c.ttftSum, c.ttftCount] = hist(p, "sglang:time_to_first_token_seconds");
    [c.queueSum, c.queueCount] = hist(p, "sglang:queue_time_seconds");
    [c.e2eSum, c.e2eCount] = hist(p, "sglang:e2e_request_latency_seconds");
    g.kvCacheUsage = sum(p, "sglang:token_usage");
    g.running = sum(p, "sglang:num_running_reqs");
    g.waiting = sum(p, "sglang:num_queue_reqs");
    g.sglangCacheHitRate = sum(p, "sglang:cache_hit_rate");
    g.sglangGenThroughput = sum(p, "sglang:gen_throughput");
  } else if (engine === "llamacpp") {
    const processed = sum(p, "llamacpp:prompt_tokens_total");
    const cached = sum(p, "llamacpp:prompt_tokens_cached_total");
    c.promptTokensLocalCompute = processed;
    c.promptTokensCached = cached;
    c.promptTokens = processed === null ? null : processed + (cached ?? 0);
    c.specDrafts = sum(p, "llamacpp:spec_decode_num_drafts_total");
    c.specDraftTokens = sum(p, "llamacpp:spec_decode_num_draft_tokens_total");
    c.specAccepted = sum(p, "llamacpp:spec_decode_num_accepted_tokens_total");
    c.generationTokens = sum(p, "llamacpp:tokens_predicted_total");
    c.genTokensHistSum = c.generationTokens;
    c.prefillSum = sum(p, "llamacpp:prompt_seconds_total");
    c.decodeSum = sum(p, "llamacpp:tokens_predicted_seconds_total");
    g.kvCacheUsage = sum(p, "llamacpp:kv_cache_usage_ratio");
    g.running = sum(p, "llamacpp:requests_processing");
    g.waiting = sum(p, "llamacpp:requests_deferred");
  }
  return { engine, counters: c, gauges: g };
};

export const cacheConfig = (p: Prom): Record<string, string> | null => p.get("vllm:cache_config_info")?.[0]?.labels ?? null;
