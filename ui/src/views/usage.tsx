import { useEffect, useMemo, useState } from "react";
import type { DailyRow, HourlyRow, MetricsSlice, MetricsSummary, Window } from "@local-studio/contracts/client";
import { ERROR_CODES, fmt } from "@local-studio/contracts/client";
import { get, via } from "../api";
import { type Col, SectionHeading, Table } from "../components/basics";
import { ActivityGrid, FigureGrid, HourCharts, sliceHit } from "../components/cards";
import { life, machines, type MachineView, sumActivity } from "../model/view";
import { useStore } from "../store";

const WINDOWS: Window[] = ["24h", "7d", "30d", "all"];
const BACK: Record<Window, number> = { "1h": 1, "24h": 1, "7d": 6, "30d": 29, all: 3650 };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const usd = (x: number | null) => (x === null ? "$0" : `$${x < 1 ? x.toFixed(3) : x.toFixed(2)}`);
const SUMS = ["requests", "errors", "inputUncached", "cacheRead", "cacheWrite", "output", "reasoning", "cacheUnknownPrompt", "decodeTokens", "decodeMs", "prefillTokens", "prefillMs", "ttftSumMs", "ttftN"] as const;

type Agg = { key: string; costUsd: number | null } & Record<(typeof SUMS)[number], number>;
interface Data {
  m: MachineView;
  sum: MetricsSummary | null;
  daily: DailyRow[];
  hourly: HourlyRow[];
}

const fold = <T extends Omit<Agg, "key">>(rows: T[], keyOf: (r: T) => string): Agg[] => {
  const m = new Map<string, Agg>();
  for (const r of rows) {
    const k = keyOf(r);
    const a = m.get(k) ?? ({ key: k, costUsd: null, ...Object.fromEntries(SUMS.map((s) => [s, 0])) } as Agg);
    for (const s of SUMS) a[s] += r[s] ?? 0;
    if (r.costUsd) a.costUsd = (a.costUsd ?? 0) + r.costUsd;
    m.set(k, a);
  }
  return [...m.values()];
};

const SLICE_SUMS = [...SUMS, "promptTotal"] as const;
const mergeSlices = (lists: MetricsSlice[][]): MetricsSlice[] => {
  const m = new Map<string, MetricsSlice & { exact: boolean }>();
  for (const s of lists.flat()) {
    const a = m.get(s.key);
    if (!a) m.set(s.key, { ...s, exact: typeof s.decodeMs === "number" });
    else {
      for (const k of SLICE_SUMS) a[k] = (a[k] ?? 0) + (s[k] ?? 0);
      a.costUsd = a.costUsd === null && s.costUsd === null ? null : (a.costUsd ?? 0) + (s.costUsd ?? 0);
      a.exact &&= typeof s.decodeMs === "number";
      a.decodeTps = a.exact && a.decodeMs > 0 ? a.decodeTokens / (a.decodeMs / 1000) : null;
      a.prefillTps = a.exact && a.prefillMs > 0 ? a.prefillTokens / (a.prefillMs / 1000) : null;
      a.meanTtftMs = a.exact && a.ttftN > 0 ? a.ttftSumMs / a.ttftN : null;
    }
  }
  return [...m.values()].sort((a, b) => b.promptTotal + b.output - (a.promptTotal + a.output));
};

const tokenCols = <T extends { inputUncached: number; cacheRead: number; cacheWrite: number; output: number; cacheUnknownPrompt: number; requests: number; errors: number }>(): Col<T>[] => [
  { h: "req", n: true, c: (r) => fmt.k(r.requests) },
  { h: "in", n: true, c: (r) => fmt.k(r.inputUncached + r.cacheWrite + r.cacheUnknownPrompt) },
  { h: "cached", n: true, c: (r) => fmt.k(r.cacheRead) },
  { h: "out", n: true, c: (r) => fmt.k(r.output) },
  { h: "hit", n: true, c: (r) => sliceHit({ cacheRead: r.cacheRead, promptTotal: r.inputUncached + r.cacheRead + r.cacheWrite + r.cacheUnknownPrompt, cacheUnknownPrompt: r.cacheUnknownPrompt }) },
  { h: "err", n: true, c: (r) => (r.errors ? <span className="alert">{`${r.errors} · ${fmt.pct(r.errors / r.requests)}`}</span> : "0") },
];

