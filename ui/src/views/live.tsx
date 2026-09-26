import { useEffect, useMemo, useState } from "react";
import type { ControllerHealth, EngineRates, RequestRecord } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { get, via } from "../api";
import { SectionHeading, Table } from "../components/basics";
import { RequestsTable } from "../components/requests";
import { gpuRow, launchesFor, machines } from "../model/view";
import { useStore } from "../store";

const Spark = ({ v }: { v: number[] }) =>
  v.length < 2 ? null : (
    <svg className="spark" viewBox="0 0 90 14" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={v.map((x, i) => `${(i * 90) / (v.length - 1)},${13 - (Math.min(100, x) / 100) * 12}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );

const Bar = ({ pct }: { pct: number | null }) => (
  <span className="mini">
    <i style={{ width: `${pct ?? 0}%` }} />
  </span>
);

const num = (x: number | null, d = 2) => (x === null ? "–" : x.toFixed(d));

export const LivePage = () => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const liveEngines = useStore((s) => s.engines);
  const hist = useStore((s) => s.hist);
  const local = useStore((s) => s.requests);
  const fresh = useStore((s) => s.fresh);
  const ms = useMemo(() => machines(fleet, live).filter((m) => m.online && m.snap), [fleet, live]);
  const [peerReq, setPeerReq] = useState<Record<string, RequestRecord[]>>({});
  const [health, setHealth] = useState<Record<string, ControllerHealth>>({});
  const keys = ms.map((m) => `${m.id}:${m.peerId ?? ""}`).join(",");
  useEffect(() => {
    const load = () =>
      keys.split(",").forEach((k) => {
        const [id = "", p = ""] = k.split(":");
        const peer = p || null;
        void get<ControllerHealth>(via(peer, "/api/health/detail")).then((r) => r.ok && r.data?.memory && setHealth((x) => ({ ...x, [id]: r.data })));
        if (peer) void get<RequestRecord[]>(via(peer, "/api/metrics/requests?limit=50")).then((r) => r.ok && Array.isArray(r.data) && setPeerReq((x) => ({ ...x, [id]: r.data })));
      });
    if (keys) load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [keys]);
  const names = Object.fromEntries(ms.map((m) => [m.id, m.name]));
  const gpus = ms.flatMap((m) => m.snap!.gpus.map((g) => ({ m, g, r: gpuRow(g, m.snap) })));
  const engines = ms.flatMap((m) =>
    m.snap!.engines.map((e) => {
      const rates: EngineRates = (m.self ? liveEngines[e.modelId] : undefined) ?? e;
      return { m, e: rates, model: m.snap!.models.find((x) => x.id === e.modelId) ?? null };
    }),
  );
  const launches = ms.flatMap((m) => launchesFor(m.snap, live, fleet?.self ?? null).filter((l) => !["ready", "failed", "cancelled"].includes(l.phase)).map((l) => ({ m, l })));
  const reqs = [...local.filter((r) => r.via !== "peer"), ...Object.values(peerReq).flat()].sort((a, b) => b.tsStart - a.tsStart).slice(0, 60);
  const running = engines.reduce((t, x) => t + (x.e.running ?? 0), 0);
  const waiting = engines.reduce((t, x) => t + (x.e.waiting ?? 0), 0);
  const multi = ms.length > 1;
  const hs = ms.filter((m) => health[m.id]).map((m) => ({ m, h: health[m.id]! }));
  const timings = hs.flatMap(({ m, h }) => Object.entries(h.timings).map(([k, t]) => ({ m, k, t })));
  const errors = hs.flatMap(({ m, h }) => h.lastErrors.map((e) => ({ m, e }))).slice(0, 10);
  return (
    <>
      <SectionHeading aside={<span className="label">{ms.length} machine{ms.length === 1 ? "" : "s"} · {gpus.length} GPUs</span>}>gpus</SectionHeading>
      <Table
        cols={[
          ...(multi ? [{ h: "machine", c: (x: (typeof gpus)[number]) => x.m.name }] : []),
          { h: "gpu", c: (x) => <span title={x.g.key}>{x.r.name}</span> },
          { h: "util", n: true, c: (x) => (x.g.utilPct === null ? "–" : `${Math.round(x.g.utilPct)}%`) },
          { h: "history", c: (x) => <Spark v={hist[`${x.m.id}/${x.g.key}`] ?? []} /> },
          { h: "memory", c: (x) => <span className="row-flex"><Bar pct={x.r.pct} />{x.r.mem}</span> },
          { h: "power", n: true, c: (x) => (x.g.powerW === null ? "–" : `${Math.round(x.g.powerW)}${x.g.powerLimitW ? ` / ${Math.round(x.g.powerLimitW)}` : ""} W`) },
          { h: "temp", n: true, c: (x) => x.r.temp || "–" },
          { h: "holds", c: (x) => <span className={`cut ${x.r.statusAlert ? "alert" : "label"}`} title={x.r.status}>{x.r.status || "idle"}</span> },
        ]}
        rows={gpus}
        keyOf={(x) => `${x.m.id}/${x.g.key}`}
        empty="no GPU reported"
      />
      <SectionHeading aside={<span className="label">in flight {running} running · {waiting} waiting</span>}>engines</SectionHeading>
      <Table
        cols={[
          ...(multi ? [{ h: "machine", c: (x: (typeof engines)[number]) => x.m.name }] : []),
          { h: "model", c: (x) => <span className="cut" title={x.e.modelId}>{x.model?.primaryModel ?? x.e.modelId}</span> },
          { h: "state", c: (x) => <span className={x.model?.state === "unhealthy" ? "alert" : ""}>{x.model ? `${x.model.engine} ${x.model.state}` : "–"}</span> },
          { h: "run", n: true, c: (x) => String(x.e.running ?? "–") },
          { h: "wait", n: true, c: (x) => String(x.e.waiting ?? "–") },
          { h: "KV", n: true, c: (x) => fmt.pct(x.e.kvCacheUsage) },
          { h: "prefix hit", n: true, c: (x) => fmt.pct(x.e.prefixHitRate) },
          { h: "spec accept", n: true, c: (x) => num(x.e.specAcceptLength) },
          { h: "decode", n: true, c: (x) => fmt.tps(x.e.decodeTps) },
          { h: "prefill", n: true, c: (x) => fmt.tps(x.e.prefillTps) },
          { h: "gen wall", n: true, c: (x) => fmt.tps(x.e.generationTpsWall) },
          { h: "ttft", n: true, c: (x) => fmt.ms(x.e.meanTtftMs) },
          { h: "queue", n: true, c: (x) => fmt.ms(x.e.meanQueueMs) },
        ]}
        rows={engines}
        keyOf={(x) => `${x.m.id}/${x.e.modelId}`}
        empty="no engine is reporting metrics"
      />
      {launches.length > 0 && (
        <>
          <SectionHeading>launches</SectionHeading>
          <Table
            cols={[
              { h: "machine", c: (x: (typeof launches)[number]) => x.m.name },
              { h: "recipe", c: (x) => x.l.recipeId },
              { h: "phase", c: (x) => `${x.l.phase}${x.l.percent !== null ? ` · ${Math.round(x.l.percent)}%` : ""}` },
              { h: "detail", c: (x) => x.l.detail },
            ]}
            rows={launches}
            keyOf={(x) => x.l.launchId}
          />
        </>
      )}
      <SectionHeading>controller</SectionHeading>
      <Table
        cols={[
          { h: "machine", c: (x: (typeof hs)[number]) => x.m.name },
          { h: "up", n: true, c: (x) => fmt.dur(x.h.uptimeS) },
          { h: "in flight", n: true, c: (x) => String(x.h.gauges["gateway.inflight"] ?? "–") },
          { h: "sse", n: true, c: (x) => String(x.h.gauges["sse.clients"] ?? "–") },
          { h: "rss", n: true, c: (x) => `${Math.round(x.h.memory.rssMiB)} MiB` },
          { h: "heap", n: true, c: (x) => `${Math.round(x.h.memory.heapUsedMiB)} MiB` },
          { h: "loop lag max", n: true, c: (x) => fmt.ms(x.h.eventLoopLagMaxMs) },
          { h: "errors", n: true, c: (x) => (x.h.lastErrors.length ? <span className="alert">{x.h.lastErrors.length}</span> : "0") },
        ]}
        rows={hs}
        keyOf={(x) => x.m.id}
        empty="controller health not available"
      />
      <Table
        cols={[
          ...(multi ? [{ h: "machine", c: (x: (typeof timings)[number]) => x.m.name }] : []),
          { h: "timing", c: (x) => x.k },
          { h: "n", n: true, c: (x) => fmt.k(x.t.n) },
          { h: "p50", n: true, c: (x) => fmt.ms(x.t.p50) },
          { h: "p90", n: true, c: (x) => fmt.ms(x.t.p90) },
          { h: "p99", n: true, c: (x) => fmt.ms(x.t.p99) },
          { h: "last", n: true, c: (x) => fmt.ms(x.t.last) },
        ]}
        rows={timings}
        keyOf={(x) => `${x.m.id}/${x.k}`}
        empty=""
      />
      {errors.map(({ m, e }) => (
        <div className="note alert ellipsis" key={`${m.id}${e.at}${e.where}`} title={e.message}>
          {new Date(e.at).toLocaleTimeString()} {m.name} {e.where}: {e.message.split("\n")[0]}
        </div>
      ))}
      <SectionHeading aside={<span className="label">gateway, newest first</span>}>requests</SectionHeading>
      <RequestsTable rows={reqs} fresh={fresh} machineNames={names} />
    </>
  );
};
