import { useEffect, useMemo, useState } from "react";
import type { DailyRow, GpuSample, HourlyRow, MetricsSummary, RequestRecord, Window } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { get, via } from "../api";
import { Err } from "../components/basics";
import { ActivityGrid, sliceHit } from "../components/cards";
import { H, Meter, Row, Sum, Tabs } from "../components/panel";
import { life, machines, type MachineView, sumActivity } from "../model/view";
import { useStore } from "../store";

const WINDOWS = ["24h", "7d", "30d", "all"] as const;
const BYS = ["model", "client", "machine"] as const;
const DAYS: Record<Window, number> = { "1h": 1, "24h": 1, "7d": 7, "30d": 30, all: 3650 };
const GPU_KEEP_DAYS = 7;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface Data {
  m: MachineView;
  sum: MetricsSummary | null;
  daily: DailyRow[];
  gpus: GpuSample[] | null;
  reqs: RequestRecord[];
}

type Tok = { inputUncached: number; cacheRead: number; cacheWrite: number; output: number; cacheUnknownPrompt: number };
const tin = (r: Tok) => r.inputUncached + r.cacheWrite + r.cacheUnknownPrompt;
const tall = (r: Tok) => tin(r) + r.cacheRead + r.output;
const kwh = (s: GpuSample[]) => s.reduce((t, x) => t + (x.powerW ?? 0) / 60, 0) / 1000;

