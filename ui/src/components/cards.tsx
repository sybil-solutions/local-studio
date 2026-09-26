import { useState } from "react";
import type { Gpu, HourlyRow } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import type { Agg, CardView, LifeView, MachineView } from "../model/view";
import { gpuRow, hourBuckets } from "../model/view";
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
        <Btn kind="primary" href={`#/agents?model=${encodeURIComponent(c.servedModel ?? c.name)}`}>
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

export const vram = (a: Agg) => (a.memTotal <= 0 ? "–" : `${a.memUsed !== null ? `${Math.round(a.memUsed / 1024)}/` : ""}${Math.round(a.memTotal / 1024)}G`);

const tokensOf = (s: MachineStats["sum"]) => (s ? s.inputUncached + s.cacheRead + s.cacheWrite + s.cacheUnknownPrompt + s.output : null);

export const MachineTile = ({ m, a, st, on }: { m: MachineView; a: Agg; st: MachineStats | undefined; on: boolean }) => (
  <a className={`cell surface${on ? " on" : ""}`} href={`#/control/${encodeURIComponent(m.id)}`}>
    <span className="name">
      <BarMark mark={m.online ? m.mark : "failed"} />
      <span className="ellipsis">{m.name}</span>
      {!m.online && <span className="badge alert">offline</span>}
      {m.watchdogs.length > 0 && <span className="badge">watchdog</span>}
    </span>
    <span className="label ellipsis">{m.online ? m.gpuSummary : (m.error ?? "–")}</span>
    <dl className="kv two">
      <dt>vram</dt>
      <dd>{vram(a)}</dd>
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
    <span className="ellipsis">{a.models.join(", ") || "–"}</span>
  </a>
);

export interface Figure {
  v: string;
  k: string;
}

export const FigureGrid = ({ cells }: { cells: Figure[] }) => (
  <div className="figs">
    {cells.map((c) => (
      <div key={c.k}>
        <span className="fig">{c.v}</span>
        <span className="label">{c.k}</span>
      </div>
    ))}
  </div>
);

export const Chart = ({ title, v, err, f, labels }: { title: string; v: (number | null)[]; err?: number[]; f: (n: number) => string; labels: string[] }) => {
  const top = Math.max(0, ...v.map((x) => x ?? 0));
  const last = [...v].reverse().find((x) => x !== null && x > 0) ?? null;
  const w = v.length * 10;
  const y = (x: number) => (top > 0 ? (x / top) * 58 : 0);
  return (
    <div className="quarter chart">
      <div className="sec" style={{ padding: 0 }}>
        {title.toUpperCase()}
        <span className="aside ink">{last === null ? "–" : f(last)}</span>
      </div>
      <svg viewBox={`0 0 ${w} 60`} preserveAspectRatio="none" role="img" aria-label={title}>
        {v.map((x, i) =>
          x ? (
            <g key={i}>
              <rect x={i * 10 + 1} y={60 - y(x)} width={8} height={y(x)}>
                <title>{`${labels[i]}  ${f(x)}`}</title>
              </rect>
              {err?.[i] ? <rect className="e" x={i * 10 + 1} y={60 - y(err[i]!)} width={8} height={y(err[i]!)} /> : null}
            </g>
          ) : null,
        )}
        <line x1={0} x2={w} y1={59.5} y2={59.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="axis">
        <span>{labels[0]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
};

const hh = (t: number) => `${String(new Date(t).getHours()).padStart(2, "0")}:00`;

export const HourCharts = ({ rows, now }: { rows: HourlyRow[]; now: number }) => {
  const b = hourBuckets(rows, now);
  const labels = b.map((x) => hh(x.at));
  return (
    <>
      <Chart title="tokens / h" v={b.map((x) => x.tokens)} f={fmt.k} labels={labels} />
      <Chart title="requests / h" v={b.map((x) => x.requests)} err={b.map((x) => x.errors)} f={fmt.k} labels={labels} />
      <Chart title="decode tok/s" v={b.map((x) => (x.decodeMs > 0 ? x.decodeTokens / (x.decodeMs / 1000) : null))} f={fmt.tps} labels={labels} />
      <Chart title="ttft" v={b.map((x) => (x.ttftN ? x.ttftSumMs / x.ttftN : null))} f={fmt.ms} labels={labels} />
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
