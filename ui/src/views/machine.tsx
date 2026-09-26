import { useMemo, useState } from "react";
import type { Endpoint } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { LaunchDialog } from "../components/actions";
import { BarMark, Empty, FieldRow, SectionHeading, Table } from "../components/basics";
import { GpuRow, SlotRow } from "../components/cards";
import { gpuRow, machines, type SlotView, slots, tsMs } from "../model/view";
import { setState, useStore } from "../store";

const ENDPOINT_KIND: Record<Endpoint["kind"], string> = {
  "auth-proxy": "auth-gated proxy, not a model",
  "openai-proxy": "OpenAI proxy, not a model",
  "unknown-http": "http, not a model",
};

export const MachinePage = ({ machineId }: { machineId: string }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const recipes = useStore((s) => s.recipes);
  const dismissed = useStore((s) => s.dismissed);
  const now = useStore((s) => s.now);
  const [run, setRun] = useState<SlotView | null>(null);
  const mv = useMemo(() => machines(fleet, live).find((m) => m.id === machineId) ?? null, [fleet, live, machineId]);
  if (!mv) return <Empty head={`no machine ${machineId}`} />;
  const s = mv.snap;
  const all = slots(mv, recipes[mv.id] ?? null, live, fleet?.self ?? null, dismissed).filter((x) => x.rank < 1 || x.rank === 2);
  const lastScan = tsMs(s?.discovery.lastScanAt);
  return (
    <div className="cols">
      <div className="col">
        <div className="gut gap-top">
          <a className="value" href="#/home">
            ‹ home
          </a>
        </div>
        <div className="hero">
          <div className="name">
            <BarMark mark={mv.online ? mv.mark : "failed"} />
            {mv.name}
            {mv.self && <span className="label small">this controller</span>}
          </div>
          <div className="chips value">
            <span>{s?.machine.platform ?? "–"}</span>
            <span>v{s?.machine.version ?? "–"}</span>
            <span className="label">{s?.machine.url ?? ""}</span>
            {mv.readOnly && <span className="badge">read-only</span>}
            {!mv.online && <span className="badge alert">offline</span>}
          </div>
          {mv.error && <div className="alert">{mv.error}</div>}
        </div>
        <SectionHeading>gpus</SectionHeading>
        {s?.gpus.length ? s.gpus.map((g) => <GpuRow key={g.key} g={gpuRow(g, s, false)} />) : <div className="note gap-block">no GPU reported</div>}
        {all.length > 0 && <SectionHeading>available</SectionHeading>}
        {all.map((x) => (
          <SlotRow
            key={x.key}
            s={x}
            showMachine={false}
            onRun={setRun}
            onDismiss={(y) => y.launchId && setState((st) => ({ dismissed: new Set([...st.dismissed, y.launchId!]) }))}
          />
        ))}
        <SectionHeading>watchdogs</SectionHeading>
        {s?.machine.watchdogs.length ? (
          s.machine.watchdogs.map((w) => <FieldRow key={`${w.name}${w.pid}`} label={w.name} value={`${w.pid ? `pid ${w.pid} · ` : ""}${w.note}`} />)
        ) : (
          <div className="note gap-block">none</div>
        )}
        <SectionHeading>discovery</SectionHeading>
        <FieldRow label="last scan" value={lastScan ? `${fmt.ago(lastScan, now)} · ${fmt.ms(s?.discovery.scanMs)}` : "–"} />
        <FieldRow label="docker" value={s?.discovery.docker ?? "–"} />
        {(s?.discovery.errors ?? []).map((e) => (
          <div className="note alert" key={e}>
            {e}
          </div>
        ))}
      </div>
      <div className="col">
        <SectionHeading>models</SectionHeading>
        <Table
          cols={[
            { h: "id", c: (m) => <a className="ink" href={`#/model/${encodeURIComponent(mv.id)}/${encodeURIComponent(m.id)}`}>{m.id}</a> },
            { h: "serves", c: (m) => <span className="cut" title={m.servedModels.join(", ")}>{m.servedModels.join(", ") || m.primaryModel}</span> },
            { h: "engine", c: (m) => m.engine },
            { h: "state", c: (m) => <span className={m.state === "unhealthy" ? "alert" : ""}>{m.state}</span> },
            { h: "origin", c: (m) => m.origin },
            { h: "port", n: true, c: (m) => String(m.port) },
            { h: "gpus", c: (m) => m.gpuKeys.join(" ") },
            { h: "stop", c: (m) => (m.stopBlocked ? <span className="label" title={m.stopBlocked}>unavailable</span> : "yes") },
            { h: "ctx", n: true, c: (m) => fmt.ctx(m.contextWindow) },
          ]}
          rows={s?.models ?? []}
          keyOf={(m) => m.id}
          empty="no model running"
        />
        <SectionHeading>endpoints</SectionHeading>
        <Table<Endpoint>
          cols={[
            { h: "port", n: true, c: (e) => String(e.port) },
            { h: "bind", c: (e) => e.bind },
            { h: "what", c: (e) => ENDPOINT_KIND[e.kind] ?? e.kind },
            { h: "process", c: (e) => `${e.process ?? "–"}${e.pid ? ` (${e.pid})` : ""}` },
            { h: "note", c: (e) => e.note },
          ]}
          rows={s?.endpoints ?? []}
          keyOf={(e) => `${e.bind}:${e.port}`}
          empty="no other listeners"
        />
        <details className="gap-block">
          <summary className="label gut" style={{ cursor: "pointer" }}>
            gpu processes
          </summary>
          <Table
          cols={[
            { h: "gpu", c: (p: { g: string; pid: number; name: string; mib: number; model: string | null }) => p.g },
            { h: "pid", n: true, c: (p) => String(p.pid) },
            { h: "process", c: (p) => p.name },
            { h: "memory", n: true, c: (p) => fmt.gb(p.mib) },
            { h: "model", c: (p) => p.model ?? "–" },
          ]}
          rows={(s?.gpus ?? []).flatMap((g) => g.processes.map((p) => ({ g: g.key, pid: p.pid, name: p.processName, mib: p.usedMiB, model: p.modelId })))}
          keyOf={(p) => `${p.g}/${p.pid}`}
          empty="no compute processes"
          />
        </details>
      </div>
      {run?.run && (
        <LaunchDialog
          t={{ machineId: mv.id, peerId: mv.peerId, readOnly: mv.readOnly }}
          recipe={recipes[mv.id]?.find((r) => r.id === run.run!.recipeId) ?? null}
          recipeId={run.run.recipeId}
          gpuKeys={run.run.gpuKeys}
          onClose={() => setRun(null)}
        />
      )}
    </div>
  );
};
