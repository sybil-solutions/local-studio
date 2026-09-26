import { useEffect, useMemo, useState } from "react";
import type { DailyRow, EngineRates, MetricsSlice, MetricsSummary, Window } from "@local-studio/contracts/client";
import { ERROR_CODES, fmt } from "@local-studio/contracts/client";
import { get, via } from "../api";
import { type Col, SectionHeading, Table } from "../components/basics";
import { Pills, sliceHit } from "../components/cards";
import { machines } from "../model/view";
import { go } from "../route";
import { useStore } from "../store";

const WINDOWS: Window[] = ["1h", "24h", "7d", "30d", "all"];
const WINDOW_DAYS: Record<Window, number> = { "1h": 0, "24h": 1, "7d": 6, "30d": 29, all: 3650 };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const usd = (x: number | null) => (x === null ? "$0 local" : x === 0 ? "$0" : `$${x < 1 ? x.toFixed(3) : x.toFixed(2)}`);

interface Agg {
  key: string;
  requests: number;
  errors: number;
  inputUncached: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  cacheUnknownPrompt: number;
  decodeTokens: number;
  decodeMs: number;
  ttftSumMs: number;
  ttftN: number;
  costUsd: number;
  priced: boolean;
}

const fold = (rows: DailyRow[], keyOf: (r: DailyRow) => string): Agg[] => {
  const m = new Map<string, Agg>();
  for (const r of rows) {
    const k = keyOf(r);
    const a = m.get(k) ?? { key: k, requests: 0, errors: 0, inputUncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, cacheUnknownPrompt: 0, decodeTokens: 0, decodeMs: 0, ttftSumMs: 0, ttftN: 0, costUsd: 0, priced: false };
    a.requests += r.requests;
    a.errors += r.errors;
    a.inputUncached += r.inputUncached;
    a.cacheRead += r.cacheRead;
    a.cacheWrite += r.cacheWrite;
    a.output += r.output;
    a.reasoning += r.reasoning;
    a.cacheUnknownPrompt += r.cacheUnknownPrompt ?? 0;
    a.decodeTokens += r.decodeTokens;
    a.decodeMs += r.decodeMs;
    a.ttftSumMs += r.ttftSumMs;
    a.ttftN += r.ttftN;
    a.costUsd += r.costUsd ?? 0;
    a.priced ||= (r.costUsd ?? 0) > 0;
    m.set(k, a);
  }
  return [...m.values()];
};

const bucketCols = <T extends { inputUncached: number; cacheRead: number; cacheWrite: number; output: number; cacheUnknownPrompt: number }>(): Col<T>[] => [
  { h: "input", n: true, c: (r) => fmt.k(r.inputUncached) },
  { h: "cache read", n: true, c: (r) => fmt.k(r.cacheRead) },
  { h: "cache write", n: true, c: (r) => fmt.k(r.cacheWrite) },
  { h: "output", n: true, c: (r) => fmt.k(r.output) },
  { h: "hit", n: true, c: (r) => sliceHit({ cacheRead: r.cacheRead, promptTotal: r.inputUncached + r.cacheRead + r.cacheWrite, cacheUnknownPrompt: r.cacheUnknownPrompt }) },
];

const sliceCols = (h: string): Col<MetricsSlice>[] => [
  { h, c: (r) => <span className="cut" title={r.key}>{r.key}</span> },
  { h: "requests", n: true, c: (r) => fmt.k(r.requests) },
  ...bucketCols<MetricsSlice>(),
  { h: "decode", n: true, c: (r) => fmt.tps(r.decodeTps) },
  { h: "prefill", n: true, c: (r) => fmt.tps(r.prefillTps) },
  { h: "ttft", n: true, c: (r) => fmt.ms(r.meanTtftMs) },
  { h: "errors", n: true, c: (r) => (r.errors ? <span className="alert">{r.errors}</span> : "0") },
  { h: "$", n: true, c: (r) => usd(r.costUsd) },
];

