import { useState } from "react";
import type { EngineRates, MetricsSummary } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import type { CardView, Figure, GpuRowView, LifeView, MachineView, SlotView } from "../model/view";
import { BarMark, Btn, Chips, Dialog, Logo } from "./basics";

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

export const ModelCard = ({ c, onStop, onCancel }: { c: CardView; onStop: (c: CardView) => void; onCancel: (c: CardView) => void }) => (
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
      {!c.ready && (
        <div style={{ marginTop: 4 }}>
          <div className={c.subAlert ? "alert" : "value"}>{c.sub}</div>
          {c.progress !== null && (
            <div className="progress">
              <div style={{ width: `${Math.max(0, Math.min(100, c.progress))}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
    <div className="foot">
      {c.ready && !c.embedding ? (
        <Btn kind="primary" href={`#/agents?model=${encodeURIComponent(c.servedModel ?? c.name)}`}>
          Open agent ›
        </Btn>
      ) : c.ready ? null : c.modelId ? (
        <Btn kind="danger" onClick={() => onStop(c)} disabled={c.readOnly || !!c.stopBlocked} title={c.readOnly ? "read-only controller" : c.stopBlocked ?? undefined}>
          Stop model
        </Btn>
      ) : c.launchId ? (
        <Btn kind="danger" onClick={() => onCancel(c)} disabled={c.readOnly} title={c.readOnly ? "read-only controller" : "cancel this launch"}>
          Stop
        </Btn>
      ) : null}
      {c.href && <Btn href={c.href}>More</Btn>}
      <Chips chips={c.chips} />
    </div>
  </div>
);

export const MachinesStrip = ({ ms }: { ms: MachineView[] }) => (
  <div className="mstrip">
    {ms.map((m) => (
      <a className="mcell" key={m.id} href={`#/m/${encodeURIComponent(m.id)}`}>
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

export const SlotRow = ({ s, onRun, onDismiss, showMachine }: { s: SlotView; onRun: (s: SlotView) => void; onDismiss: (s: SlotView) => void; showMachine: boolean }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={`slot${s.crashed ? " crashed" : ""}${open ? " open" : ""}`} onClick={() => setOpen(!open)}>
        <span className="k">{s.label}</span>
        {s.hint && <span className="alert">{s.hint}</span>}
        {showMachine && !s.crashed && <span className="label small">{s.machineName}</span>}
        <span className="r">
          {s.crashed && (
            <span
              className="label"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(s);
              }}
            >
              dismiss
            </span>
          )}
          {s.run ? (
            <span
              className="act"
              onClick={(e) => {
                e.stopPropagation();
                onRun(s);
              }}
            >
              <Logo family={s.run.family} size={12} />
              {s.run.label}
            </span>
          ) : (
            <span className={s.warn ? "alert" : "label"}>{s.note}</span>
          )}
        </span>
      </div>
      {open && (
        <div className="links">
          <Chips chips={s.chips} />
          {s.detail && <div className={s.crashed ? "alert" : "label"}>{s.detail}</div>}
          <div className="btns">
            {s.run && (
              <Btn kind="primary" onClick={() => onRun(s)}>
                {s.crashed ? "Run again ›" : "Run ›"}
              </Btn>
            )}
            <Btn href={`#/recipes/${encodeURIComponent(s.machineId)}`}>Config</Btn>
            {s.crashed && <Btn onClick={() => onDismiss(s)}>Dismiss</Btn>}
          </div>
        </div>
      )}
    </>
  );
};

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

export const FigureGrid = ({ cells }: { cells: Figure[] }) => (
  <div className="grid6">
    {cells.map((c) => (
      <div key={c.k}>
        <span className="fig">
          {c.v}
          {c.u && <span className="label"> {c.u}</span>}
        </span>
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

const EngineRows = ({ e }: { e: EngineRates }) => (
  <>
    <dt>engine prefix hit</dt>
    <dd>{fmt.pct(e.prefixHitRate)}</dd>
    <dt>engine prefill / decode tok/s</dt>
    <dd>
      {fmt.tps(e.prefillTps)} / {fmt.tps(e.decodeTps)}
    </dd>
    <dt>engine generation tok/s (wall)</dt>
    <dd>{fmt.tps(e.generationTpsWall)}</dd>
    <dt>engine mean TTFT / queue</dt>
    <dd>
      {fmt.ms(e.meanTtftMs)} / {fmt.ms(e.meanQueueMs)}
    </dd>
    <dt>spec accept length</dt>
    <dd>{e.specAcceptLength === null ? "–" : e.specAcceptLength.toFixed(2)}</dd>
    <dt>KV cache usage</dt>
    <dd>{fmt.pct(e.kvCacheUsage)}</dd>
    <dt>running / waiting</dt>
    <dd>
      {e.running ?? "–"} / {e.waiting ?? "–"}
    </dd>
  </>
);

export const Pills = ({ s, engine, title }: { s: MetricsSummary | null; engine: EngineRates | null; title: string }) => {
  const [open, setOpen] = useState(false);
  if (!s || (s.promptTotal === 0 && s.output === 0 && s.requests === 0))
    return (
      <>
        <div className="pills">
          <span className="pill">no gateway requests in this window</span>
          {engine && (
            <button type="button" className="pill" onClick={() => setOpen(true)}>
              engine {fmt.tps(engine.decodeTps)} tok/s · prefix hit {fmt.pct(engine.prefixHitRate)}
            </button>
          )}
        </div>
        {open && engine && (
          <Dialog title={title} onClose={() => setOpen(false)}>
            <div className="blk">
              <dl className="kv">
                <EngineRows e={engine} />
              </dl>
            </div>
          </Dialog>
        )}
      </>
    );
  return (
    <>
      <div className="pills">
        <button type="button" className="pill" onClick={() => setOpen(true)}>
          {fmt.tps(s.decodeTps)} tok/s · {sliceHit(s)} cache hit
        </button>
        <button type="button" className="pill" onClick={() => setOpen(true)}>
          {fmt.k(s.requests)} requests · {fmt.k(s.promptTotal + s.output)} tokens
        </button>
        {s.errors > 0 && (
          <button type="button" className="pill" onClick={() => setOpen(true)}>
            <span className="alert">{fmt.k(s.errors)} errors</span>
          </button>
        )}
      </div>
      {open && (
        <Dialog title={title} onClose={() => setOpen(false)}>
          <div className="blk">
            <dl className="kv">
              <dt>requests</dt>
              <dd>{fmt.k(s.requests)}</dd>
              <dt>avg TTFT (p50 / p90)</dt>
              <dd>
                {fmt.ms(s.meanTtftMs)} ({fmt.ms(s.ttftMs.p50)} / {fmt.ms(s.ttftMs.p90)})
              </dd>
              <dt>decode tok/s (gateway)</dt>
              <dd>{fmt.tps(s.decodeTps)}</dd>
              <dt>prefill tok/s (gateway, incl. queue)</dt>
              <dd>{fmt.tps(s.prefillTps)}</dd>
              <dt>cache hit</dt>
              <dd>{sliceHit(s)}</dd>
              <dt>input</dt>
              <dd>{fmt.k(s.inputUncached)}</dd>
              <dt>cache read</dt>
              <dd>{fmt.k(s.cacheRead)}</dd>
              {s.cacheUnknownPrompt > 0 && (
                <>
                  <dt>prompt, cache not reported</dt>
                  <dd>{fmt.k(s.cacheUnknownPrompt)}</dd>
                </>
              )}
              {s.cacheWrite > 0 && (
                <>
                  <dt>cache write</dt>
                  <dd>{fmt.k(s.cacheWrite)}</dd>
                </>
              )}
              <dt>output</dt>
              <dd>{fmt.k(s.output)}</dd>
              <dt>reasoning</dt>
              <dd>{fmt.k(s.reasoning)}</dd>
              <dt>errors</dt>
              <dd>{s.errors ? `${fmt.k(s.errors)} (${fmt.pct(s.errorRate)})` : "0"}</dd>
              <dt>spend</dt>
              <dd>{s.costUsd === null ? "$0 local" : `$${s.costUsd.toFixed(2)}`}</dd>
              {engine && <EngineRows e={engine} />}
            </dl>
          </div>
        </Dialog>
      )}
    </>
  );
};
