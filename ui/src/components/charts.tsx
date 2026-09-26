import { useState } from "react";
import { fmt } from "@local-studio/contracts/client";
import type { LifeView } from "../model/view";
import { Sec } from "./basics";

export const Chart = ({ title, aside, s, err, labels, tips }: { title: string; aside: string; s: number[][]; err?: number[]; labels: [string, string]; tips: string[] }) => {
  const n = tips.length;
  const tot = tips.map((_, i) => s.reduce((t, x) => t + (x[i] ?? 0), 0));
  const top = Math.max(0, ...tot);
  const y = (x: number) => (top > 0 ? (x / top) * 58 : 0);
  return (
    <div className="min0">
      <Sec aside={<span className="ink">{aside}</span>}>{title}</Sec>
      <div className="chart">
        <svg viewBox={`0 0 ${n * 10} 60`} preserveAspectRatio="none" role="img" aria-label={title}>
          {tips.map((_, i) => {
            let acc = 0;
            return (
              <g key={i}>
                {s.map((x, k) => {
                  const v = x[i] ?? 0;
                  if (v <= 0) return null;
                  acc += v;
                  return <rect key={k} className={`s${k}`} x={i * 10 + 1.5} y={60 - y(acc)} width={7} height={y(v)} />;
                })}
                {err?.[i] ? <rect className="e" x={i * 10 + 1.5} y={60 - y(err[i]!)} width={7} height={y(err[i]!)} /> : null}
                <rect className="hit" x={i * 10} y={0} width={10} height={60}>
                  <title>{tips[i]}</title>
                </rect>
              </g>
            );
          })}
          <line x1={0} x2={n * 10} y1={59.5} y2={59.5} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="axis">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </div>
      </div>
    </div>
  );
};

const TTFT_EDGES = [0, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, Infinity];

export const TtftChart = ({ values, p50, p90 }: { values: number[]; p50: number | null | undefined; p90: number | null | undefined }) => {
  const counts = TTFT_EDGES.slice(0, -1).map((lo, i) => values.filter((v) => v >= lo && v < TTFT_EDGES[i + 1]!).length);
  const tips = counts.map((c, i) => `${fmt.ms(TTFT_EDGES[i]!)}–${Number.isFinite(TTFT_EDGES[i + 1]!) ? fmt.ms(TTFT_EDGES[i + 1]!) : ""}  ${c}`);
  return <Chart title="ttft" aside={`p50 ${fmt.ms(p50)} · p90 ${fmt.ms(p90)}`} s={[counts]} labels={["0", `${fmt.ms(TTFT_EDGES[TTFT_EDGES.length - 2]!)}+`]} tips={tips} />;
};

export const ActivityGrid = ({ v }: { v: LifeView }) => {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="life">
      <div className="cal" onMouseLeave={() => setHover(null)}>
        {v.cells.map((c, i) => (
          <i key={i} className={c < 0 ? "" : `l${c}`} title={c < 0 ? undefined : v.labels[i]} onMouseEnter={() => setHover(c < 0 ? null : i)} />
        ))}
      </div>
      <div className="months">
        {hover !== null ? (
          <span className="ink" style={{ left: 0 }}>
            {v.labels[hover]}
          </span>
        ) : (
          v.months.map((m) => (
            <span key={m.col} style={{ left: `calc((var(--cell) + 3px) * ${m.col})` }}>
              {m.label}
            </span>
          ))
        )}
      </div>
    </div>
  );
};

export const hitText = (read: number, total: number): string => {
  const p = fmt.cacheHitPercent(read, total);
  return p === null ? "–" : `${p}%`;
};

export const sliceHit = (s: { cacheRead: number; promptTotal: number; cacheUnknownPrompt?: number }): string => hitText(s.cacheRead, s.promptTotal - (s.cacheUnknownPrompt ?? 0));

export const hm = (t: number) => `${String(new Date(t).getHours()).padStart(2, "0")}:00`;
