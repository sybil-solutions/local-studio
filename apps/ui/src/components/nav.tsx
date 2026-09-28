import { type ReactNode, useMemo, useState } from "react";
import { getKey, setKey } from "../api";
import { machines, podWorker } from "../model/view";
import { restart, useStore } from "../store";
import { BarMark } from "./basics";

const Item = ({ href, on, children, count, depth = 0 }: { href: string; on: boolean; children: ReactNode; count?: string; depth?: number }) => (
  <a href={href} className={`nav-i d${depth}${on ? " on" : ""}`}>
    <span className="ellipsis">{children}</span>
    {count !== undefined && <span className="nav-n">{count}</span>}
  </a>
);

export const Nav = ({ path }: { path: string }) => {
  const fleet = useStore((s) => s.fleet);
  const launches = useStore((s) => s.launches);
  const sessions = useStore((s) => s.fleet?.sessions.length ?? 0);
  const conn = useStore((s) => s.conn);
  const [open, setOpen] = useState(false);
  const ms = useMemo(() => machines(fleet, launches), [fleet, launches]);
  const running = ms.flatMap((m) => (m.snap?.models ?? []).filter((x) => (x.modality ?? "chat") === "chat" && !podWorker(x)).map((x) => ({ key: `${m.id}/${x.id}`, name: x.primaryModel || x.id, machine: m.name })));
  const endpoints = ms.reduce((t, m) => t + (m.snap?.models ?? []).filter((x) => (x.modality ?? "chat") !== "chat").length, 0);
  const sparks = ms.filter((m) => /^spark-/.test(m.name));
  const others = ms.filter((m) => !/^spark-/.test(m.name));
  const is = (p: string) => path === p;
  const starts = (p: string) => path === p || path.startsWith(`${p}/`);
  return (
    <aside className={`nav${open ? " open" : ""}`} onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
      <div className="nav-top">
        <a href="#/control" className="nav-brand">
          <span className={`nav-dot ${conn}`} />
          LOCAL STUDIO
        </a>
        <button type="button" className="nav-menu" onClick={() => setOpen(!open)} aria-label="menu">
          {open ? "×" : "≡"}
        </button>
      </div>
      <nav className="nav-body">
        <Item href="#/control" on={is("control") || is("")}>
          overview
        </Item>
        <Item href="#/run" on={starts("run")}>
          run a model
        </Item>
        <div className="nav-sec">models</div>
        {running.map((r) => (
          <Item key={r.key} href={`#/models/${encodeURIComponent(r.key)}`} on={is(`models/${r.key}`)} depth={1} count={r.machine}>
            {r.name}
          </Item>
        ))}
        {running.length === 0 && <span className="nav-i d1 label">none running</span>}
        <Item href="#/endpoints" on={is("endpoints")} depth={1} count={String(endpoints)}>
          endpoints
        </Item>
        <div className="nav-sec">machines</div>
        {others.map((m) => (
          <Item key={m.id} href={`#/machines/${encodeURIComponent(m.id)}`} on={is(`machines/${m.id}`)} depth={1}>
            <BarMark mark={m.online ? m.mark : "failed"} /> {m.name}
          </Item>
        ))}
        {sparks.length > 0 && (
          <>
            <Item href="#/machines/sparks" on={is("machines/sparks")} depth={1} count={`${sparks.filter((m) => m.online).length}/${sparks.length}`}>
              <BarMark mark={sparks.some((m) => m.online) ? (sparks[0]?.mark ?? "") : "failed"} /> sparks
            </Item>
            {sparks.map((m) => (
              <Item key={m.id} href={`#/machines/${encodeURIComponent(m.id)}`} on={is(`machines/${m.id}`)} depth={2}>
                {m.name.replace(/^spark-/, "")}
              </Item>
            ))}
          </>
        )}
        <Item href="#/connect" on={is("connect")} depth={1}>
          connect a machine
        </Item>
        <div className="nav-sec">work</div>
        <Item href="#/agents" on={starts("agents")} count={sessions ? String(sessions) : undefined}>
          agents
        </Item>
        <Item href="#/live" on={is("live")}>
          live
        </Item>
        <Item href="#/usage" on={is("usage")}>
          usage
        </Item>
      </nav>
      {getKey() && (
        <button type="button" className="nav-i nav-out" onClick={() => (setKey(null), void restart())}>
          sign out
        </button>
      )}
    </aside>
  );
};
