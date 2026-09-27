import { useMemo } from "react";
import type { EngineRates } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { SectionHeading, Table } from "../components/basics";
import { GpuCharts, GpuTable } from "../components/cards";
import { RequestsTable } from "../components/requests";
import { machines } from "../model/view";
import { useStore } from "../store";

const num = (x: number | null, d = 2) => (x === null ? "–" : x.toFixed(d));

const dim = (v: number | null, fb: number | null, f: (n: number | null) => string, idle: boolean) => {
  const x = v ?? fb;
  return <span className={idle || v === null ? "label" : ""} title={v === null && fb !== null ? "average over gateway requests" : idle ? "last measured" : undefined}>{f(x)}</span>;
};

export const LivePage = ({ machineId }: { machineId: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const liveEngines = useStore((s) => s.engines);
  const hist = useStore((s) => s.hist);
  const local = useStore((s) => s.requests);
  const fresh = useStore((s) => s.fresh);
  const stats = useStore((s) => s.stats);
  const now = useStore((s) => Math.floor(s.now / 60_000) * 60_000);
  const ms = useMemo(() => machines(fleet, live).filter((m) => m.online && m.snap && (!machineId || m.id === machineId)), [fleet, live, machineId]);
  const names = Object.fromEntries(ms.map((m) => [m.id, m.name]));
  const engines = ms.flatMap((m) =>
    m.snap!.engines.map((e) => {
      const rates: EngineRates = (m.self ? liveEngines[e.modelId] : undefined) ?? e;
      const card = m.snap!.cards.find((c) => c.modelId === e.modelId) ?? null;
      const idle = !rates.running && !(rates.generationTpsWall && rates.generationTpsWall > 0);
      return { m, e: rates, card, idle, model: m.snap!.models.find((x) => x.id === e.modelId) ?? null };
    }),
  );
  const reqs = [...local.filter((r) => r.via !== "peer" && names[r.machineId]), ...ms.flatMap((m) => (m.peerId ? (stats[m.id]?.reqs ?? []) : []))].sort((a, b) => b.tsStart - a.tsStart).slice(0, 80);
  const running = engines.reduce((t, x) => t + (x.e.running ?? 0), 0);
  const waiting = engines.reduce((t, x) => t + (x.e.waiting ?? 0), 0);
  const multi = ms.length > 1;
  const hs = ms.filter((m) => stats[m.id]?.health).map((m) => ({ m, h: stats[m.id]!.health! }));
  const timings = [...new Set(hs.flatMap(({ h }) => Object.keys(h.timings ?? {})))].sort();
  return (
    <div className="page">
      <SectionHeading aside={<span className="label">{`${running} running · ${waiting} waiting`}</span>}>engines</SectionHeading>
      <Table
        cols={[
          ...(multi ? [{ h: "machine", c: (x: (typeof engines)[number]) => x.m.name }] : []),
          { h: "model", c: (x) => <span className="cut">{x.model?.primaryModel ?? x.e.modelId}</span> },
          { h: "state", c: (x) => <span className={x.model?.state === "unhealthy" ? "alert" : ""}>{x.model ? `${x.model.engine} ${x.model.state}${x.idle ? ` · idle${x.e.lastActiveAt ? ` ${fmt.ago(x.e.lastActiveAt, Date.now())}` : ""}` : ""}` : "–"}</span> },
          { h: "run", n: true, c: (x) => String(x.e.running ?? "–") },
          { h: "wait", n: true, c: (x) => String(x.e.waiting ?? "–") },
          { h: "kv", n: true, c: (x) => fmt.pct(x.e.kvCacheUsage) },
          { h: "prefix hit", n: true, c: (x) => dim(x.e.prefixHitRate, x.card?.cacheHit ?? null, fmt.pct, x.idle) },
          { h: "spec accept", n: true, c: (x) => dim(x.e.specAcceptLength, null, num, x.idle) },
          { h: "decode", n: true, c: (x) => dim(x.e.decodeTps, x.card?.decodeTps ?? null, fmt.tps, x.idle) },
          { h: "prefill", n: true, c: (x) => dim(x.e.prefillTps, x.card?.prefillTps ?? null, fmt.tps, x.idle) },
          { h: "gen wall", n: true, c: (x) => fmt.tps(x.e.generationTpsWall) },
          { h: "ttft", n: true, c: (x) => dim(x.e.meanTtftMs, x.card?.meanTtftMs ?? null, fmt.ms, x.idle) },
          { h: "queue", n: true, c: (x) => fmt.ms(x.e.meanQueueMs) },
        ]}
        rows={engines}
        keyOf={(x) => `${x.m.id}/${x.e.modelId}`}
      />
      <GpuCharts samples={ms.map((m) => stats[m.id]?.gpus ?? [])} now={now} />
      <SectionHeading>gpus</SectionHeading>
      <GpuTable ms={ms} hist={hist} />
      <SectionHeading aside={<span className="label">p50 · p99</span>}>controller</SectionHeading>
      <Table
        cols={[
          { h: "machine", c: (x: (typeof hs)[number]) => x.m.name },
          { h: "up", n: true, c: (x) => fmt.dur(x.h.uptimeS) },
          { h: "in flight", n: true, c: (x) => String(x.h.gauges?.["gateway.inflight"] ?? "–") },
          { h: "sse", n: true, c: (x) => String(x.h.gauges?.["sse.clients"] ?? "–") },
          { h: "rss", n: true, c: (x) => `${Math.round(x.h.memory.rssMiB)} MiB` },
          { h: "lag max", n: true, c: (x) => fmt.ms(x.h.eventLoopLagMaxMs) },
          { h: "errors", n: true, c: (x) => (x.h.lastErrors?.length ? <span className="alert">{x.h.lastErrors.length}</span> : "0") },
          ...timings.map((k) => ({
            h: k.replace(/_ms$/, ""),
            n: true,
            c: (x: (typeof hs)[number]) => {
              const t = x.h.timings?.[k];
              return t ? `${fmt.ms(t.p50)} · ${fmt.ms(t.p99)}` : "–";
            },
          })),
        ]}
        rows={hs}
        keyOf={(x) => x.m.id}
      />
      <SectionHeading>requests</SectionHeading>
      <RequestsTable rows={reqs} fresh={fresh} machineNames={names} />
    </div>
  );
};
