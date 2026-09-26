import { useEffect, useMemo, useState } from "react";
import type { MetricsSlice, MetricsSummary, Window } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { get, via } from "../api";
import { type Col, Figs, Sec, Table } from "../components/basics";
import { ActivityGrid, Chart, hm, sliceHit } from "../components/charts";
import { hourBuckets, life, machines, sumActivity } from "../model/view";
import { useStore } from "../store";

const WINDOWS: Window[] = ["24h", "7d", "30d", "all"];
const SUMS = ["requests", "errors", "inputUncached", "cacheRead", "cacheWrite", "output", "cacheUnknownPrompt", "decodeTokens", "decodeMs", "promptTotal", "ttftSumMs", "ttftN"] as const;

const merge = (lists: MetricsSlice[][]): MetricsSlice[] => {
  const m = new Map<string, MetricsSlice>();
  for (const s of lists.flat()) {
    const a = m.get(s.key);
    if (!a) m.set(s.key, { ...s });
    else {
      for (const k of SUMS) a[k] = (a[k] ?? 0) + (s[k] ?? 0);
      a.decodeTps = a.decodeMs > 0 ? a.decodeTokens / (a.decodeMs / 1000) : null;
      a.meanTtftMs = a.ttftN > 0 ? a.ttftSumMs / a.ttftN : null;
    }
  }
  return [...m.values()].sort((a, b) => b.promptTotal + b.output - (a.promptTotal + a.output));
};

const cols = (h: string): Col<MetricsSlice>[] => [
  { h, c: (r) => <span className="ink">{r.key}</span> },
  { h: "requests", n: true, c: (r) => (r.errors ? <span><span className="alert">{`${r.errors} err `}</span>{fmt.k(r.requests)}</span> : fmt.k(r.requests)) },
  { h: "tokens", n: true, w: true, c: (r) => fmt.k(r.promptTotal + r.output) },
  { h: "cache", n: true, c: (r) => sliceHit(r) },
  { h: "tok/s", n: true, c: (r) => fmt.tps(r.decodeTps) },
  { h: "ttft", n: true, w: true, c: (r) => fmt.ms(r.meanTtftMs) },
];

export const UsagePage = () => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const stats = useStore((s) => s.stats);
  const now = useStore((s) => Math.floor(s.now / 60_000) * 60_000);
  const ms = useMemo(() => machines(fleet, live).filter((m) => m.online), [fleet, live]);
  const [win, setWin] = useState<Window>("7d");
  const [sums, setSums] = useState<MetricsSummary[]>([]);
  const ids = ms.map((m) => `${m.id}:${m.peerId ?? ""}`).join(",");
  useEffect(() => {
    let on = true;
    const load = async () => {
      const out = await Promise.all(ms.map((m) => get<MetricsSummary>(via(m.peerId, `/api/metrics/summary?window=${win}`))));
      if (on) setSums(out.flatMap((r) => (r.ok && typeof r.data?.requests === "number" ? [r.data] : [])));
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [ids, win]);
  const act = sumActivity(fleet);
  const t = (k: (typeof SUMS)[number]) => sums.reduce((a, s) => a + ((s as unknown as Record<string, number>)[k] ?? 0), 0);
  const b = hourBuckets(ms.flatMap((m) => stats[m.id]?.hourly ?? []), [], now);
  const labels: [string, string] = [hm(b[0]!.at), hm(b[23]!.at)];
  return (
    <>
      <div className="crumb">
        <span className="title">Usage</span>
        <span className="tabs right">
          {WINDOWS.map((w) => (
            <button type="button" key={w} className={w === win ? "on" : ""} onClick={() => setWin(w)}>
              {w}
            </button>
          ))}
        </span>
      </div>
      <Figs
        cells={[
          [fmt.k(t("requests")), "requests"],
          [fmt.k(t("promptTotal") + t("output")), "tokens"],
          [sums.length ? sliceHit({ cacheRead: t("cacheRead"), promptTotal: t("promptTotal"), cacheUnknownPrompt: t("cacheUnknownPrompt") }) : "–", "cache hit"],
          [fmt.tps(t("decodeMs") > 0 ? t("decodeTokens") / (t("decodeMs") / 1000) : null), "decode tok/s"],
          [fmt.k(t("errors")), "errors", t("errors") ? "alert" : ""],
        ]}
      />
      <div className="cols">
        <div>
          <Sec aside={<span className="label">{act?.since ? `since ${act.since}` : ""}</span>}>activity</Sec>
          {act && <ActivityGrid v={life(act)} />}
        </div>
        <div className="cols">
          <Chart title="tokens / h" aside={fmt.k(b.reduce((x, y) => x + y.fresh + y.cached + y.out, 0))} s={[b.map((x) => x.fresh + x.out), b.map((x) => x.cached)]} labels={labels} tips={b.map((x) => `${hm(x.at)}  in ${fmt.k(x.fresh)}  cached ${fmt.k(x.cached)}  out ${fmt.k(x.out)}`)} />
          <Chart title="requests / h" aside={fmt.k(b.reduce((x, y) => x + y.requests, 0))} s={[b.map((x) => x.requests)]} err={b.map((x) => x.errors)} labels={labels} tips={b.map((x) => `${hm(x.at)}  ${x.requests} req  ${x.errors} err`)} />
        </div>
      </div>
      <div className="cols">
        <div>
          <Sec>models</Sec>
          <Table cols={cols("model")} rows={merge(sums.map((s) => s.byModel))} keyOf={(r) => r.key} />
        </div>
        <div>
          <Sec>clients</Sec>
          <Table cols={cols("client")} rows={merge(sums.map((s) => s.byClient))} keyOf={(r) => r.key} />
        </div>
      </div>
    </>
  );
};
