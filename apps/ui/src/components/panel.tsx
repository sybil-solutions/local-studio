import type { ReactNode } from "react";

export const Sum = ({ cells }: { cells: { v: string; k: string }[] }) => (
  <div className="p-sum">
    {cells.map((c) => (
      <span key={c.k}>
        <b>{c.v}</b>
        <span className="label">{c.k}</span>
      </span>
    ))}
  </div>
);

export const H = ({ children, aside }: { children: ReactNode; aside?: ReactNode }) => (
  <h2 className="p-h">
    <span>{children}</span>
    {aside !== undefined && <span className="p-aside">{aside}</span>}
  </h2>
);

export const Row = ({ children, go, onClick, className = "" }: { children: ReactNode; go?: ReactNode; onClick?: () => void; className?: string }) => (
  <div className={`p-row${onClick ? " click" : ""} ${className}`} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}>
    {children}
    {go !== undefined && <span className="p-go">{go}</span>}
  </div>
);

export const Line = ({ v }: { v: (number | null)[] }) => {
  const pts = v.map((x, i) => [i, x] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  const top = Math.max(0, ...pts.map((p) => p[1]));
  if (pts.length < 2 || top <= 0) return <svg className="p-line" viewBox="0 0 100 20" aria-hidden="true" />;
  const n = Math.max(1, v.length - 1);
  return (
    <svg className="p-line" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.map(([i, x]) => `${((i / n) * 100).toFixed(2)},${(19 - (x / top) * 17).toFixed(2)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export const Meter = ({ pct }: { pct: number | null }) => (
  <span className="p-bar">
    <i style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
  </span>
);

export const Tabs = <T extends string>({ items, on, set }: { items: readonly T[]; on: T; set: (t: T) => void }) => (
  <span className="p-tabs">
    {items.map((t) => (
      <button type="button" key={t} className={t === on ? "on" : ""} onClick={() => set(t)}>
        {t}
      </button>
    ))}
  </span>
);

export const Item = ({ lead, title, sub, actions, onClick, dim }: { lead?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode; onClick?: () => void; dim?: boolean }) => (
  <div className={`p-row item${onClick ? " click" : ""}${dim ? " dim" : ""}`} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}>
    {lead && <span className="item-lead">{lead}</span>}
    <span className="item-main">
      <span className="ink">{title}</span>
      {sub !== undefined && <span className="label">{sub}</span>}
    </span>
    {actions && (
      <span className="item-acts" onClick={(e) => e.stopPropagation()}>
        {actions}
      </span>
    )}
  </div>
);
