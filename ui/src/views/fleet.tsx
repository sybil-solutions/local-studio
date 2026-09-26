import { useMemo, useState } from "react";
import { fmt } from "@local-studio/contracts/client";
import { cancelLaunch, ConnectDialog } from "../components/actions";
import { BarMark, Btn, Err, Figs, Sec, Table } from "../components/basics";
import { ACTIVE, aggOf, engineFor, gpuLine, launchesFor, machines, type MachineView, served, tpsOf, vram } from "../model/view";
import { useStore } from "../store";

const enc = encodeURIComponent;

export interface Row {
  key: string;
  m: MachineView;
  modelId: string | null;
  name: string;
  mark: "" | "ready" | "busy" | "failed";
  gpus: string;
  state: string;
  tps: number | null;
  served: string | null;
  launchId: string | null;
}

export const useRows = (ms: MachineView[]): Row[] => {
  const live = useStore((s) => s.launches);
  const engines = useStore((s) => s.engines);
  const selfId = useStore((s) => s.fleet?.self ?? null);
  const now = useStore((s) => Math.floor(s.now / 60_000) * 60_000);
  return useMemo(
    () =>
      ms.flatMap((m) => {
        const s = m.snap;
        if (!s || !m.online) return [];
        const ls = launchesFor(s, live, selfId).filter((l) => ACTIVE.includes(l.phase) || l.phase === "failed");
        const models = s.models.map((x): Row => {
          const l = ls.find((y) => y.modelId === x.id && ACTIVE.includes(y.phase));
          return {
            key: `${m.id}/${x.id}`,
            m,
            modelId: x.id,
            name: x.primaryModel || x.id,
            mark: x.state === "ready" ? "ready" : x.state === "unhealthy" ? "failed" : "busy",
            gpus: gpuLine(s.gpus.filter((g) => x.gpuKeys.includes(g.key))) || `:${x.port}`,
            state: x.state === "ready" ? `ready ${fmt.dur((now - x.stateSince) / 1000)}` : l ? `${l.phase}${l.percent !== null ? ` ${Math.round(l.percent)}%` : ""}` : x.state,
            tps: x.state === "ready" ? tpsOf(engineFor(s, x.id, engines, m.self)) : null,
            served: served(x),
            launchId: l?.launchId ?? null,
          };
        });
        const pending = ls
          .filter((l) => !s.models.some((x) => x.id === l.modelId))
          .map((l): Row => ({
            key: `${m.id}/${l.launchId}`,
            m,
            modelId: null,
            name: l.recipeId,
            mark: l.phase === "failed" ? "failed" : "busy",
            gpus: gpuLine(s.gpus.filter((g) => l.gpuKeys?.includes(g.key))),
            state: l.phase === "failed" ? (l.error ?? "failed") : `${l.phase}${l.percent !== null ? ` ${Math.round(l.percent)}%` : ""}`,
            tps: null,
            served: null,
            launchId: l.phase === "failed" ? null : l.launchId,
          }));
        return [...models, ...pending];
      }),
    [ms, live, engines, selfId, now],
  );
};

export const ModelTable = ({ rows, multi, reqOf, onCancel }: { rows: Row[]; multi: boolean; reqOf: (r: Row) => number | undefined; onCancel: (r: Row) => void }) => (
  <Table
    cols={[
      {
        h: "model",
        c: (r: Row) => (
          <span className="row-flex">
            <BarMark mark={r.mark} />
            <span className="ink">{r.name}</span>
          </span>
        ),
      },
      ...(multi ? [{ h: "machine", w: true, c: (r: Row) => r.m.name }] : []),
      { h: "gpus", w: true, c: (r) => r.gpus },
      { h: "state", c: (r) => <span className={r.mark === "failed" ? "alert" : ""}>{r.state}</span> },
      { h: "tok/s", n: true, c: (r) => fmt.tps(r.tps) },
      { h: "req 24h", n: true, w: true, c: (r) => fmt.k(reqOf(r)) },
      {
        h: "",
        n: true,
        c: (r) =>
          r.modelId && r.mark === "ready" ? (
            <Btn href={`#/agents?model=${enc(r.served ?? r.name)}`}>Agent ›</Btn>
          ) : r.launchId ? (
            <Btn kind="danger" onClick={() => onCancel(r)} disabled={r.m.readOnly}>
              Stop
            </Btn>
          ) : null,
      },
    ]}
    rows={rows}
    keyOf={(r) => r.key}
    rowClass={(r) => (r.mark === "failed" ? "err" : "")}
    onRow={(r) => {
      if (r.modelId) location.hash = `#/m/${enc(r.m.id)}/${enc(r.modelId)}`;
    }}
  />
);

export const FleetPage = () => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const engines = useStore((s) => s.engines);
  const stats = useStore((s) => s.stats);
  const error = useStore((s) => s.error);
  const [connect, setConnect] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ms = useMemo(() => machines(fleet, live), [fleet, live]);
  const rows = useRows(ms);
  if (!fleet) return <Err>{error ?? "connecting"}</Err>;
  const a = aggOf(ms, engines);
  const sums = ms.map((m) => stats[m.id]?.sum).filter((s) => !!s);
  const tot = (k: "requests" | "errors" | "promptTotal" | "output") => sums.reduce((t, s) => t + (s[k] ?? 0), 0);
  const reqOf = (r: Row) => stats[r.m.id]?.sum?.byModel.find((x) => x.key === r.served)?.requests;
  return (
    <>
      <div className="crumb">
        <span className="title">Fleet</span>
        <span className="btns">
          <Btn kind="quiet" onClick={() => setConnect(true)}>
            Connect ›
          </Btn>
        </span>
      </div>
      <Figs
        cells={[
          [vram(a), "gpu memory"],
          [fmt.tps(a.tps), "tok/s now"],
          [fmt.k(tot("requests")), "requests 24h"],
          [fmt.k(tot("promptTotal") + tot("output")), "tokens 24h"],
          [fmt.k(tot("errors")), "errors 24h", tot("errors") ? "alert" : ""],
        ]}
      />
      <Sec>running</Sec>
      <ModelTable rows={rows} multi reqOf={reqOf} onCancel={(r) => r.launchId && void cancelLaunch(r.m.peerId, r.launchId).then(setErr)} />
      <Err>{err}</Err>
      {connect && <ConnectDialog onClose={() => setConnect(false)} />}
    </>
  );
};
