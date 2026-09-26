import { useMemo } from "react";
import { fmt } from "@local-studio/contracts/client";
import { getKey, setKey } from "../api";
import { BarMark } from "../components/basics";
import { aggOf, groupMark, groups, machines, type MachineView, vram } from "../model/view";
import { restart, useStore } from "../store";

const enc = encodeURIComponent;

const Item = ({ href, on, mark, name, right, sub, cls = "" }: { href: string; on: boolean; mark?: ReturnType<typeof groupMark>; name: string; right?: string; sub?: [string, string]; cls?: string }) => (
  <a className={`ri${on ? " on" : ""} ${cls}`} href={href}>
    {mark !== undefined ? <BarMark mark={mark} /> : <span />}
    <span className="nm ellipsis">{name}</span>
    <span>{right ?? ""}</span>
    {sub && (
      <span className="sub">
        <span className="ellipsis">{sub[0]}</span>
        <span>{sub[1]}</span>
      </span>
    )}
  </a>
);

export const Rail = ({ on }: { on: string }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const engines = useStore((s) => s.engines);
  const stats = useStore((s) => s.stats);
  const conn = useStore((s) => s.conn);
  const ms = useMemo(() => machines(fleet, live), [fleet, live]);
  const gs = groups(ms);
  const all = aggOf(ms, engines);
  const online = ms.filter((m) => m.online).length;
  const req = ms.reduce((t, m) => t + (stats[m.id]?.sum?.requests ?? 0), 0);
  const running = fleet?.sessions?.length ?? 0;
  const line = (xs: MachineView[]): [string, string] => {
    const a = aggOf(xs, engines);
    return [a.models.join(", ") || "–", a.tps === null ? "" : `${fmt.tps(a.tps)} tok/s`];
  };
  const version = ms.find((m) => m.self)?.snap?.machine.version ?? "";
  return (
    <nav className="rail">
      <div className="brand">
        <a href="#/">LOCAL STUDIO</a>
        <span className={`right ${conn === "live" ? "label" : "alert"}`}>{conn === "live" ? version : conn}</span>
      </div>
      <Item href="#/" on={on === "fleet"} name="FLEET" cls="head" right={`${online}/${ms.length}`} sub={[`${all.models.length} models`, all.tps === null ? "" : `${fmt.tps(all.tps)} tok/s`]} />
      {gs.map((g) => {
        const a = aggOf(g.ms, engines);
        const open = g.pod && (on === g.id || g.ms.some((m) => m.id === on));
        return (
          <div key={g.id} className={g.pod ? "head" : ""}>
            <Item href={`#/m/${enc(g.id)}`} on={on === g.id} mark={groupMark(g.ms)} name={g.pod ? g.name.toUpperCase() : g.name} right={g.ms.every((m) => !m.online) ? "offline" : vram(a)} sub={g.pod ? [`${g.ms.length} × ${g.ms[0]?.gpuSummary ?? ""}`, line(g.ms)[1]] : line(g.ms)} />
            {open && g.ms.map((m) => <Item key={m.id} href={`#/m/${enc(m.id)}`} on={on === m.id} mark={m.mark} name={m.name} right={m.online ? vram(aggOf([m], engines)) : "offline"} cls="child" />)}
          </div>
        );
      })}
      <div className="nav">
        <Item href="#/agents" on={on === "agents"} name="Agents" right={running ? `${running} running` : ""} />
        <Item href="#/usage" on={on === "usage"} name="Usage" right={`${fmt.k(req)} req`} />
        {getKey() && (
          <a className="ri" href="#/" onClick={() => (setKey(null), void restart())}>
            <span />
            <span className="nm">Sign out</span>
            <span />
          </a>
        )}
      </div>
    </nav>
  );
};