export const MetricsPage = ({ machineId }: { machineId: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const liveEngines = useStore((s) => s.engines);
  const ms = useMemo(() => machines(fleet, live).filter((m) => m.online), [fleet, live]);
  const mv = ms.find((m) => m.id === machineId) ?? ms.find((m) => m.self) ?? ms[0] ?? null;
  const [win, setWin] = useState<Window>("24h");
  const [by, setBy] = useState<"model" | "client">("model");
  const [sum, setSum] = useState<MetricsSummary | null>(null);
  const [daily, setDaily] = useState<DailyRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const peerId = mv?.peerId ?? null;

  useEffect(() => {
    if (!mv) return;
    let on = true;
    const load = async () => {
      const from = new Date();
      from.setDate(from.getDate() - WINDOW_DAYS[win]);
      const to = new Date();
      to.setDate(to.getDate() + 1);
      const [s, d] = await Promise.all([
        get<MetricsSummary>(via(peerId, `/api/metrics/summary?window=${win}`)),
        get<DailyRow[]>(via(peerId, `/api/usage/daily?from=${ymd(from)}&to=${ymd(to)}&group=model,client`)),
      ]);
      if (!on) return;
      setSum(s.ok && typeof s.data?.requests === "number" ? s.data : null);
      setDaily(d.ok && Array.isArray(d.data) ? d.data : null);
      setErr(s.ok ? null : s.error);
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [mv?.id, peerId, win]);

  const engines: EngineRates[] = (mv?.snap?.engines ?? []).map((e) => (mv?.self && liveEngines[e.modelId] ? liveEngines[e.modelId]! : e));
  const days = daily ? fold(daily, (r) => r.day).sort((a, b) => b.key.localeCompare(a.key)) : [];
  const errs = sum ? ERROR_CODES.filter((c) => (sum.errorsByCode[c] ?? 0) > 0) : [];

  return (
    <>
      <div className="top gap-top">
        <div className="tabs">
          {ms.map((m) => (
            <button type="button" key={m.id} className={m.id === mv?.id ? "on" : ""} onClick={() => go(`#/metrics/${encodeURIComponent(m.id)}`)}>
              {m.name}
            </button>
          ))}
        </div>
        <div className="tabs conn">
          {WINDOWS.map((w) => (
            <button type="button" key={w} className={w === win ? "on" : ""} onClick={() => setWin(w)}>
              {w}
            </button>
          ))}
        </div>
      </div>
      <SectionHeading aside={<span className="label">gateway: requests that went through this controller</span>}>summary</SectionHeading>
      <Pills s={sum} engine={null} title={`${mv?.name ?? ""} · ${win} · gateway`} />
      {err && <div className="note gap-block">summary: {err}</div>}

      <div className="cols">
        <div className="col">
          <SectionHeading aside={<span className="label">gateway</span>}>latency percentiles</SectionHeading>
          <Table
            cols={[
              { h: "", c: (r: { k: string; p50: string; p90: string; p99: string }) => r.k },
              { h: "p50", n: true, c: (r) => r.p50 },
              { h: "p90", n: true, c: (r) => r.p90 },
              { h: "p99", n: true, c: (r) => r.p99 },
            ]}
            rows={
              sum
                ? [
                    { k: "TTFT", p50: fmt.ms(sum.ttftMs.p50), p90: fmt.ms(sum.ttftMs.p90), p99: fmt.ms(sum.ttftMs.p99) },
                    { k: "decode tok/s", p50: fmt.tps(sum.decodeTpsPerRequest.p50), p90: fmt.tps(sum.decodeTpsPerRequest.p90), p99: fmt.tps(sum.decodeTpsPerRequest.p99) },
                  ]
                : []
            }
            keyOf={(r) => r.k}
            empty="–"
          />
          <SectionHeading aside={<span className="label">gateway</span>}>errors by code</SectionHeading>
          <Table
            cols={[
              { h: "code", c: (c: string) => <span className="alert">{c}</span> },
              { h: "count", n: true, c: (c: string) => String(sum?.errorsByCode[c as (typeof ERROR_CODES)[number]] ?? 0) },
              { h: "share", n: true, c: (c: string) => fmt.pct(sum && sum.requests ? (sum.errorsByCode[c as (typeof ERROR_CODES)[number]] ?? 0) / sum.requests : null) },
            ]}
            rows={errs}
            keyOf={(c) => c}
            empty={sum ? "no errors" : "–"}
          />
        </div>
        <div className="col">
          <SectionHeading aside={<span className="label">engine-wide, includes direct traffic</span>}>engines</SectionHeading>
          <Table<EngineRates>
            cols={[
              { h: "model", c: (e) => e.modelId },
              { h: "prefix hit", n: true, c: (e) => fmt.pct(e.prefixHitRate) },
              { h: "KV", n: true, c: (e) => fmt.pct(e.kvCacheUsage) },
              { h: "spec len", n: true, c: (e) => (e.specAcceptLength === null ? "–" : e.specAcceptLength.toFixed(2)) },
              { h: "prefill tok/s", n: true, c: (e) => fmt.tps(e.prefillTps) },
              { h: "decode tok/s", n: true, c: (e) => fmt.tps(e.decodeTps) },
              { h: "gen tok/s", n: true, c: (e) => fmt.tps(e.generationTpsWall) },
              { h: "ttft", n: true, c: (e) => fmt.ms(e.meanTtftMs) },
              { h: "queue", n: true, c: (e) => fmt.ms(e.meanQueueMs) },
              { h: "run / wait", n: true, c: (e) => `${e.running ?? "–"} / ${e.waiting ?? "–"}` },
            ]}
            rows={engines}
            keyOf={(e) => e.modelId}
            empty="no engine samples"
          />
          <SectionHeading
            aside={
              <span className="tabs">
                {(["model", "client"] as const).map((k) => (
                  <button type="button" key={k} className={by === k ? "on" : ""} onClick={() => setBy(k)}>
                    {k}
                  </button>
                ))}
              </span>
            }
          >
            usage and spend
          </SectionHeading>
          <Table cols={sliceCols(by)} rows={sum ? (by === "model" ? sum.byModel : sum.byClient) : []} keyOf={(r) => r.key} empty={sum ? "no usage in this window" : "–"} />
          <SectionHeading aside={<span className="label">gateway, local days</span>}>daily</SectionHeading>
          <Table<Agg>
            cols={[
              { h: "day", c: (r) => r.key },
              { h: "req", n: true, c: (r) => fmt.k(r.requests) },
              ...bucketCols<Agg>(),
              { h: "decode", n: true, c: (r) => fmt.tps(r.decodeMs > 0 ? r.decodeTokens / (r.decodeMs / 1000) : null) },
              { h: "ttft", n: true, c: (r) => fmt.ms(r.ttftN ? r.ttftSumMs / r.ttftN : null) },
              { h: "errors", n: true, c: (r) => (r.errors ? <span className="alert">{r.errors}</span> : "0") },
              { h: "$", n: true, c: (r) => (r.priced ? usd(r.costUsd) : "$0 local") },
            ]}
            rows={days}
            keyOf={(r) => r.key}
            empty={daily === null ? "–" : "no usage in this window"}
          />
        </div>
      </div>
    </>
  );
};
