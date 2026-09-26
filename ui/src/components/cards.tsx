import { useState } from "react";
import { fmt } from "@local-studio/contracts/client";
import type { CardView, GpuRowView, LifeView, MachineView } from "../model/view";
import { BarMark, Btn, Chips, Logo } from "./basics";

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
          <i
            key={i}
            className={c < 0 ? "fut" : `l${c}`}
            title={c < 0 ? undefined : v.labels[i]}
            onMouseEnter={() => setHover(c < 0 ? null : i)}
          />
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
  <div className="run glow">
    <TokenLine values={c.line} h={156} />
    <div className="body">
      <div className="name">
        <Logo family={c.family} />
        <span className="ellipsis">{c.name}</span>
      </div>
      <div className="row-flex">
        <span className="label ellipsis">{c.gpu}</span>
        {c.mem && <span className="dim">{c.mem}</span>}
      </div>
      <Chips chips={c.chips} className="label small" />
      {!c.ready && (
        <div>
          <div className={c.subAlert ? "alert" : "value"}>{c.sub}</div>
          {c.progress !== null && (
            <div className="progress">
              <div style={{ width: `${Math.max(0, Math.min(100, c.progress))}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
    <div className="foot btns">
      {c.ready && !c.embedding && (
        <Btn kind="primary" href={`#/agents?model=${encodeURIComponent(c.servedModel ?? c.name)}`}>
          Agent ›
        </Btn>
      )}
      {c.modelId && <Btn onClick={() => onExport(c)}>Export</Btn>}
      {c.modelId ? (
        <Btn kind="danger" onClick={() => onStop(c)} disabled={c.readOnly || !!c.stopBlocked} title={c.readOnly ? "read-only controller" : c.stopBlocked ?? undefined}>
          Stop
        </Btn>
      ) : c.launchId ? (
        <Btn kind="danger" onClick={() => onCancel(c)} disabled={c.readOnly} title={c.readOnly ? "read-only controller" : "cancel this launch"}>
          Stop
        </Btn>
      ) : null}
    </div>
  </div>
);

export const MachinesStrip = ({ ms, on, href }: { ms: MachineView[]; on: string | null; href: (id: string) => string }) => (
  <div className="mstrip">
    {ms.map((m) => (
      <a className={`mcell${m.id === on ? " on" : ""}`} key={m.id} href={href(m.id)}>
        <span className="name">
          <BarMark mark={m.online ? m.mark : "failed"} />
          {m.name}
          {m.self && <span className="label small">this</span>}
        </span>
        <span className="label small ellipsis">{m.online ? m.gpuSummary : m.error ?? "offline"}</span>
        <span className="row-flex wrap" style={{ gap: 4 }}>
          {!m.online && <span className="badge alert">offline</span>}
          {m.readOnly && <span className="badge">read-only</span>}
          {m.watchdogs.length > 0 && <span className="badge" title={m.watchdogs.join(", ")}>watchdog</span>}
        </span>
      </a>
    ))}
  </div>
);

export const GpuRow = ({ g, wide }: { g: GpuRowView; wide?: boolean }) => (
  <div className={`gpu${g.status ? " tall" : ""}${wide ? " wide" : ""}`}>
    <span className="nm">
      <span className="value ellipsis">{g.name}</span>
      {g.status && <span className={`small ${g.statusAlert ? "alert" : "label"} ellipsis`}>{g.status}</span>}
    </span>
    {g.pct !== null ? (
      <span className="bar">
        <div style={{ width: `${g.pct}%` }} />
      </span>
    ) : (
      <span className="grow" />
    )}
    <span className="rt">{g.right}</span>
  </div>
);

export interface Figure {
  v: string;
  k: string;
}

export const FigureGrid = ({ cells }: { cells: Figure[] }) => (
  <div className="grid6">
    {cells.map((c) => (
      <div key={c.k}>
        <span className="fig">{c.v}</span>
        <span className="label">{c.k}</span>
      </div>
    ))}
  </div>
);

export const hitText = (read: number, total: number): string => {
  const p = fmt.cacheHitPercent(read, total);
  return p === null ? "–" : `${p}%`;
};

export const sliceHit = (s: { cacheRead: number; promptTotal: number; cacheUnknownPrompt?: number }): string => hitText(s.cacheRead, s.promptTotal - (s.cacheUnknownPrompt ?? 0));

