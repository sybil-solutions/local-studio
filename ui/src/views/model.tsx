import { useEffect, useMemo, useState } from "react";
import type { MetricsSummary, RequestRecord } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { get, post, via } from "../api";
import { ExportDialog } from "../components/actions";
import { Bar, BarMark, Btn, clock, Err, Figs, KV, Sec, Table } from "../components/basics";
import { Chart, hitText, hm, sliceHit, TtftChart } from "../components/charts";
import { engineFor, gpuLine, homeDir, hourBuckets, machines, shortGpu, tpsOf } from "../model/view";
import { useStore } from "../store";

const enc = encodeURIComponent;

export const ModelPage = ({ machineId, modelId }: { machineId: string; modelId: string }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const engines = useStore((s) => s.engines);
  const stats = useStore((s) => s.stats);
  const local = useStore((s) => s.requests);
  const now = useStore((s) => Math.floor(s.now / 60_000) * 60_000);
  const m = useMemo(() => machines(fleet, live).find((x) => x.id === machineId), [fleet, live, machineId]);
  const x = m?.snap?.models.find((y) => y.id === modelId);
  const names = x ? [...x.servedModels, x.primaryModel] : [];
  const [sum, setSum] = useState<MetricsSummary | null>(null);
  const [stop, setStop] = useState<"ask" | "busy" | null>(null);
  const [exp, setExp] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const peerId = m?.peerId ?? null;
  const key = names[0] ?? "";
  useEffect(() => {
    if (!key) return;
    const load = () => void get<MetricsSummary>(via(peerId, `/api/metrics/summary?window=24h&model=${enc(key)}`)).then((r) => setSum(r.ok && typeof r.data?.requests === "number" ? r.data : null));
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [peerId, key]);
  if (!m || !m.snap) return <Err>{fleet ? "–" : "connecting"}</Err>;
  const s = m.snap;
  if (!x)
    return (
      <div className="crumb">
        <a className="label" href="#/">
          fleet ›
        </a>
        <a className="label" href={`#/m/${enc(m.id)}`}>
          {m.name} ›
        </a>
        <span className="title">–</span>
      </div>
    );
  const e = engineFor(s, x.id, engines, m.self);
  const gpus = s.gpus.filter((g) => x.gpuKeys.includes(g.key));
  const reqs = (m.peerId ? (stats[m.id]?.reqs ?? []) : local.filter((r) => r.via !== "peer" && r.machineId === m.id)).filter((r) => names.includes(r.model));
  const hours = hourBuckets((stats[m.id]?.hourly ?? []).filter((r) => names.includes(r.model)), [], now);
  const decode = hours.map((b) => (b.decodeMs > 0 ? b.decodeTokens / (b.decodeMs / 1000) : 0));
  const doStop = async () => {
    setStop("busy");
    const r = await post(via(m.peerId, `/api/models/${enc(x.id)}/stop`), { confirm: x.id, ...(x.watchdog ? { force: true } : {}) });
    setStop(null);
    setErr(r.ok ? null : r.error);
  };
  const ready = x.state === "ready";
  const rt = x.runtime;
  return (
    <>
      <div className="crumb">
        <a className="label" href="#/">
          fleet ›
        </a>
        <a className="label" href={`#/m/${enc(m.id)}`}>
          {m.name} ›
        </a>
        <span className="title">
          <BarMark mark={ready ? "ready" : x.state === "unhealthy" ? "failed" : "busy"} />
          {x.primaryModel || x.id}
        </span>
        <span className="label">{[`${x.engine} ${(x.engineVersion ?? "").split("+")[0]}`.trim(), gpuLine(gpus), x.contextWindow ? `ctx ${fmt.ctx(x.contextWindow)}` : "", `${x.state} ${fmt.dur((now - x.stateSince) / 1000)}`].filter(Boolean).join("   ")}</span>
        <span className="btns">
          {ready && !x.embedding && <Btn href={`#/agents?model=${enc(key)}`}>Agent ›</Btn>}
          <Btn kind="danger" onClick={() => setStop("ask")} disabled={m.readOnly || !!x.stopBlocked || stop !== null}>
            Stop
          </Btn>
        </span>
      </div>
      {stop && (
        <div className="confirm">
          <span>{`Stop ${x.primaryModel || x.id} on ${m.name}?`}</span>
          {x.watchdog && <span className="alert">{x.watchdog}</span>}
          <span className="btns">
            <Btn onClick={() => setStop(null)}>Cancel</Btn>
            <Btn kind="danger" onClick={() => void doStop()} disabled={stop === "busy"}>
              {stop === "busy" ? "Stopping" : "Stop"}
            </Btn>
          </span>
        </div>
      )}
      <Err>{err ?? x.stopBlocked ?? (x.state === "unhealthy" ? x.error : null)}</Err>
      <Figs
        cells={[
          [fmt.tps(tpsOf(e)), "tok/s now"],
          [fmt.tps(sum?.decodeTps), "decode 24h"],
          [fmt.ms(sum?.ttftMs.p50), "ttft p50"],
          [sum ? sliceHit(sum) : "–", "cache hit"],
          [fmt.pct(e?.kvCacheUsage, 0), "kv cache"],
          [e?.running === null || e?.running === undefined ? "–" : `${e.running}/${e.waiting ?? 0}`, "run/wait"],
          [sum ? `${sum.errors ? `${sum.errors} / ` : ""}${fmt.k(sum.requests)}` : "–", sum?.errors ? "errors / req 24h" : "requests 24h", sum?.errors ? "alert" : ""],
        ]}
      />
      <div className="cols">
        <div>
          <Sec aside={<button type="button" className="btn quiet" onClick={() => setExp(true)}>Export</button>}>runtime</Sec>
          <KV
            rows={[
              ["served", x.servedModels.join(", ") || "–"],
              ["runtime", rt.kind === "docker" ? `${rt.containerName}  ${rt.image.replace(/@sha256:(.{12}).*/, "@$1")}` : rt.kind === "native" ? `pid ${rt.pid}  ${homeDir(rt.exe)}` : rt.note],
              ["endpoint", `:${x.port} ${x.nativeDialects.join(" ")}`],
              ["recipe", x.recipeId ?? x.origin],
              ["since", x.startedAt ? `${clock(x.startedAt)} ${fmt.ago(x.startedAt, now)}` : "–"],
              ...(x.watchdog ? [["watchdog", x.watchdog] as [string, string]] : []),
            ]}
          />
        </div>
        <div>
          <Sec>gpus</Sec>
          <Table
            cols={[
              { h: "gpu", c: (g: (typeof gpus)[number]) => `${g.index} ${shortGpu(g)}` },
              { h: "util", c: (g) => (g.utilPct === null ? "–" : <span className="row-flex"><Bar pct={g.utilPct} />{`${Math.round(g.utilPct)}%`}</span>) },
              { h: "memory", n: true, c: (g) => (g.memUsedMiB === null ? fmt.gb(g.memTotalMiB) : `${Math.round(g.memUsedMiB / 1024)}/${Math.round(g.memTotalMiB / 1024)}G`) },
              { h: "temp", n: true, w: true, c: (g) => (g.tempC === null ? "–" : `${Math.round(g.tempC)}°`) },
              { h: "power", n: true, w: true, c: (g) => (g.powerW === null ? "–" : `${Math.round(g.powerW)} W`) },
            ]}
            rows={gpus}
            keyOf={(g) => g.key}
          />
        </div>
      </div>
      <div className="cols">
        <div>
          <Sec aside={<span className="label">24h</span>}>clients</Sec>
          <Table
            cols={[
              { h: "client", c: (c: MetricsSummary["byClient"][number]) => <span className="ink">{c.key}</span> },
              { h: "requests", n: true, c: (c) => (c.errors ? <span><span className="alert">{`${c.errors} err `}</span>{fmt.k(c.requests)}</span> : fmt.k(c.requests)) },
              { h: "tokens", n: true, w: true, c: (c) => fmt.k(c.promptTotal + c.output) },
              { h: "cache", n: true, c: (c) => sliceHit(c) },
              { h: "tok/s", n: true, c: (c) => fmt.tps(c.decodeTps) },
              { h: "ttft", n: true, w: true, c: (c) => fmt.ms(c.meanTtftMs) },
            ]}
            rows={sum?.byClient ?? []}
            keyOf={(c) => c.key}
          />
        </div>
        <div className="cols">
          <Chart title="decode tok/s" aside={fmt.tps(sum?.decodeTps)} s={[decode]} labels={[hm(hours[0]!.at), hm(hours[23]!.at)]} tips={hours.map((b, i) => `${hm(b.at)}  ${fmt.tps(decode[i])} tok/s  ${b.requests} req`)} />
          <TtftChart values={reqs.map((r) => r.ttftMs).filter((v): v is number => v !== null)} p50={sum?.ttftMs.p50} p90={sum?.ttftMs.p90} />
        </div>
      </div>
      <Sec aside={<span className="label">{reqs.length ? `last ${Math.min(reqs.length, 20)}` : ""}</span>}>requests</Sec>
      <Table
        cols={[
          { h: "time", c: (r: RequestRecord) => clock(r.tsStart) },
          { h: "client", w: true, c: (r) => r.client },
          { h: "status", c: (r) => (r.errorCode ? <span title={r.errorMessage ?? ""}>{`${r.status} ${r.errorCode}`}</span> : `${r.status} ${r.finish}`) },
          { h: "in", n: true, w: true, c: (r) => fmt.k(r.inputUncached + r.cacheWrite) },
          { h: "cached", n: true, w: true, c: (r) => (r.cacheSource === null ? "–" : `${fmt.k(r.cacheRead)} ${hitText(r.cacheRead, r.promptTotal)}`) },
          { h: "out", n: true, c: (r) => fmt.k(r.output) },
          { h: "ttft", n: true, c: (r) => fmt.ms(r.ttftMs) },
          { h: "tok/s", n: true, c: (r) => fmt.tps(r.decodeTps) },
        ]}
        rows={reqs.slice(0, 20)}
        keyOf={(r) => r.id}
        rowClass={(r) => (r.errorCode ? "err" : "")}
      />
      {exp && <ExportDialog peerId={m.peerId} modelId={x.id} readOnly={m.readOnly} onClose={() => setExp(false)} />}
    </>
  );
};
