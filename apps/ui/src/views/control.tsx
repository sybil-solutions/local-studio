import { useEffect, useMemo, useState } from "react";
import { type AgentLaunchResult, fmt, type RecipeRow } from "@local-studio/contracts/client";
import { call, get, post, via } from "../api";
import { cancelLaunch, ConnectDialog, ExportDialog, RecipeDialog, StopDialog, type Target } from "../components/actions";
import { Btn, Dialog, Err, Logo } from "../components/basics";
import { TokenLine } from "../components/cards";
import { H, Meter, Row, Sum } from "../components/panel";
import { aggOf, type CardView, gpuRow, homeCards, type MachineView, machines, mergeRecipes, resFig, resOf, resText } from "../model/view";
import { useStore } from "../store";
import { AgentsSection, useDefaultHarness } from "./agents";

type Slot = { n: number; gpu: string; recipe: RecipeRow };
type Avail = { key: string; m: MachineView; what: string; state: string; slot: Slot | null };
const KIND: Record<string, string> = { stt: "speech to text", tts: "text to speech", embedding: "embedding" };
const DESKTOP = /Electron/.test(navigator.userAgent);
const isSpark = (m: MachineView) => /^spark-/.test(m.name);

const freeSlots = (rows: RecipeRow[]): Slot[] => {
  const byN = new Map<number, RecipeRow>();
  const score = (x: RecipeRow) => (x.assigned ? 4 : 0) + (x.recommended ? 2 : 0);
  for (const r of rows.filter((r) => r.fit === "fits" && r.freeGroups.length > 0)) {
    const cur = byN.get(r.cards);
    if (!cur || score(r) > score(cur)) byN.set(r.cards, r);
  }
  return [...byN.entries()].sort((x, y) => x[0] - y[0]).map(([n, r]) => ({ n, gpu: r.freeGroups[0]![0]!, recipe: r }));
};

const powerOf = (ms: MachineView[]) => {
  const ws = ms.flatMap((m) => m.snap?.gpus ?? []).map((g) => g.powerW).filter((x): x is number => x !== null);
  return ws.length ? `${Math.round(ws.reduce((t, x) => t + x, 0))} W` : "–";
};

const availOf = (m: MachineView, recipes: RecipeRow[]): Avail[] => {
  const gname = (k: string) => m.snap?.gpus.find((x) => x.key === k)?.name ?? k;
  const n = (keys: string[]) => (keys.length > 1 ? `${keys.length} × ${gname(keys[0]!)}` : gname(keys[0]!));
  if (!m.online) return [{ key: m.id, m, what: m.gpuSummary, state: "offline", slot: null }];
  const groups = m.snap?.groups ?? [];
  const taken = new Set(groups.filter((x) => x.state === "foreign").flatMap((g) => g.gpuKeys));
  const slots = freeSlots(recipes.map((r) => ({ ...r, freeGroups: r.freeGroups.filter((g) => !g.some((k) => taken.has(k))) })));
  const free = [...new Set(groups.filter((x) => x.state === "available").flatMap((g) => g.gpuKeys))].filter((k) => !taken.has(k));
  const rows: Avail[] = slots.map((sl) => ({ key: `${m.id}:${sl.n}:${sl.recipe.id}`, m, what: sl.n > 1 ? `${sl.n} × ${gname(sl.gpu)}` : gname(sl.gpu), state: "free", slot: sl }));
  if (!slots.length && free.length) rows.push({ key: `${m.id}:free`, m, what: n(free), state: "free · no config fits", slot: null });
  for (const k of taken) rows.push({ key: `${m.id}:held:${k}`, m, what: gname(k), state: "in use", slot: null });
  return rows;
};

