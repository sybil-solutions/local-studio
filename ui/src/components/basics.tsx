import { Component, type ReactNode, useEffect, useState } from "react";
import type { Mark } from "../model/view";

export const Btn = ({ children, kind = "secondary", onClick, disabled, title, href }: { children: string; kind?: "primary" | "secondary" | "danger" | "quiet"; onClick?: () => void; disabled?: boolean; title?: string; href?: string }) => {
  const chev = children.endsWith(" ›");
  const cls = `btn ${kind === "secondary" ? "" : kind}${chev ? " has-chev" : ""}`;
  const inner = (
    <>
      {chev ? children.slice(0, -2) : children}
      {chev && <span className="chev">›</span>}
    </>
  );
  if (href && !disabled)
    return (
      <a className={cls} href={href} title={title} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {inner}
      </a>
    );
  return (
    <button
      type="button"
      className={cls}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      disabled={disabled || (!onClick && !href)}
      title={title}
    >
      {inner}
    </button>
  );
};

export class Boundary extends Component<{ children: ReactNode; name: string }, { err: string | null }> {
  override state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
  override componentDidCatch(e: unknown) {
    console.error(`${this.props.name}:`, e);
  }
  override render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="err btns">
        {this.props.name}: {this.state.err}
        <Btn onClick={() => this.setState({ err: null })}>Retry</Btn>
      </div>
    );
  }
}

export const Sec = ({ children, aside }: { children: string; aside?: ReactNode }) => (
  <div className="sec">
    {children}
    {aside && <span className="aside">{aside}</span>}
  </div>
);

export interface Col<T> {
  h: string;
  n?: boolean;
  w?: boolean;
  c: (r: T) => ReactNode;
}

export function Table<T>({ cols, rows, keyOf, rowClass, onRow }: { cols: Col<T>[]; rows: T[]; keyOf: (r: T) => string; rowClass?: (r: T) => string; onRow?: (r: T) => void }) {
  if (!rows.length) return <div className="note">–</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th key={i} className={`${c.n ? "n" : ""}${c.w ? " w" : ""}`}>
                {c.h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={keyOf(r)} className={`${rowClass?.(r) ?? ""}${onRow ? " click" : ""}`} onClick={onRow ? () => onRow(r) : undefined}>
              {cols.map((c, i) => (
                <td key={i} className={`${c.n ? "n" : ""}${c.w ? " w" : ""}`}>
                  {c.c(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Dialog = ({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) => {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onClose]);
  return (
    <div className="dlg-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg" role="dialog" aria-label={title}>
        <div className="ttl">
          {title}
          <button type="button" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const BarMark = ({ mark }: { mark: Mark }) => {
  const [ripple, setRipple] = useState(0);
  useEffect(() => {
    if (mark !== "busy" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setRipple((r) => (r + 1) % 5), 160);
    return () => clearInterval(t);
  }, [mark]);
  return (
    <span className={`mark ${mark}`} aria-label={mark || "idle"}>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={mark === "busy" && (i % 3) + Math.floor(i / 3) === ripple ? "on" : ""} />
      ))}
    </span>
  );
};

export const KV = ({ rows }: { rows: [string, ReactNode, string?][] }) => (
  <dl className="kv">
    {rows.map(([k, v, cls], i) => (
      <span key={i} style={{ display: "contents" }}>
        <dt>{k}</dt>
        <dd className={cls}>{v}</dd>
      </span>
    ))}
  </dl>
);

export const Figs = ({ cells }: { cells: [string, string, string?][] }) => (
  <div className="figs">
    {cells.map(([v, k, cls]) => (
      <div key={k}>
        <span className={`fig ${cls ?? ""}`}>{v}</span>
        <span className="label">{k}</span>
      </div>
    ))}
  </div>
);

export const Bar = ({ pct }: { pct: number | null }) => (
  <span className="bar">
    <i style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
  </span>
);

export const Err = ({ children }: { children: ReactNode }) => (children ? <div className="err">{children}</div> : null);

export const Copy = ({ text }: { text: string }) => {
  const [done, setDone] = useState(false);
  return (
    <div className="copy">
      <pre className="pre">{text}</pre>
      <Btn onClick={() => void navigator.clipboard?.writeText(text).then(() => setDone(true))}>{done ? "Copied" : "Copy"}</Btn>
    </div>
  );
};

export const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
