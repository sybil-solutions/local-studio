import { type ReactNode, useState } from "react";
import type { Gpu, GpuSample, HourlyRow, TtftHour } from "@local-studio/contracts/client";
import { fmt, histPercentile } from "@local-studio/contracts/client";
import type { Agg, BreakBy, CardView, LifeView, MachineRes, MachineView } from "../model/view";
import { gpuRow, hourBuckets, resText } from "../model/view";
import type { MachineStats } from "../store";
import { BarMark, Btn, Chips, Logo, Table } from "./basics";

export const TokenLine = ({ values, h }: { values: number[]; h: number }) => {
  const n = values.length;
  const top = Math.max(1, ...values);
  if (n < 2 || top <= 1) return null;
  const pts = values.map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${(h - 4 - (v / top) * (h * 0.8)).toFixed(2)}`);
  return (
    <svg className="line" viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`${pts.join(" ")} 100,${h} 0,${h}`} fill="rgba(var(--fg-rgb),0.06)" />
      <polyline points={pts.join(" ")} fill="none" stroke="rgba(var(--fg-rgb),0.25)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export const Spark = ({ v }: { v: number[] }) =>
  v.length < 2 ? null : (
    <svg className="spark" viewBox="0 0 90 14" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={v.map((x, i) => `${(i * 90) / (v.length - 1)},${13 - (Math.min(100, x) / 100) * 12}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );

export const Bar = ({ pct }: { pct: number | null }) => (
  <span className="bar">
    <i style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
  </span>
);