const aggCols = (h: string): Col<Agg>[] => [
  { h, c: (r) => r.key },
  ...tokenCols<Agg>(),
  { h: "decode", n: true, c: (r) => fmt.tps(r.decodeMs > 0 ? r.decodeTokens / (r.decodeMs / 1000) : null) },
  { h: "ttft", n: true, c: (r) => fmt.ms(r.ttftN ? r.ttftSumMs / r.ttftN : null) },
  { h: "$", n: true, c: (r) => usd(r.costUsd) },
];

const sliceCols = (h: string): Col<MetricsSlice>[] => [
  { h, c: (r) => <span className="cut" title={r.key}>{r.key}</span> },
  ...tokenCols<MetricsSlice>(),
  { h: "decode", n: true, c: (r) => fmt.tps(r.decodeTps) },
  { h: "prefill", n: true, c: (r) => fmt.tps(r.prefillTps) },
  { h: "ttft", n: true, c: (r) => fmt.ms(r.meanTtftMs) },
  { h: "$", n: true, c: (r) => usd(r.costUsd) },
];

export const UsagePage = ({ machineId }: { machineId: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const pick = useMemo(() => machines(fleet, live).filter((m) => m.online && (!machineId || m.id === machineId)), [fleet, live, machineId]);
  const now = useStore((s) => Math.floor(s.now / 60_000) * 60_000);
  const [win, setWin] = useState<Window>("7d");
  const [data, setData] = useState<Data[]>([]);
  const ids = pick.map((m) => `${m.id}:${m.peerId ?? ""}`).join(",");

  useEffect(() => {
    let on = true;
    const load = async () => {
      const from = new Date();
      from.setDate(from.getDate() - BACK[win]);
      const to = new Date();
      to.setDate(to.getDate() + 1);
      const out = await Promise.all(
        pick.map(async (m) => {
          const [s, d, h] = await Promise.all([
            get<MetricsSummary>(via(m.peerId, `/api/metrics/summary?window=${win}`)),
            get<DailyRow[]>(via(m.peerId, `/api/usage/daily?from=${ymd(from)}&to=${ymd(to)}&group=model,client`)),
            get<HourlyRow[]>(via(m.peerId, `/api/usage/hourly?from=${Date.now() - 86_400_000}`)),
          ]);
          return {
            m,
            sum: s.ok && typeof s.data?.requests === "number" ? s.data : null,
            daily: d.ok && Array.isArray(d.data) ? d.data : [],
            hourly: h.ok && Array.isArray(h.data) ? h.data : [],
          };
        }),
      );
      if (on) setData(out);
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [ids, win]);

  const act = machineId ? (pick[0]?.snap?.activity ?? null) : sumActivity(fleet);
  const sums = data.map((d) => d.sum).filter((s): s is MetricsSummary => !!s);
  const tot = fold(sums.map((s) => ({ ...s, ttftSumMs: 0, ttftN: 0 })), () => "all")[0];
  const active = sums.filter((s) => s.requests > 0);
  const one = active.length === 1 ? active[0]! : null;
  const days = fold(data.flatMap((d) => d.daily), (r) => r.day).sort((a, b) => b.key.localeCompare(a.key));
  const codes = ERROR_CODES.map((c) => ({ c, n: sums.reduce((t, s) => t + (s.errorsByCode[c] ?? 0), 0) })).filter((x) => x.n > 0);
  const prompt = tot ? tot.inputUncached + tot.cacheRead + tot.cacheWrite + tot.cacheUnknownPrompt : 0;

  return (
    <div className="page">
      <div className="half">
        <SectionHeading
          aside={
            <span className="tabs">
              {WINDOWS.map((w) => (
                <button type="button" key={w} className={w === win ? "on" : ""} onClick={() => setWin(w)}>
                  {w}
                </button>
              ))}
            </span>
          }
        >
          activity
        </SectionHeading>
        {act && <ActivityGrid v={life(act)} />}
      </div>
      <div className="half">
        <SectionHeading>{`totals ${win}`}</SectionHeading>
        <FigureGrid
          cells={[
            { v: tot ? fmt.k(tot.requests) : "–", k: "requests" },
            { v: tot ? fmt.k(tot.inputUncached + tot.cacheWrite + tot.cacheUnknownPrompt) : "–", k: "tokens in" },
            { v: tot ? fmt.k(tot.cacheRead) : "–", k: "tokens cached" },
            { v: tot ? fmt.k(tot.output) : "–", k: "tokens out" },
            { v: tot ? sliceHit({ cacheRead: tot.cacheRead, promptTotal: prompt, cacheUnknownPrompt: tot.cacheUnknownPrompt }) : "–", k: "cache hit" },
            { v: tot ? usd(tot.costUsd) : "–", k: "spend" },
            { v: tot && tot.requests ? fmt.pct(tot.errors / tot.requests) : "–", k: `errors ${tot?.errors ?? 0}` },
            { v: tot && tot.decodeMs ? fmt.tps(tot.decodeTokens / (tot.decodeMs / 1000)) : "–", k: "decode tok/s" },
            { v: tot && tot.prefillMs ? fmt.tps(tot.prefillTokens / (tot.prefillMs / 1000)) : "–", k: "prefill tok/s" },
            { v: one ? fmt.ms(one.ttftMs.p50) : "–", k: "ttft p50" },
            { v: one ? fmt.ms(one.ttftMs.p90) : "–", k: "ttft p90" },
            { v: one ? fmt.ms(one.ttftMs.p99) : "–", k: "ttft p99" },
          ]}
        />
      </div>
      <HourCharts rows={data.flatMap((d) => d.hourly)} now={now} />
      <div className="half">
        <SectionHeading>by machine</SectionHeading>
        <Table<Data>
          cols={[
            { h: "machine", c: (d) => d.m.name },
            { h: "req", n: true, c: (d) => (d.sum ? fmt.k(d.sum.requests) : "–") },
            { h: "p50", n: true, c: (d) => fmt.ms(d.sum?.ttftMs.p50) },
            { h: "p90", n: true, c: (d) => fmt.ms(d.sum?.ttftMs.p90) },
            { h: "p99", n: true, c: (d) => fmt.ms(d.sum?.ttftMs.p99) },
            { h: "decode", n: true, c: (d) => fmt.tps(d.sum?.decodeTps) },
            { h: "prefill", n: true, c: (d) => fmt.tps(d.sum?.prefillTps) },
            { h: "err", n: true, c: (d) => fmt.pct(d.sum?.errorRate) },
          ]}
          rows={data}
          keyOf={(d) => d.m.id}
        />
      </div>
      <div className="half">
        <SectionHeading>errors</SectionHeading>
        <Table
          cols={[
            { h: "code", c: (x: { c: string; n: number }) => <span className="alert">{x.c}</span> },
            { h: "count", n: true, c: (x) => fmt.k(x.n) },
            { h: "share", n: true, c: (x) => fmt.pct(tot?.requests ? x.n / tot.requests : null) },
          ]}
          rows={codes}
          keyOf={(x) => x.c}
        />
      </div>
      <div className="half">
        <SectionHeading>by model</SectionHeading>
        <Table cols={sliceCols("model")} rows={mergeSlices(sums.map((s) => s.byModel))} keyOf={(r) => r.key} />
      </div>
      <div className="half">
        <SectionHeading>by client</SectionHeading>
        <Table cols={sliceCols("client")} rows={mergeSlices(sums.map((s) => s.byClient))} keyOf={(r) => r.key} />
      </div>
      <div className="half">
        <SectionHeading>by day</SectionHeading>
        <Table cols={aggCols("day")} rows={days} keyOf={(r) => r.key} />
      </div>
    </div>
  );
};
