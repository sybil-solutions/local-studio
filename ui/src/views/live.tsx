import { useMemo } from "react";
import type { EngineRates } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { Err } from "../components/basics";
import { H, Line, Meter, Sum } from "../components/panel";
import { gpuRow, machines } from "../model/view";
import { type EngineHist, useStore } from "../store";

const time = (t: number) => new Date(t).toTimeString().slice(0, 8);
const last = (v: (number | null)[] | undefined) => {
  for (let i = (v?.length ?? 0) - 1; i >= 0; i--) if (v![i] !== null) return v![i]!;
  return null;
};
const METRICS: { k: keyof EngineHist; label: string; f: (n: number | null) => string; unit: string }[] = [
  { k: "dec", label: "decode", f: (n) => fmt.tps(n), unit: " tok/s" },
  { k: "pre", label: "prefill", f: (n) => fmt.tps(n), unit: " tok/s" },
  { k: "ttft", label: "ttft", f: (n) => (n === null ? "–" : String(Math.round(n))), unit: " ms" },
  { k: "kv", label: "kv cache", f: (n) => (n === null ? "–" : String(Math.round(n))), unit: "%" },
  { k: "hit", label: "prefix hit", f: (n) => (n === null ? "–" : String(Math.round(n))), unit: "%" },
  { k: "spec", label: "spec accept", f: (n) => (n === null ? "–" : n.toFixed(2)), unit: "" },
];

export const LivePage = () => {
  const fleet = useStore((s) => s.fleet);
  const launches = useStore((s) => s.launches);
  const liveEngines = useStore((s) => s.engines);
  const ehist = useStore((s) => s.ehist);
  const local = useStore((s) => s.requests);
  const fresh = useStore((s) => s.fresh);
  const stats = useStore((s) => s.stats);
  const error = useStore((s) => s.error);
  const ms = useMemo(() => machines(fleet, launches).filter((m) => m.online && m.snap), [fleet, launches]);
  if (!fleet) return <Err>{error ?? "connecting"}</Err>;
  const names = Object.fromEntries(ms.map((m) => [m.id, m.name]));
  const engines = ms.flatMap((m) =>
    m.snap!.engines.map((e) => {
      const r: EngineRates = (m.self ? liveEngines[e.modelId] : undefined) ?? e;
      const model = m.snap!.models.find((x) => x.id === e.modelId);
      return { m, r, model, h: ehist[`${m.id}/${e.modelId}`], idle: !r.running && !(r.generationTpsWall && r.generationTpsWall > 0) };
    }),
  ).filter((x) => (x.model?.modality ?? "chat") === "chat");
  const reqs = [...local.filter((r) => r.via !== "peer" && names[r.machineId]), ...ms.flatMap((m) => (m.peerId ? (stats[m.id]?.reqs ?? []) : []))].sort((a, b) => b.tsStart - a.tsStart).slice(0, 40);
  const sum = (f: (x: (typeof engines)[number]) => number | null) => engines.reduce((t, x) => t + (f(x) ?? 0), 0);
  const power = ms.flatMap((m) => m.snap!.gpus).map((g) => g.powerW).filter((x): x is number => x !== null);
  return (
    <div className="panel">
      <Sum
        cells={[
          { v: String(sum((x) => x.r.running)), k: "in flight" },
          { v: String(sum((x) => x.r.waiting)), k: "queued" },
          { v: fmt.tps(sum((x) => (x.idle ? 0 : x.r.decodeTps ?? x.r.generationTpsWall))), k: "decode tok/s" },
          { v: fmt.tps(sum((x) => (x.idle ? 0 : x.r.prefillTps ?? x.r.promptTpsWall))), k: "prefill tok/s" },
          { v: power.length ? `${Math.round(power.reduce((t, x) => t + x, 0))} W` : "–", k: "power" },
        ]}
      />
      {engines.map((x) => (
        <div key={`${x.m.id}/${x.r.modelId}`}>
          <H aside={x.idle ? `idle${x.r.lastActiveAt ? ` ${fmt.ago(x.r.lastActiveAt, Date.now())}` : ""}` : `${x.r.running ?? 0} running · ${x.r.waiting ?? 0} waiting`}>
            <span className="ink">{x.model?.primaryModel ?? x.r.modelId}</span>
            <span className="label">{` · ${x.m.name}`}</span>
          </H>
          <div className={`p-mets${x.idle ? " idle" : ""}`}>
            {METRICS.map((mt) => (
              <div key={mt.k} className="p-met">
                <span className="label">{mt.label}</span>
                <b>
                  {mt.f(last(x.h?.[mt.k]))}
                  <span className="label">{mt.unit}</span>
                </b>
                <Line v={x.h?.[mt.k] ?? []} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <H aside="live">gpus</H>
      {ms.flatMap((m) =>
        m.snap!.gpus.map((g, i) => {
          const r = gpuRow(g, m.snap);
          return (
            <div key={`${m.id}/${g.key}`} className="p-grow">
              <span className="ink ellipsis">{m.name}</span>
              <span className="label ellipsis">{`${r.name} · ${i}`}</span>
              <Meter pct={g.utilPct} />
              <span>{g.utilPct === null ? "–" : `${Math.round(g.utilPct)}%`}</span>
              <span className="label">{r.mem}</span>
              <span className="n">{g.powerW === null ? "–" : `${Math.round(g.powerW)} W`}</span>
            </div>
          );
        }),
      )}
      <H aside="newest first">requests</H>
      <div className="p-rq label">
        <span>time</span>
        <span>model · client</span>
        <span className="n">in</span>
        <span className="n">cached</span>
        <span className="n">out</span>
        <span className="n">tok/s</span>
        <span className="n">ttft</span>
      </div>
      {reqs.map((r) => (
        <div key={r.id} className={`p-rq${fresh.has(r.id) ? " new" : ""}${r.errorCode ? " err" : ""}`}>
          <span className="label">{time(r.tsStart)}</span>
          <span className="ellipsis">
            <span className="ink">{r.model}</span>
            <span className="label">{` · ${r.client}${ms.length > 1 ? ` · ${names[r.machineId] ?? ""}` : ""}`}</span>
          </span>
          <span className="n">{fmt.k(r.inputUncached)}</span>
          <span className="n label">{r.cacheSource === null ? "–" : fmt.k(r.cacheRead)}</span>
          <span className="n">{r.errorCode ? <span className="alert">{r.errorCode}</span> : fmt.k(r.output)}</span>
          <span className="n ink">{fmt.tps(r.decodeTps)}</span>
          <span className="n">{fmt.ms(r.ttftMs)}</span>
        </div>
      ))}
    </div>
  );
};