const Stacked = ({ cols }: { cols: { label: string; v: [number, number, number] }[] }) => {
  const top = Math.max(1, ...cols.map((c) => c.v[0] + c.v[1] + c.v[2]));
  const w = 100 / Math.max(1, cols.length);
  const H_ = 70;
  return (
    <>
      <svg className="p-stack" viewBox={`0 0 100 ${H_}`} preserveAspectRatio="none" role="img" aria-label="tokens">
        {cols.map((c, i) => {
          let y = H_;
          return (
            <g key={i}>
              {c.v.map((v, k) => {
                const h = (v / top) * (H_ - 2);
                y -= h;
                return <rect key={k} className={`s${k}`} x={i * w + w * 0.12} y={y} width={w * 0.76} height={h} />;
              })}
              <rect className="hit" x={i * w} y={0} width={w} height={H_}>
                <title>{`${c.label} · in ${fmt.k(c.v[0])} · cached ${fmt.k(c.v[1])} · out ${fmt.k(c.v[2])}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="p-axis label">
        <span>{cols[0]?.label ?? ""}</span>
        <span>{cols[cols.length - 1]?.label ?? ""}</span>
      </div>
      <div className="p-legend label">
        <span>
          <i className="s0" />
          in
        </span>
        <span>
          <i className="s1" />
          cached
        </span>
        <span>
          <i className="s2" />
          out
        </span>
      </div>
    </>
  );
};

const concurrency = (reqs: RequestRecord[]) => {
  const done = reqs.filter((r) => r.decodeTps !== null && r.tsFirstToken !== null && !r.errorCode);
  const byModel = new Map<string, number>();
  for (const r of done) byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1);
  const model = [...byModel].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!model) return null;
  const rs = done.filter((r) => r.model === model);
  const all = reqs.filter((r) => r.model === model);
  const B: [string, number, number][] = [["1", 1, 1], ["2", 2, 2], ["3–4", 3, 4], ["5–8", 5, 8], ["9+", 9, 1e9]];
  const rows = B.map(([label, lo, hi]) => {
    const xs = rs
      .map((r) => {
        const mid = (r.tsFirstToken! + r.tsEnd) / 2;
        return { tps: r.decodeTps!, n: all.filter((o) => o.tsStart <= mid && o.tsEnd >= mid).length };
      })
      .filter((x) => x.n >= lo && x.n <= hi);
    const tps = xs.map((x) => x.tps).sort((a, b) => a - b);
    const per = tps.length ? tps[Math.floor(tps.length / 2)]! : null;
    const avgN = xs.length ? xs.reduce((t, x) => t + x.n, 0) / xs.length : 0;
    return { label, samples: xs.length, per, total: per === null ? null : per * avgN };
  }).filter((r) => r.samples >= 3);
  return rows.length ? { model, rows, n: rs.length } : null;
};

export const UsagePage = () => {
  const fleet = useStore((s) => s.fleet);
  const launches = useStore((s) => s.launches);
  const stats = useStore((s) => s.stats);
  const error = useStore((s) => s.error);
  const ms = useMemo(() => machines(fleet, launches).filter((m) => m.online), [fleet, launches]);
  const [win, setWin] = useState<(typeof WINDOWS)[number]>("24h");
  const [by, setBy] = useState<(typeof BYS)[number]>("model");
  const [data, setData] = useState<Data[]>([]);
  const ids = ms.map((m) => `${m.id}:${m.peerId ?? ""}`).join(",");

  useEffect(() => {
    let on = true;
    const load = async () => {
      const from = new Date();
      from.setDate(from.getDate() - (DAYS[win] - 1));
      const to = new Date();
      to.setDate(to.getDate() + 1);
      const since = win === "24h" ? Date.now() - 86_400_000 : from.setHours(0, 0, 0, 0);
      const out = await Promise.all(
        ms.map(async (m): Promise<Data> => {
          const [s, d, g, q] = await Promise.all([
            get<MetricsSummary>(via(m.peerId, `/api/metrics/summary?window=${win}`)),
            get<DailyRow[]>(via(m.peerId, `/api/usage/daily?from=${win === "all" ? "0000-01-01" : ymd(from)}&to=${ymd(to)}&group=model,client`)),
            DAYS[win] <= GPU_KEEP_DAYS ? get<GpuSample[]>(via(m.peerId, `/api/metrics/gpus?from=${since}`)) : Promise.resolve({ ok: false as const }),
            get<RequestRecord[]>(via(m.peerId, "/api/metrics/requests?limit=500")),
          ]);
          return {
            m,
            sum: s.ok && typeof s.data?.requests === "number" ? s.data : null,
            daily: d.ok && Array.isArray(d.data) ? d.data : [],
            gpus: g.ok && Array.isArray(g.data) ? g.data : null,
            reqs: q.ok && Array.isArray(q.data) ? q.data.filter((r) => r.via === "local") : [],
          };
        }),
      );
      if (on) setData(out);
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [ids, win]);

  if (!fleet) return <Err>{error ?? "connecting"}</Err>;
  const rows = data.flatMap((d) => d.daily);
  const sums = data.map((d) => d.sum).filter((x): x is MetricsSummary => !!x);
  const tot = sums.reduce((t, r) => ({ inputUncached: t.inputUncached + r.inputUncached, cacheRead: t.cacheRead + r.cacheRead, cacheWrite: t.cacheWrite + r.cacheWrite, output: t.output + r.output, cacheUnknownPrompt: t.cacheUnknownPrompt + r.cacheUnknownPrompt }), { inputUncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, cacheUnknownPrompt: 0 });
  const requests = data.reduce((t, d) => t + (d.sum?.requests ?? 0), 0);
  const energy = data.every((d) => d.gpus === null) ? null : data.reduce((t, d) => t + (d.gpus ? kwh(d.gpus) : 0), 0);
  const tokens = tall(tot);
  const hourly: HourlyRow[] = ms.flatMap((m) => stats[m.id]?.hourly ?? []);

  const cols = (() => {
    if (win === "24h") {
      const start = Math.floor(Date.now() / 3_600_000) * 3_600_000 - 23 * 3_600_000;
      return Array.from({ length: 24 }, (_, i) => {
        const at = start + i * 3_600_000;
        const hs = hourly.filter((h) => h.hour === at);
        return { label: `${String(new Date(at).getHours()).padStart(2, "0")}:00`, v: [hs.reduce((t, h) => t + tin(h), 0), hs.reduce((t, h) => t + h.cacheRead, 0), hs.reduce((t, h) => t + h.output, 0)] as [number, number, number] };
      });
    }
    const days = [...new Set(rows.map((r) => r.day))].sort();
    const first = win === "all" ? days[0] : undefined;
    const n = win === "all" && first ? Math.ceil((Date.now() - new Date(first).getTime()) / 86_400_000) + 1 : DAYS[win];
    const step = n > 60 ? 7 : 1;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (n - 1));
    return Array.from({ length: Math.ceil(n / step) }, (_, i) => {
      const a = new Date(start);
      a.setDate(a.getDate() + i * step);
      const b = new Date(a);
      b.setDate(b.getDate() + step);
      const rs = rows.filter((r) => r.day >= ymd(a) && r.day < ymd(b));
      return { label: `${a.toLocaleString("en", { month: "short" })} ${a.getDate()}`, v: [rs.reduce((t, r) => t + tin(r), 0), rs.reduce((t, r) => t + r.cacheRead, 0), rs.reduce((t, r) => t + r.output, 0)] as [number, number, number] };
    });
  })();

  const breakdown = (() => {
    const m = new Map<string, { tok: number; req: number; dt: number; dm: number }>();
    const add = (k: string, x: Tok & { requests: number; decodeTokens: number; decodeMs: number }) => {
      const a = m.get(k) ?? { tok: 0, req: 0, dt: 0, dm: 0 };
      a.tok += tall(x);
      a.req += x.requests;
      a.dt += x.decodeTokens;
      a.dm += x.decodeMs;
      m.set(k, a);
    };
    for (const d of data) {
      if (!d.sum) continue;
      if (by === "machine") add(d.m.name, d.sum);
      else for (const x of by === "model" ? d.sum.byModel : d.sum.byClient) add(x.key, x);
    }
    return [...m].sort((a, b) => b[1].tok - a[1].tok);
  })();
  const conc = concurrency(data.flatMap((d) => d.reqs));
  const act = sumActivity(fleet);
  const machineTokens = (d: Data) => (d.sum ? tall(d.sum) : 0);

  return (
    <div className="panel">
      <div className="p-win">
        <Tabs items={WINDOWS} on={win} set={setWin} />
      </div>
      <Sum
        cells={[
          { v: fmt.k(tokens), k: "tokens" },
          { v: fmt.k(requests), k: "requests" },
          { v: sliceHit({ cacheRead: tot.cacheRead, promptTotal: tot.inputUncached + tot.cacheRead + tot.cacheWrite + tot.cacheUnknownPrompt, cacheUnknownPrompt: tot.cacheUnknownPrompt }), k: "cache hit" },
          { v: energy === null ? "–" : `${energy.toFixed(1)} kWh`, k: "gpu energy" },
          { v: energy && tokens ? `${((energy * 3.6e6) / tokens).toFixed(2)} J` : "–", k: "per token" },
        ]}
      />
      <H aside="hover a bar">tokens</H>
      <Stacked cols={cols} />
      <H aside={<Tabs items={BYS} on={by} set={setBy} />}>by</H>
      <div className="p-brow label">
        <span>{by}</span>
        <span />
        <span className="n">share</span>
        <span className="n">requests</span>
        <span className="n">decode</span>
      </div>
      {breakdown.map(([k, a]) => (
        <div key={k} className="p-brow">
          <span className="ink ellipsis">{k}</span>
          <Meter pct={tokens ? (a.tok / tokens) * 100 : 0} />
          <span className="n">{tokens ? fmt.pct(a.tok / tokens) : "–"}</span>
          <span className="n">{fmt.k(a.req)}</span>
          <span className="n">{fmt.tps(a.dm > 0 ? a.dt / (a.dm / 1000) : null)}</span>
        </div>
      ))}
      {conc && (
        <>
          <H aside={`${conc.model} · per request · total · last ${conc.n} requests`}>decode by concurrency</H>
          {conc.rows.map((r) => (
            <div key={r.label} className="p-brow">
              <span className="ink">{`${r.label} in flight`}</span>
              <Meter pct={r.total !== null ? (r.total / Math.max(...conc.rows.map((x) => x.total ?? 0))) * 100 : 0} />
              <span className="n ink">{fmt.tps(r.per)}</span>
              <span className="n">{fmt.tps(r.total)}</span>
              <span className="n label">{`${r.samples} req`}</span>
            </div>
          ))}
        </>
      )}
      <H aside="p50 · p90 · p99">time to first token</H>
      {data.filter((d) => d.sum && d.sum.requests > 0).map((d) => (
        <div key={d.m.id} className="p-brow">
          <span className="ink">{d.m.name}</span>
          <span />
          <span className="n">{fmt.ms(d.sum!.ttftMs.p50)}</span>
          <span className="n">{fmt.ms(d.sum!.ttftMs.p90)}</span>
          <span className="n">{fmt.ms(d.sum!.ttftMs.p99)}</span>
        </div>
      ))}
      <H aside={DAYS[win] <= GPU_KEEP_DAYS ? "now · window · per token" : `now · gpu power is kept ${GPU_KEEP_DAYS} days`}>energy</H>
      {data.map((d) => {
        const now = (d.m.snap?.gpus ?? []).map((g) => g.powerW).filter((x): x is number => x !== null);
        const e = d.gpus ? kwh(d.gpus) : null;
        const t = machineTokens(d);
        return (
          <div key={d.m.id} className="p-brow">
            <span className="ink">{d.m.name}</span>
            <span />
            <span className="n">{now.length ? `${Math.round(now.reduce((a, b) => a + b, 0))} W` : "–"}</span>
            <span className="n">{e === null ? "–" : `${e.toFixed(1)} kWh`}</span>
            <span className="n label">{e && t ? `${((e * 3.6e6) / t).toFixed(2)} J` : "–"}</span>
          </div>
        );
      })}
      {act && (
        <>
          <H>activity</H>
          <ActivityGrid v={life(act)} />
        </>
      )}
      {!requests && <Row>–</Row>}
    </div>
  );
};
