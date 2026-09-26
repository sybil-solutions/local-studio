import { useEffect, useMemo, useState } from "react";
import type { MetricsSummary, RequestRecord } from "@local-studio/contracts/client";
import { ERROR_CODES, fmt } from "@local-studio/contracts/client";
import { get, via } from "../api";
import { ExportDialog, LogsDialog, StopDialog, type Target } from "../components/actions";
import { Btn, Chips, Empty, Err, FieldRow, Logo, SectionHeading, Table } from "../components/basics";
import { FigureGrid, GpuRow, Pills, TokenLine } from "../components/cards";
import { RequestsTable } from "../components/requests";
import { dayLabel, family, figures, gpuRow, heroChips, machines, tsMs } from "../model/view";
import { useStore } from "../store";

export const ModelPage = ({ machineId, modelId }: { machineId: string; modelId: string }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const now = useStore((s) => s.now);
  const allReq = useStore((s) => s.requests);
  const fresh = useStore((s) => s.fresh);
  const engines = useStore((s) => s.engines);
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [sumErr, setSumErr] = useState<string | null>(null);
  const [peerReq, setPeerReq] = useState<RequestRecord[] | null>(null);
  const [dlg, setDlg] = useState<"stop" | "export" | "logs" | null>(null);

  const mv = useMemo(() => machines(fleet, live).find((m) => m.id === machineId) ?? null, [fleet, live, machineId]);
  const s = mv?.snap ?? null;
  const m = s?.models.find((x) => x.id === modelId) ?? null;
  const served = m?.servedModels[0] ?? m?.primaryModel ?? null;
  const peerId = mv?.peerId ?? null;

  useEffect(() => {
    if (!served) return;
    let on = true;
    const load = () =>
      get<MetricsSummary>(via(peerId, `/api/metrics/summary?window=7d&model=${encodeURIComponent(served)}`)).then((r) => {
        if (!on) return;
        if (r.ok && r.data && typeof r.data.requests === "number") {
          setSummary(r.data);
          setSumErr(null);
        } else setSumErr(r.ok ? "summary unavailable" : r.error);
      });
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [peerId, served]);

  useEffect(() => {
    if (!peerId) return;
    void get<RequestRecord[]>(via(peerId, "/api/metrics/requests?limit=200")).then((r) => setPeerReq(r.ok && Array.isArray(r.data) ? r.data : []));
  }, [peerId]);

  if (!mv || !s || !m)
    return (
      <>
        <div className="top gap-top">
          <a className="value" href="#/home">
            ‹ home
          </a>
        </div>
        <Empty head={`${modelId} is not running on ${mv?.name ?? machineId}`} />
      </>
    );

  const st = s.cards.find((c) => c.modelId === m.id) ?? null;
  const engine = (mv.self ? engines[m.id] : undefined) ?? s.engines.find((e) => e.modelId === m.id) ?? null;
  const reqs = (peerId ? peerReq ?? [] : allReq).filter((r) => (r.model ? m.servedModels.includes(r.model) : r.modelId === m.id)).slice(0, 25);
  const line = st?.line ?? [];
  const top = line.length ? line[line.length - 1]! : 0;
  const last = tsMs(st?.last);
  const t: Target = { machineId: mv.id, peerId, readOnly: mv.readOnly };
  const gateway = `${location.origin}/v1`;
  const errs = summary ? ERROR_CODES.filter((c) => (summary.errorsByCode[c] ?? 0) > 0) : [];
  const rt = m.runtime;
  const kv = m.cache
    ? [m.cache.kvCacheTokens ? `${fmt.k(m.cache.kvCacheTokens)} tokens` : "", m.cache.blockSize ? `block ${m.cache.blockSize}` : "", m.cache.kvCacheDtype ?? "", m.cache.prefixCaching ? "prefix caching" : ""]
        .filter(Boolean)
        .join("  ")
    : "";

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
          <Logo family={family(m.primaryModel)} size={14} />
          <span className="ellipsis" title={m.primaryModel}>
            {m.primaryModel}
          </span>
          <span className="label small">on {mv.name}</span>
        </div>
        <Chips chips={heroChips(m, s)} className="value" />
        {m.state !== "ready" && <div className={m.state === "unhealthy" ? "alert" : "value"}>{m.state}{m.error ? ` · ${m.error}` : ""}</div>}
      </div>
      <div className="hero-chart glow">
        <TokenLine values={line} h={110} />
        <span className="t" style={{ left: "var(--pad)", top: 8 }}>
          {top > 0 ? `${fmt.k(top)} gateway tokens` : "no gateway traffic"}
        </span>
        <span className="t" style={{ left: "var(--pad)", top: "45%" }}>
          {fmt.k(Math.round(top / 2))}
        </span>
        <span className="t" style={{ left: "var(--pad)", bottom: 8 }}>
          {st?.since ? dayLabel(st.since) : ""}
        </span>
        <span className="t" style={{ right: "var(--pad)", bottom: 8 }}>
          {last ? fmt.ago(last, now) : "–"}
        </span>
      </div>
      <FigureGrid cells={figures(m, st, now, engine)} />
      <Pills s={summary} engine={engine} title={`${served} · last 7 days · gateway, engine-wide rates below`} />
      {sumErr && !summary && <div className="note gap-block">gateway summary: {sumErr}</div>}

      <SectionHeading>gpus</SectionHeading>
      {s.gpus
        .filter((g) => m.gpuKeys.includes(g.key))
        .map((g) => (
          <GpuRow key={g.key} g={gpuRow(g, null)} />
        ))}

      <SectionHeading>reach</SectionHeading>
      <FieldRow icon="machine" label="gateway" value={gateway} copy={gateway} />
      <FieldRow icon="agent" label="model" value={served ?? m.id} copy={served ?? m.id} />
      <FieldRow icon="tailnet" label="engine" value={m.baseUrl} />

      <SectionHeading>runtime</SectionHeading>
      {rt.kind === "docker" ? (
        <>
          <FieldRow label="container" value={`${rt.containerName} · ${rt.containerId.slice(0, 12)}`} />
          <FieldRow label="image" value={rt.imageDigest ? `${rt.image.split("@")[0]}@${rt.imageDigest.slice(0, 19)}…` : rt.image} />
        </>
      ) : rt.kind === "native" ? (
        <FieldRow label="process" value={`pid ${rt.pid} · ${rt.exe}`} />
      ) : (
        <FieldRow label="process" value={rt.note} />
      )}
      {kv && <FieldRow label="kv cache" value={kv} />}
      <FieldRow label="origin" value={`${m.origin}${m.recipeId ? ` · ${m.recipeId}` : ""}`} />
      {m.watchdog && <FieldRow label="watchdog" value={<span className="alert">{m.watchdog} may restart this</span>} />}
      {m.argv.length > 0 && (
        <details className="gut gap-block">
          <summary className="label" style={{ cursor: "pointer" }}>
            host argv
          </summary>
          <pre className="pre" style={{ marginTop: 6 }}>
            {m.argv.join(" ")}
          </pre>
        </details>
      )}

      <Err>{m.error}</Err>
      <div className="btns gut" style={{ marginTop: "var(--group)" }}>
        <Btn onClick={() => setDlg("logs")}>View logs</Btn>
        <Btn onClick={() => setDlg("export")}>Export recipe</Btn>
        <Btn kind="danger" onClick={() => setDlg("stop")} disabled={mv.readOnly || !!m.stopBlocked} title={mv.readOnly ? "read-only controller" : m.stopBlocked ?? undefined}>
          Stop model
        </Btn>
      </div>
      {mv.readOnly && <div className="note gap-block">read-only: stop and launch are refused by this controller.</div>}
      {!mv.readOnly && m.stopBlocked && <div className="note gap-block">stop unavailable: {m.stopBlocked}</div>}
      {!mv.readOnly && m.watchdog && <div className="note gap-block alert">a watchdog ({m.watchdog}) may restart this model after a stop.</div>}

      </div>
      <div className="col">
      <SectionHeading aside={<span className="label">gateway, 7 days</span>}>errors by code</SectionHeading>
      <Table
        cols={[
          { h: "code", c: (c: string) => <span className="alert">{c}</span> },
          { h: "count", n: true, c: (c: string) => String(summary?.errorsByCode[c as (typeof ERROR_CODES)[number]] ?? 0) },
        ]}
        rows={errs}
        keyOf={(c) => c}
        empty={summary ? `no errors in ${fmt.k(summary.requests)} requests` : "–"}
      />

      <SectionHeading aside={<span className="label">gateway</span>}>recent requests</SectionHeading>
      <RequestsTable rows={reqs} fresh={fresh} />

      </div>
      {dlg === "stop" && <StopDialog t={t} modelId={m.id} name={m.primaryModel} watchdog={m.watchdog} blocked={m.stopBlocked} onClose={() => setDlg(null)} />}
      {dlg === "export" && <ExportDialog t={t} modelId={m.id} onClose={() => setDlg(null)} />}
      {dlg === "logs" && <LogsDialog t={t} modelId={m.id} onClose={() => setDlg(null)} />}
    </div>
  );
};