export const ActivityGrid = ({ v }: { v: LifeView }) => {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="life">
      <div className="life-head">
        <span className="ink">{v.tokens}</span>
        <span className="label">{v.requests}</span>
        <span className="right" style={hover !== null ? { color: "var(--ink)" } : undefined}>
          {hover !== null ? v.labels[hover] : v.since}
        </span>
      </div>
      <div className="cal" onMouseLeave={() => setHover(null)}>
        {v.cells.map((c, i) => (
          <i key={i} className={c < 0 ? "fut" : `l${c}`} title={c < 0 ? undefined : v.labels[i]} onMouseEnter={() => setHover(c < 0 ? null : i)} />
        ))}
      </div>
      <div className="months">
        {v.months.map((m) => (
          <span key={m.col} style={{ left: `calc((100% - var(--cell, 15px)) * ${m.col} / 19)` }}>
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
};

export const ModelCard = ({ c, onStop, onCancel, onExport }: { c: CardView; onStop: (c: CardView) => void; onCancel: (c: CardView) => void; onExport: (c: CardView) => void }) => (
  <div className="cell surface run glow">
    <TokenLine values={c.line} h={156} />
    <div className="name">
      <Logo family={c.family} />
      <span className="ellipsis">{c.name}</span>
    </div>
    <div className="row-flex">
      <span className="label ellipsis">{c.machine}</span>
      <span className="label ellipsis">{c.gpu}</span>
      {c.mem && <span className="label">{c.mem}</span>}
    </div>
    {c.stack && (
      <span title={c.stackFrom ?? undefined}>
        {c.stack}
      </span>
    )}
    <Chips chips={c.chips} className="label" />
    {!c.ready && (
      <div>
        <div className={c.subAlert ? "alert" : ""}>{c.sub}</div>
        {c.progress !== null && (
          <div className="progress">
            <div style={{ width: `${Math.max(0, Math.min(100, c.progress))}%` }} />
          </div>
        )}
      </div>
    )}
    <div className="foot btns">
      {c.ready && !c.embedding && (
        <Btn kind="primary" href={`#/control?model=${encodeURIComponent(c.servedModel ?? c.name)}`}>
          Agent ›
        </Btn>
      )}
      {c.modelId && <Btn onClick={() => onExport(c)}>Export</Btn>}
      {c.modelId ? (
        <Btn kind="danger" onClick={() => onStop(c)} disabled={c.readOnly || !!c.stopBlocked}>
          Stop
        </Btn>
      ) : c.launchId ? (
        <Btn kind="danger" onClick={() => onCancel(c)} disabled={c.readOnly}>
          Stop
        </Btn>
      ) : null}
    </div>
  </div>
);


const tokensOf = (s: MachineStats["sum"]) => (s ? s.inputUncached + s.cacheRead + s.cacheWrite + s.output : null);

export const MachineTile = ({ m, a, st, on, res }: { m: MachineView; a: Agg; st: MachineStats | undefined; on: boolean; res: MachineRes }) => (
  <a className={`cell surface${on ? " on" : ""}`} href={`#/control/${encodeURIComponent(m.id)}`}>
    <span className="name">
      <BarMark mark={m.online ? m.mark : "failed"} />
      <span className="ellipsis">{m.name}</span>
      {!m.online && <span className="badge alert">offline</span>}
      {m.watchdogs.length > 0 && <span className="badge">watchdog</span>}
    </span>
    <span className="label ellipsis">{m.online ? m.gpuSummary : (m.error ?? "–")}</span>
    <dl className="kv two">
      <dt>gpus</dt>
      <dd>{a.gpus}</dd>
      <dt>util</dt>
      <dd>{a.util === null ? "–" : `${Math.round(a.util)}%`}</dd>
      <dt>power</dt>
      <dd>{a.powerW === null ? "–" : `${Math.round(a.powerW)} W`}</dd>
      <dt>tok/s</dt>
      <dd>{fmt.tps(a.tps)}</dd>
      <dt>req</dt>
      <dd>{fmt.k(st?.sum?.requests)}</dd>
      <dt>tokens</dt>
      <dd>{fmt.k(tokensOf(st?.sum ?? null))}</dd>
      <dt>errors</dt>
      <dd className={st?.sum?.errors ? "alert" : ""}>{fmt.k(st?.sum?.errors)}</dd>
      <dt>ttft</dt>
      <dd>{fmt.ms(st?.sum?.ttftMs.p50)}</dd>
    </dl>
    <dl className="kv">
      {res.vram && (
        <>
          <dt>vram free</dt>
          <dd>{resText(res.vram)}</dd>
        </>
      )}
      <dt>{res.unified ? "mem free" : "ram free"}</dt>
      <dd>{`${resText(res.ram)}${res.unified ? " unified" : ""}`}</dd>
      <dt>disk free</dt>
      <dd>{resText(res.disk)}</dd>
    </dl>
    <span className="ellipsis">{a.models.join(", ") || "–"}</span>
  </a>
);

export interface Figure {
  v: string;
  k: string;
}

export const FigureGrid = ({ cells, className = "" }: { cells: Figure[]; className?: string }) => (
  <div className={className ? `figs ${className}` : "figs"}>
    {cells.map((c) => (
      <div key={c.k}>
        <span className="fig">{c.v}</span>
        <span className="label">{c.k}</span>
      </div>
    ))}
  </div>
);

type Series = { name: string; v: (number | null)[] };

export const Chart = ({ title, s, f, labels, err, line, head }: { title: string; s: Series[]; f: (n: number) => string; labels: string[]; err?: number[]; line?: boolean; head?: ReactNode }) => {
  const w = labels.length * 10;
  const tot = labels.map((_, i) => (line ? Math.max(0, ...s.map((x) => x.v[i] ?? 0)) : s.reduce((t, x) => t + (x.v[i] ?? 0), 0)));
  const top = Math.max(0, ...tot);
  const y = (x: number) => (top > 0 ? (x / top) * 58 : 0);
  const val = (x: number | null | undefined) => (x === null || x === undefined ? "–" : f(x));
  const li = tot.findLastIndex((x) => x > 0);
  const aside = li < 0 ? "–" : line ? s.map((x) => val(x.v[li])).join(" · ") : f(tot[li]!);
  const tip = (i: number) => [labels[i], ...s.map((x) => `${s.length > 1 ? `${x.name} ` : ""}${val(x.v[i])}`), ...(err?.[i] ? [`errors ${err[i]}`] : [])].join("  ");
  return (
    <div className="quarter chart">
      <div className="sec" style={{ padding: 0 }}>
        {title.toUpperCase()}
        <span className="aside ink">{head ?? aside}</span>
      </div>
      <svg viewBox={`0 0 ${w} 60`} preserveAspectRatio="none" role="img" aria-label={title}>
        {line
          ? s.map((x, k) => (
              <polyline key={k} className={`s${k}`} points={x.v.flatMap((v, i) => (v === null ? [] : [`${i * 10 + 5},${60 - y(v)}`])).join(" ")} vectorEffect="non-scaling-stroke" />
            ))
          : labels.map((_, i) => {
              let acc = 0;
              return (
                <g key={i}>
                  {s.map((x, k) => {
                    const v = x.v[i] ?? 0;
                    if (v <= 0) return null;
                    acc += v;
                    return <rect key={k} className={`s${k}`} x={i * 10 + 1} y={60 - y(acc)} width={8} height={y(v)} />;
                  })}
                  {err?.[i] ? <rect className="e" x={i * 10 + 1} y={60 - y(err[i]!)} width={8} height={y(err[i]!)} /> : null}
                </g>
              );
            })}
        {labels.map((_, i) => (
          <rect key={`h${i}`} className="hit" x={i * 10} y={0} width={10} height={60}>
            <title>{tip(i)}</title>
          </rect>
        ))}
        <line x1={0} x2={w} y1={59.5} y2={59.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="axis">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
      {s.length > 1 && (
        <div className="legend">
          {s.map((x, k) => (
            <span key={k} className="ellipsis">
              <i className={`s${k}`} />
              {x.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const hm = (t: number, min = false) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${min ? String(d.getMinutes()).padStart(2, "0") : "00"}`;
};
const rate = (t: number, ms: number) => (ms > 0 ? t / (ms / 1000) : null);
const BY: BreakBy[] = ["model", "machine", "client"];

export const HourCharts = ({ rows, ttft, now, full, names }: { rows: HourlyRow[]; ttft: TtftHour[]; now: number; full?: boolean; names?: Record<string, string> }) => {
  const [by, setBy] = useState<BreakBy>("model");
  const b = hourBuckets(rows, ttft, now, by, names);
  const labels = b.map((x) => hm(x.at));
  const q = (p: number): Series => ({ name: `p${Math.round(p * 100)}`, v: b.map((x) => histPercentile(x.hist, p)) });
  const totals = new Map<string, number>();
  for (const x of b) for (const [k, e] of Object.entries(x.by)) totals.set(k, (totals.get(k) ?? 0) + e.tokens);
  const keys = [...totals].sort((x, y) => y[1] - x[1]).map(([k]) => k);
  const top = keys.slice(0, 3);
  const split = (m: "tokens" | "requests"): Series[] => [
    ...top.map((k) => ({ name: k, v: b.map((x) => x.by[k]?.[m] ?? 0) })),
    ...(keys.length > 3 ? [{ name: "other", v: b.map((x) => Object.entries(x.by).reduce((t, [k, e]) => t + (top.includes(k) ? 0 : e[m]), 0)) }] : []),
  ];
  const pick = (
    <span className="row-flex">
      {BY.map((k) => (
        <span key={k} className={`link ${k === by ? "ink" : "label"}`} onClick={() => setBy(k)}>
          {k}
        </span>
      ))}
    </span>
  );
  return (
    <>
      <Chart title="tokens / h" s={[{ name: "in", v: b.map((x) => x.fresh) }, { name: "cached", v: b.map((x) => x.cached) }, { name: "out", v: b.map((x) => x.out) }]} f={fmt.k} labels={labels} />
      <Chart title="requests / min" s={[{ name: "requests", v: b.map((x) => x.requests / 60) }]} err={b.map((x) => x.errors / 60)} f={(n) => n.toFixed(n < 10 ? 2 : 0)} labels={labels} />
      <Chart title="decode tok/s" s={[{ name: "decode", v: b.map((x) => rate(x.decodeTokens, x.decodeMs)) }]} f={fmt.tps} labels={labels} />
      <Chart title="ttft" line s={full ? [q(0.5), q(0.95), q(0.99)] : [q(0.5), q(0.95)]} f={fmt.ms} labels={labels} />
      {full && (
        <>
          <Chart title="prefill tok/s" s={[{ name: "prefill", v: b.map((x) => rate(x.prefillTokens, x.prefillMs)) }]} f={fmt.tps} labels={labels} />
          <Chart title="cache hit" line s={[{ name: "hit", v: b.map((x) => (x.known > 0 ? (x.cached / x.known) * 100 : null)) }]} f={(n) => `${Math.round(n)}%`} labels={labels} />
          <Chart title="tokens by" head={pick} s={split("tokens")} f={fmt.k} labels={labels} />
          <Chart title="requests by" head={pick} s={split("requests")} f={fmt.k} labels={labels} />
        </>
      )}
    </>
  );
};

export const GpuCharts = ({ samples, now }: { samples: GpuSample[][]; now: number }) => {
  const STEP = 600_000;
  const start = Math.floor(now / STEP) * STEP - 143 * STEP;
  const per = samples.map((list) => {
    const m = new Map<number, GpuSample>();
    for (const x of list) m.set(Math.floor((x.ts - start) / STEP), x);
    return m;
  });
  const idx = Array.from({ length: 144 }, (_, i) => i);
  const col = (f: (xs: GpuSample[]) => number | null) =>
    idx.map((i) => {
      const xs = per.map((m) => m.get(i)).filter((x): x is GpuSample => !!x);
      return xs.length ? f(xs) : null;
    });
  const sum = (k: "memUsedMiB" | "powerW") => (xs: GpuSample[]) => (xs.every((x) => x[k] === null) ? null : xs.reduce((t, x) => t + (x[k] ?? 0), 0));
  const labels = idx.map((i) => hm(start + i * STEP, true));
  const known = (xs: GpuSample[], k: "utilPct" | "tempC") => xs.map((x) => x[k]).filter((v): v is number => v !== null);
  return (
    <>
      <Chart title="gpu util" line s={[{ name: "util", v: col((xs) => (known(xs, "utilPct").length ? known(xs, "utilPct").reduce((t, v) => t + v, 0) / known(xs, "utilPct").length : null)) }]} f={(n) => `${Math.round(n)}%`} labels={labels} />
      <Chart title="vram used" line s={[{ name: "vram", v: col(sum("memUsedMiB")) }]} f={(n) => `${(n / 1024).toFixed(0)}G`} labels={labels} />
      <Chart title="power" line s={[{ name: "power", v: col(sum("powerW")) }]} f={(n) => `${Math.round(n)} W`} labels={labels} />
      <Chart title="temp max" line s={[{ name: "temp", v: col((xs) => (known(xs, "tempC").length ? Math.max(...known(xs, "tempC")) : null)) }]} f={(n) => `${Math.round(n)} C`} labels={labels} />
    </>
  );
};

export const GpuTable = ({ ms, hist }: { ms: MachineView[]; hist?: Record<string, number[]> }) => {
  const rows = ms.flatMap((m) => (m.snap?.gpus ?? []).map((g: Gpu) => ({ m, g, r: gpuRow(g, m.snap) })));
  return (
    <Table
      cols={[
        ...(ms.length > 1 ? [{ h: "machine", c: (x: (typeof rows)[number]) => x.m.name }] : []),
        { h: "gpu", c: (x) => x.r.name },
        { h: "util", n: true, c: (x) => (x.g.utilPct === null ? "–" : `${Math.round(x.g.utilPct)}%`) },
        ...(hist ? [{ h: "history", c: (x: (typeof rows)[number]) => <Spark v={hist[`${x.m.id}/${x.g.key}`] ?? []} /> }] : []),
        { h: "memory", c: (x) => <span className="row-flex"><Bar pct={x.r.pct} />{x.r.mem}</span> },
        { h: "power", n: true, c: (x) => (x.g.powerW === null ? "–" : `${Math.round(x.g.powerW)}${x.g.powerLimitW ? `/${Math.round(x.g.powerLimitW)}` : ""} W`) },
        { h: "temp", n: true, c: (x) => x.r.temp || "–" },
        { h: "holds", c: (x) => <span className={`cut ${x.r.statusAlert ? "alert" : ""}`}>{x.r.status || "–"}</span> },
      ]}
      rows={rows}
      keyOf={(x) => `${x.m.id}/${x.g.key}`}
    />
  );
};

export const hitText = (read: number, total: number): string => {
  const p = fmt.cacheHitPercent(read, total);
  return p === null ? "–" : `${p}%`;
};

export const sliceHit = (s: { cacheRead: number; promptTotal: number; cacheUnknownPrompt?: number }): string => hitText(s.cacheRead, s.promptTotal - (s.cacheUnknownPrompt ?? 0));