export const ControlPage = ({ sub, model }: { sub: string[]; model: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const recipes = useStore((s) => s.recipes);
  const engines = useStore((s) => s.engines);
  const error = useStore((s) => s.error);
  const [dlg, setDlg] = useState<{ k: "stop" | "export"; c: CardView } | { k: "recipe"; id: string } | { k: "connect" } | { k: "agent" } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    if (model) setDlg({ k: "agent" });
  }, [model]);
  const ms = useMemo(() => machines(fleet, live), [fleet, live]);
  const cards = useMemo(() => homeCards(ms, live, fleet?.self ?? null, recipes, engines), [ms, live, fleet, recipes, engines]);
  const rvs = useMemo(() => mergeRecipes(ms, recipes), [ms, recipes]);
  const dh = useDefaultHarness();
  if (!fleet) return <Err>{error ?? "connecting"}</Err>;

  const shown = cards.filter((c) => c.ready || c.launchId || !/not answering/.test(c.sub));
  const chat = shown.filter((c) => c.modality === "chat");
  const apis = shown.filter((c) => c.modality !== "chat");
  const a = aggOf(ms, engines);
  const target = (c: CardView): Target => ({ machineId: c.machineId, peerId: c.peerId, readOnly: c.readOnly });
  const hostOf = (id: string) => ms.find((m) => m.id === id)?.snap?.machine.hostname ?? null;
  const urlOf = (c: CardView) => {
    const h = hostOf(c.machineId);
    const u = c.endpoint ?? "";
    return h ? u.replace(/\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(?=[:/]|$)/, `//${h}`) : u;
  };
  const copy = (u: string) => {
    void navigator.clipboard?.writeText(u);
    setMsg(`copied ${u}`);
  };
  const open1 = async (c: CardView) => {
    if (!dh) return setDlg({ k: "agent" });
    setOpening(c.key);
    const r = await call<AgentLaunchResult>("POST", `/api/agents/launch?terminal=${DESKTOP ? "auto" : "none"}`, { harness: dh, model: c.servedModel ?? c.name }, 90_000);
    setOpening(null);
    if (!r.ok) return setMsg(`${dh}: ${r.error}`);
    if (r.data.url) window.open(r.data.url);
    setMsg(r.data.attach && !DESKTOP ? `${dh} on ${c.servedModel ?? c.name}: ${r.data.attach}` : null);
  };
  const openBtn = (c: CardView) =>
    c.ready && (
      <Btn kind="primary" onClick={() => void open1(c)} disabled={opening === c.key}>
        {opening === c.key ? "Opening" : `Open ${dh ?? "agent"} ›`}
      </Btn>
    );
  const stopBtn = (c: CardView) =>
    (c.modelId || c.launchId) && (
      <Btn kind="danger" onClick={() => (c.modelId ? setDlg({ k: "stop", c }) : c.launchId && void cancelLaunch(target(c), c.launchId).then(setMsg))} disabled={c.readOnly || !!c.stopBlocked}>
        Stop
      </Btn>
    );
  const figs = (c: CardView, more?: { v: string; k: string }[]) =>
    c.figs ? (
      <div className="p-figs">
        {[{ v: c.figs.total, k: "total" }, { v: c.figs.decode, k: "decode" }, { v: c.figs.prefill, k: "prefill" }, ...(more ?? [])].map((f) => (
          <span key={f.k}>
            <b>{f.v}</b>
            <span className="label">{f.k}</span>
          </span>
        ))}
      </div>
    ) : (
      <div className={c.subAlert ? "alert" : "label"}>{c.sub}</div>
    );

  const sparks = ms.filter(isSpark);
  const others = ms.filter((m) => !isSpark(m));
  const avail = [
    ...others.flatMap((m) => availOf(m, recipes[m.id] ?? [])),
    ...(() => {
      const rows = sparks.flatMap((m) => availOf(m, recipes[m.id] ?? []));
      if (sparks.length < 2) return rows;
      const free = rows.filter((x) => x.state.startsWith("free"));
      const best = free.find((x) => x.slot);
      return [
        {
          key: "pod:sparks",
          m: best?.m ?? sparks[0]!,
          what: `${free.length} of ${sparks.length} ${sparks[0]!.snap?.gpus[0]?.name ?? "nodes"} free`,
          state: free.length ? (best ? "free" : "free · no config fits") : "in use",
          slot: best?.slot ?? null,
        },
      ];
    })(),
  ];

  const dialogs = (
    <>
      <Err>{msg}</Err>
      {dlg?.k === "stop" && dlg.c.modelId && <StopDialog t={target(dlg.c)} modelId={dlg.c.modelId} name={dlg.c.name} watchdog={dlg.c.watchdog} blocked={dlg.c.stopBlocked} onClose={() => setDlg(null)} />}
      {dlg?.k === "export" && dlg.c.modelId && <ExportDialog t={target(dlg.c)} modelId={dlg.c.modelId} onClose={() => setDlg(null)} />}
      {dlg?.k === "recipe" && (() => {
        const v = rvs.find((x) => x.id === dlg.id);
        return v ? <RecipeDialog v={v} onClose={() => setDlg(null)} /> : null;
      })()}
      {dlg?.k === "connect" && <ConnectDialog onClose={() => setDlg(null)} />}
      {dlg?.k === "agent" && (
        <Dialog title="Agents" onClose={() => setDlg(null)} wide>
          <div className="page">
            <AgentsSection model={model} only="launch" />
          </div>
        </Dialog>
      )}
    </>
  );

  if (sub[0] === "model") {
    const c = shown.find((x) => x.key === sub[1]);
    if (!c) return <Gone>that model is no longer running</Gone>;
    const e = ms.find((m) => m.id === c.machineId)?.snap?.engines.find((x) => x.modelId === c.modelId);
    const rm = ms.find((m) => m.id === c.machineId)?.snap?.models.find((x) => x.id === c.modelId);
    return (
      <div className="panel">
        <Back />
        <div className="surface run p-card tall">
          <TokenLine values={c.line} h={200} />
          <div className="name">
            <Logo family={c.family} />
            <span className="ellipsis grow">{c.name}</span>
            <span className="label">{c.machine}</span>
          </div>
          {figs(c, [{ v: fmt.ms(e?.meanTtftMs ?? null), k: "ttft" }])}
        </div>
        <H>details</H>
        {[
          ["gpus", `${c.gpu}${c.mem ? ` · ${c.mem}` : ""}`],
          ["engine · quant", c.stack],
          ["context", rm?.contextWindow ? fmt.ctx(rm.contextWindow) : "–"],
          ["endpoint", urlOf(c) || "–"],
        ].map(([k, v]) => (
          <Row key={k}>
            <span className="label p-k">{k}</span>
            <span className="ink ellipsis">{v}</span>
          </Row>
        ))}
        <H>actions</H>
        <div className="btns">
          {openBtn(c)}
          <Btn onClick={() => setDlg({ k: "agent" })}>New agent ›</Btn>
          {c.modelId && <Btn onClick={() => setDlg({ k: "export", c })}>Save config</Btn>}
          {c.modelId && <Verify peerId={c.peerId} model={c.modelId} />}
          {stopBtn(c)}
        </div>
        {dialogs}
      </div>
    );
  }

  if (sub[0] === "machine") {
    const group = sub[1] === "sparks" ? sparks : ms.filter((m) => m.id === sub[1]);
    if (!group.length) return <Gone>no such machine</Gone>;
    return (
      <div className="panel">
        <Back />
        <H aside={powerOf(group)}>{sub[1] === "sparks" ? "sparks" : group[0]!.name}</H>
        {group.map((m) => (
          <div key={m.id}>
            {group.length > 1 && (
              <Row>
                <span className="ink">{m.name}</span>
                <span className="label">{m.online ? m.gpuSummary : "offline"}</span>
              </Row>
            )}
            {(m.snap?.gpus ?? []).map((g) => {
              const r = gpuRow(g, m.snap);
              return (
                <div key={g.key} className="p-gpu">
                  <span className="ink ellipsis">{r.name}</span>
                  <span>
                    <Meter pct={r.pct} />
                    <span className="label">{r.mem}</span>
                  </span>
                  <span>{g.utilPct === null ? "–" : `${Math.round(g.utilPct)}%`}</span>
                  <span>{g.powerW === null ? "–" : `${Math.round(g.powerW)} W`}</span>
                  <span className={`ellipsis ${r.statusAlert ? "alert" : "label"}`}>{r.status || "free"}</span>
                </div>
              );
            })}
          </div>
        ))}
        <H>system</H>
        {group.map((m) => {
          const r = resOf(m);
          const h = m.snap?.host;
          return (
            <div key={m.id}>
              {[
                ["cpu", h ? `${h.cpu.model} · ${h.cpu.threads} threads${h.cpu.utilPct === null ? "" : ` · ${Math.round(h.cpu.utilPct)}%`}` : "–"],
                ["ram free", resText(r.ram)],
                ["vram free", resText(r.vram ?? r.unified)],
                ["disk free", resText(r.disk)],
              ].map(([k, v]) => (
                <Row key={k}>
                  <span className="label p-k">{group.length > 1 ? `${m.name} · ${k}` : k}</span>
                  <span className="ink ellipsis">{v}</span>
                </Row>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="panel">
      <Sum
        cells={[
          { v: String(chat.filter((c) => c.ready).length), k: "running" },
          { v: fmt.tps(a.tps), k: "tok/s" },
          { v: powerOf(ms), k: "power" },
          { v: resFig(ms, "vram").v, k: "vram free" },
        ]}
      />
      <H aside={String(chat.length)}>running</H>
      {chat.length === 0 && <Row>–</Row>}
      {chat.map((c) => (
        <a key={c.key} className="surface run p-card" href={`#/control/model/${encodeURIComponent(c.key)}`}>
          <TokenLine values={c.line} h={140} />
          <div className="name">
            <Logo family={c.family} />
            <span className="ellipsis grow">{c.name}</span>
            <span className="label">{c.machine}</span>
          </div>
          {figs(c)}
          {c.progress !== null && (
            <div className="progress">
              <div style={{ width: `${c.progress}%` }} />
            </div>
          )}
          <div className="btns" onClick={(e) => e.preventDefault()}>
            {openBtn(c)}
            {!c.ready && stopBtn(c)}
          </div>
        </a>
      ))}
      <H>available</H>
      {avail.map((x) =>
        x.slot ? (
          <Row key={x.key} onClick={() => setDlg({ k: "recipe", id: x.slot!.recipe.id })} go={<span className="ink">{`run ${x.slot.recipe.name} ›`}</span>}>
            <span className="ink">{x.key === "pod:sparks" ? "sparks" : x.m.name}</span>
            <span className="label ellipsis">{x.what}</span>
          </Row>
        ) : (
          <Row key={x.key} go={<span className={x.state === "offline" ? "alert" : "label"}>{x.state}</span>}>
            <span>{x.key === "pod:sparks" ? "sparks" : x.m.name}</span>
            <span className="label ellipsis">{x.what}</span>
          </Row>
        ),
      )}
      {apis.length > 0 && (
        <>
          <H>endpoints</H>
          {apis.map((c) => (
            <Row key={c.key} onClick={() => copy(urlOf(c))} go={<span className="label">{`${urlOf(c)} · copy`}</span>}>
              <span className="ink">{c.name}</span>
              <span className="label ellipsis">{KIND[c.modality] ?? c.modality}</span>
            </Row>
          ))}
        </>
      )}
      <H
        aside={
          <button type="button" className="p-link" onClick={() => setDlg({ k: "agent" })}>
            {`${dh ?? "no"} default · harnesses ›`}
          </button>
        }
      >
        agents
      </H>
      <AgentsSection model={null} only="sessions" bare />
      <Row onClick={() => setDlg({ k: "agent" })}>
        <span className="label">+ new agent</span>
      </Row>
      <H
        aside={
          <button type="button" className="p-link" onClick={() => setDlg({ k: "connect" })}>
            connect ›
          </button>
        }
      >
        machines
      </H>
      {others.map((m) => (
        <Row key={m.id} onClick={() => (location.hash = `#/control/machine/${encodeURIComponent(m.id)}`)} go={<span className="label">{`${powerOf([m])} ›`}</span>}>
          <span className={m.online ? "ink" : "alert"}>{m.name}</span>
          <span className="label ellipsis">{m.online ? m.gpuSummary : "offline"}</span>
        </Row>
      ))}
      {sparks.length > 1 && (
        <Row onClick={() => (location.hash = "#/control/machine/sparks")} go={<span className="label">{`${powerOf(sparks)} ›`}</span>}>
          <span className="ink">sparks</span>
          <span className="label ellipsis">{`${sparks.length} × ${sparks[0]!.snap?.gpus[0]?.name ?? "node"} · ${sparks.filter((m) => m.online).length} online`}</span>
        </Row>
      )}
      {dialogs}
    </div>
  );
};

const Back = () => (
  <a className="p-back" href="#/control">
    ‹ control
  </a>
);

const Gone = ({ children }: { children: string }) => (
  <div className="panel">
    <Back />
    <Row>
      <span className="label">{children}</span>
    </Row>
  </div>
);

type LabView = { id: string; phase: string; detail: string; gates: Record<string, boolean>; proof: { tps: number; prefill: number | null } | null };

const Verify = ({ peerId, model }: { peerId: string | null; model: string }) => {
  const [run, setRun] = useState<LabView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!run || run.phase === "passed" || run.phase === "failed") return;
    const t = setTimeout(async () => {
      const r = await get<LabView>(via(peerId, `/api/lab/runs/${run.id}`));
      if (r.ok) setRun(r.data);
    }, 3000);
    return () => clearTimeout(t);
  }, [run, peerId]);
  const startRun = async () => {
    setErr(null);
    const r = await post<LabView>(via(peerId, "/api/lab/verify"), { model });
    if (r.ok) setRun(r.data);
    else setErr(r.error);
  };
  const busy = !!run && run.phase !== "passed" && run.phase !== "failed";
  return (
    <>
      <Btn onClick={() => void startRun()} disabled={busy}>
        {busy ? "Verifying" : "Verify ›"}
      </Btn>
      {run && (
        <span className={run.phase === "failed" ? "alert" : "label"}>
          {Object.entries(run.gates)
            .map(([g, ok]) => `${g} ${ok ? "✓" : "✗"}`)
            .join(" · ")}
          {run.proof ? ` · ${run.proof.tps} tok/s` : busy ? ` · ${run.detail}` : run.phase === "failed" && !Object.keys(run.gates).length ? run.detail : ""}
        </span>
      )}
      <Err>{err}</Err>
    </>
  );
};
