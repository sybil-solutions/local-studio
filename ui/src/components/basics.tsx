import { type ReactNode, useEffect, useState } from "react";
import hf from "../assets/hf.svg";
import lfm from "../assets/lfm.svg";
import qwen from "../assets/qwen.svg";
import type { Chip, Family, Mark } from "../model/view";

const LOGOS: Record<string, string> = { qwen, lfm, hf };

export const Logo = ({ family, size = 18 }: { family: Family; size?: 12 | 14 | 18 }) =>
  family && LOGOS[family] ? <img className={`logo${size === 18 ? "" : ` s${size}`}`} src={LOGOS[family]} alt="" /> : null;

const PATHS: Record<string, string> = {
  speed: "M7 1 3 7h3l-1 4 4-6H6z",
  gpu: "M1 3h10v6H1zM3 9v2M6 9v2M9 9v2M3 5h2v2H3z",
  memory: "M2 2h8v8H2zM4 4h4v4H4zM0 4h2M0 8h2M10 4h2M10 8h2",
  temp: "M5 1h2v6a2 2 0 1 1-2 0zM6 5v3",
  context: "M1 3h10M1 6h10M1 9h7",
  weights: "M6 1l5 2.5v5L6 11 1 8.5v-5zM1 3.5 6 6l5-2.5M6 6v5",
  vision: "M1 6s2-3.5 5-3.5S11 6 11 6 9 9.5 6 9.5 1 6 1 6zM6 4.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z",
};

export const Icon = ({ name }: { name: string }) =>
  name === "tokens" ? (
    <span className="icon">Σ</span>
  ) : PATHS[name] ? (
    <svg className="icon" viewBox="0 0 12 12" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  ) : null;

export const Chips = ({ chips, className = "" }: { chips: Chip[]; className?: string }) => (
  <div className={`chips ${className}`}>
    {chips.map((c, i) => (
      <span className="chip" key={i}>
        {c.icon && <Icon name={c.icon} />}
        {c.text}
      </span>
    ))}
  </div>
);

export const Btn = ({
  children,
  kind = "secondary",
  onClick,
  disabled,
  title,
  href,
}: {
  children: string;
  kind?: "primary" | "secondary" | "danger";
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  href?: string;
}) => {
  const chev = children.endsWith(" ›");
  const label = chev ? children.slice(0, -2) : children;
  const cls = `btn ${kind === "secondary" ? "" : kind}${chev ? " has-chev" : ""}`;
  const inner = (
    <>
      {label}
      {chev && <span className="chev">›</span>}
    </>
  );
  if (href && !disabled)
    return (
      <a className={cls} href={href} title={title} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
        {inner}
      </a>
    );
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled || (!onClick && !href)} title={title}>
      {inner}
    </button>
  );
};

export const SectionHeading = ({ children, aside }: { children: string; aside?: ReactNode }) => (
  <div className="sec">
    {children.toUpperCase()}
    {aside && <span className="aside">{aside}</span>}
  </div>
);

export interface Col<T> {
  h: string;
  n?: boolean;
  c: (r: T) => ReactNode;
}

export function Table<T>({ cols, rows, keyOf, rowClass, empty = "nothing yet" }: { cols: Col<T>[]; rows: T[]; keyOf: (r: T) => string; rowClass?: (r: T) => string; empty?: string }) {
  if (!rows.length) return <div className="note gap-block">{empty}</div>;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.h} className={c.n ? "n" : ""}>
                {c.h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={keyOf(r)} className={rowClass?.(r) ?? ""}>
              {cols.map((c) => (
                <td key={c.h} className={c.n ? "n" : ""}>
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

export const Dialog = ({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) => {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [onClose]);
  return (
    <div className="dlg-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dlg${wide ? " wide" : ""}`} role="dialog" aria-label={title}>
        <div className="ttl">
          {title.toUpperCase()}
          <button type="button" onClick={onClose} aria-label="close">
            close
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
    if (mark !== "busy") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
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
