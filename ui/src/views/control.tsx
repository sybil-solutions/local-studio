import { useEffect, useMemo, useState } from "react";
import { type AgentLaunchResult, fmt, type RecipeRow } from "@local-studio/contracts/client";
import { call, post, via } from "../api";
import { cancelLaunch, ConnectDialog, ExportDialog, RecipeDialog, StopDialog, type Target } from "../components/actions";
import { BarMark, Btn, Dialog, Err, Logo, SectionHeading, Table } from "../components/basics";
import { FigureGrid, TokenLine } from "../components/cards";
import { aggOf, type CardView, fmtFormat, homeCards, type MachineView, machines, mergeRecipes, type RecipeView, resFig } from "../model/view";
import { loadRecipes, useStore } from "../store";
import { AgentsSection, useDefaultHarness } from "./agents";

type Show = "assigned" | "fits" | "all";

type Slot = { key: string; n: number; gpu: string; recipe: RecipeRow };
type Avail = { key: string; m: MachineView; name: string; gpus: string; state: string; slot: Slot | null };
const KIND: Record<string, string> = { stt: "speech to text", tts: "text to speech", embedding: "embedding" };
const freeSlots = (m: MachineView, rows: RecipeRow[]): Slot[] => {
  const fit = rows.filter((r) => r.fit === "fits" && r.freeGroups.length > 0);
  const byN = new Map<number, RecipeRow>();
  for (const r of fit) {
    const cur = byN.get(r.cards);
    const score = (x: RecipeRow) => (x.assigned ? 4 : 0) + (x.recommended ? 2 : 0);
    if (!cur || score(r) > score(cur)) byN.set(r.cards, r);
  }
  return [...byN.entries()].sort((x, y) => x[0] - y[0]).map(([n, r]) => ({ key: `${m.id}:${n}:${r.id}`, n, gpu: r.freeGroups[0]![0]!, recipe: r }));
};

export const ControlPage = ({ machineId, model }: { machineId: string | null; model: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const recipes = useStore((s) => s.recipes);
  const engines = useStore((s) => s.engines);
  const error = useStore((s) => s.error);
  const [dlg, setDlg] = useState<{ k: "stop" | "export"; c: CardView } | { k: "recipe"; id: string } | { k: "connect" } | { k: "run" } | { k: "agent" } | null>(null);
  useEffect(() => {
    if (model) setDlg({ k: "agent" });
  }, [model]);
  const [show, setShow] = useState<Show | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [omsg, setOmsg] = useState<string | null>(null);
  const [more, setMore] = useState<string | null>(null);
  const [cfg, setCfg] = useState(false);
  const all = useMemo(() => machines(fleet, live), [fleet, live]);
  const ms = all.filter((m) => !machineId || m.id === machineId);
  const cards = useMemo(() => homeCards(ms, live, fleet?.self ?? null, recipes, engines), [ms, live, fleet, recipes, engines]);
  const rvs = useMemo(() => mergeRecipes(ms, recipes), [ms, recipes]);
  const dh = useDefaultHarness();
  if (!fleet) return <Err>{error ?? "connecting"}</Err>;
  const a = aggOf(ms, engines);
  const anyAssigned = rvs.some((v) => v.per.some((p) => p.row.assigned));
  const mode: Show = show ?? (anyAssigned ? "assigned" : "fits");
  const shown = rvs
    .filter((v) => mode === "all" || v.per.some((p) => !!p.row.runningModelId || (mode === "assigned" ? p.row.assigned : p.row.fit === "fits")))
    .sort((x, y) => x.r.cards - y.r.cards || Number(y.r.recommended) - Number(x.r.recommended) || x.r.name.localeCompare(y.r.name));
  const names = (v: RecipeView, f: (p: RecipeView["per"][number]) => boolean) => v.per.filter(f).map((p) => p.m.name).join(", ") || "–";
  const sync = async () => {
    setMsg("syncing");
    const rs = await Promise.all(ms.filter((m) => m.online).map((m) => post(via(m.peerId, "/api/recipes/sync")).then((r) => (r.ok ? null : `${m.name}: ${r.error}`))));
    await Promise.all(ms.filter((m) => m.online).map((m) => loadRecipes(m.id, m.peerId)));
    setMsg(rs.filter(Boolean).join("\n") || null);
  };
  const target = (c: CardView): Target => ({ machineId: c.machineId, peerId: c.peerId, readOnly: c.readOnly });
  const open = dlg?.k === "recipe" ? rvs.find((v) => v.id === dlg.id) : undefined;
  const shownCards = cards.filter((c) => c.ready || c.launchId || !/not answering/.test(c.sub));
  const open1 = async (c: CardView) => {
    setOpening(c.key);
    const r = await call<AgentLaunchResult>("POST", `/api/agents/launch?terminal=${/Electron/.test(navigator.userAgent) ? "auto" : "none"}`, { harness: dh, model: c.servedModel ?? c.name }, 90_000);
    setOpening(null);
    if (!r.ok) return setOmsg(`${dh}: ${r.error}`);
    if (r.data.url) window.open(r.data.url);
    setOmsg(r.data.attach && !/Electron/.test(navigator.userAgent) ? `${dh} on ${c.servedModel ?? c.name}: ${r.data.attach}` : null);
  };
  const chat = shownCards.filter((c) => c.modality === "chat");
  const apis = shownCards.filter((c) => c.modality !== "chat");
  const hostOf = (id: string) => all.find((m) => m.id === id)?.snap?.machine.hostname ?? null;
  const urlOf = (c: CardView) => {
    const u = c.endpoint ?? "";
    const h = hostOf(c.machineId);
    return h ? u.replace(/\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(?=[:/]|$)/, `//${h}`) : u;
  };
  const avail: Avail[] = ms.flatMap((m) => {
    const gname = (k: string) => m.snap?.gpus.find((x) => x.key === k)?.name ?? k;
    const n = (keys: string[]) => (keys.length > 1 ? `${keys.length} × ${gname(keys[0]!)}` : gname(keys[0]!));
    if (!m.online) return [{ key: m.id, m, name: m.name, gpus: m.gpuSummary || "–", state: "offline", slot: null }];
    const taken = new Set((m.snap?.groups ?? []).filter((x) => x.state === "foreign").flatMap((g) => g.gpuKeys));
    const held = [...taken].map((k) => ({ id: `${m.id}:held:${k}`, gpuKeys: [k] }));
    const slots = freeSlots(m, (recipes[m.id] ?? []).map((r) => ({ ...r, freeGroups: r.freeGroups.filter((g) => !g.some((k) => taken.has(k))) })));
    const free = [...new Set((m.snap?.groups ?? []).filter((x) => x.state === "available").flatMap((g) => g.gpuKeys))].filter((k) => !taken.has(k)).map((k) => ({ gpuKeys: [k] }));
    const rows: Avail[] = slots.map((sl) => ({ key: sl.key, m, name: m.name, gpus: sl.n > 1 ? `${sl.n} × ${gname(sl.gpu)}` : gname(sl.gpu), state: "free", slot: sl }));
    if (!slots.length && free.length) rows.push({ key: `${m.id}:free`, m, name: m.name, gpus: n(free.flatMap((g) => g.gpuKeys)), state: "free · no config fits", slot: null });
    for (const h of held) rows.push({ key: h.id, m, name: m.name, gpus: n(h.gpuKeys), state: "in use by another program", slot: null });
    if (!rows.length) rows.push({ key: `${m.id}:none`, m, name: m.name, gpus: (m.snap?.gpus.length ?? 0) === 0 ? "no gpu" : m.gpuSummary, state: (m.snap?.gpus.length ?? 0) === 0 ? "–" : "all running", slot: null });
    return rows;
  });
  type Device = { key: string; name: string; mark: MachineView["mark"]; self: boolean; sub: string; rows: Avail[] };
  const isSpark = (m: MachineView) => /^spark-/.test(m.name);
  const busyHere = (m: MachineView) => chat.some((c) => c.machineId === m.id) || apis.some((c) => c.machineId === m.id);
  const devOf = (m: MachineView): Device => ({ key: m.id, name: m.name, mark: m.online ? m.mark : "failed", self: m.self, sub: m.gpuSummary || "–", rows: avail.filter((x) => x.m.id === m.id && !(x.state === "all running" && busyHere(m))) });
  const sparks = ms.filter(isSpark);
  const devices: Device[] = [
    ...ms.filter((m) => !isSpark(m)).map(devOf).filter((d) => d.rows.length > 0),
    ...(sparks.length > 1
      ? [{ key: "pod:sparks", name: "sparks", mark: sparks.some((m) => m.online) ? sparks[0]!.mark : "failed", self: false, sub: `${sparks.length} × ${sparks[0]!.gpuSummary.replace(/^\d+ × /, "")}`, rows: sparks.flatMap((m) => avail.filter((x) => x.m.id === m.id).map((x) => ({ ...x, gpus: m.name }))) } as Device]
      : sparks.map(devOf)),
  ];
  return (
    <div className="page ctl">
      <FigureGrid
        cells={[
          { v: `${ms.filter((m) => m.online).length} / ${ms.length}`, k: "machines online" },
          { v: String(shownCards.filter((c) => c.ready).length), k: "models running" },
          { v: fmt.tps(a.tps), k: "tok/s now" },
          { v: a.powerW === null ? "–" : `${Math.round(a.powerW)} W`, k: "power now" },
          resFig(ms, "vram"),
          resFig(ms, "ram"),
        ]}
        className="one"
      />
      <div className="toolbar">
        <Btn kind="primary" onClick={() => setDlg({ k: "run" })}>Run model ›</Btn>
        <Btn kind="primary" onClick={() => setDlg({ k: "agent" })}>New agent ›</Btn>
      </div>
      <SectionHeading aside={<span className="label">{`${chat.length} running · ${devices.length} ${devices.length === 1 ? "machine" : "machines"}`}</span>}>fleet</SectionHeading>
      <div className="runs">
        {chat.map((c) => (
          <div key={c.key} className="surface run glow">
            <TokenLine values={c.line} h={156} />
            <div className="name">
              <Logo family={c.family} />
              <span className="ellipsis grow">{c.name}</span>
              <span className="label">{c.machine}</span>
            </div>
            {c.figs ? (
              <div className="kpis">
                <span><b>{c.figs.total}</b><i>total</i></span>
                <span><b>{c.figs.decode}</b><i>decode tok/s</i></span>
                <span><b>{c.figs.prefill}</b><i>prefill tok/s</i></span>
              </div>
            ) : (
              <div className={c.subAlert ? "alert" : "label"}>{c.sub}</div>
            )}
            <div className="foot btns">
              {c.ready && dh && <Btn kind="primary" onClick={() => void open1(c)} disabled={opening === c.key}>{opening === c.key ? "Opening" : `Open ${dh} ›`}</Btn>}
              {more === c.key ? (
                <>
                  {c.ready && <Btn href={`#/control?model=${encodeURIComponent(c.servedModel ?? c.name)}`}>Agent ›</Btn>}
                  {c.modelId && <Btn onClick={() => setDlg({ k: "export", c })}>Save</Btn>}
                  {(c.modelId || c.launchId) && (
                    <Btn kind="danger" onClick={() => (c.modelId ? setDlg({ k: "stop", c }) : c.launchId && void cancelLaunch(target(c), c.launchId).then(setMsg))} disabled={c.readOnly || !!c.stopBlocked}>Stop</Btn>
                  )}
                </>
              ) : (
                <Btn onClick={() => setMore(c.key)}>More</Btn>
              )}
            </div>
          </div>
        ))}
        {devices.map((d) => (
          <div key={d.key} className="surface run dev">
            <div className="name">
              <BarMark mark={d.mark} />
              <span className="ellipsis grow">{d.name}</span>
              {!(d.rows.length === 1 && d.rows[0]!.gpus === d.sub) && <span className="label">{d.sub}</span>}
            </div>
            <div className="vrows">
              {d.rows.map((x) => (
                <div key={x.key} className="vrow line">
                  <span className="ellipsis grow">{x.gpus}</span>
                  {x.slot ? (
                    <Btn kind="primary" onClick={() => setDlg({ k: "recipe", id: x.slot!.recipe.id })}>{`Run ${x.slot.recipe.name} ›`}</Btn>
                  ) : (
                    <span className={x.state === "offline" ? "alert" : "label"}>{d.self && /no config|^–$/.test(x.state) ? "hub" : x.state === "free · no config fits" ? "free" : x.state === "in use by another program" ? "in use" : x.state}</span>
                  )}
                </div>
              ))}
            </div>
            {(d.self || d.rows.some((x) => x.slot)) && (
              <div className="foot btns">
                {d.rows.some((x) => x.slot) && <Btn onClick={() => setDlg({ k: "run" })}>Configs ›</Btn>}
                {d.self && <Btn onClick={() => setDlg({ k: "connect" })}>Connect ›</Btn>}
              </div>
            )}
          </div>
        ))}
        {apis.length > 0 && (
          <div className="surface run dev">
            <div className="name">
              <span className="ellipsis grow">voice</span>
              <span className="label">{`${apis.length} endpoints`}</span>
            </div>
            <div className="vrows">
              {apis.map((c) => (
                <div key={c.key} className="vrow">
                  <div className="row-flex">
                    <span className="ink ellipsis grow">{c.name}</span>
                    <span className="label">{KIND[c.modality] ?? c.modality}</span>
                  </div>
                  <div className="row-flex">
                    <span className="label ellipsis grow">{urlOf(c)}</span>
                    <span className="btns">
                      <Btn onClick={() => void navigator.clipboard?.writeText(urlOf(c))}>Copy</Btn>
                      {c.modelId && <Btn kind="danger" onClick={() => setDlg({ k: "stop", c })} disabled={c.readOnly || !!c.stopBlocked}>Stop</Btn>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <Err>{omsg}</Err>
      <AgentsSection model={model} only="sessions" />
      {dlg?.k === "run" && (
        <Dialog title="Run model" onClose={() => setDlg(null)} wide>
          <SectionHeading>where</SectionHeading>
      <div className="avail">
        {avail.map((x) =>
          x.slot ? (
            <button type="button" key={x.key} className="slot" onClick={() => setDlg({ k: "recipe", id: x.slot!.recipe.id })}>
              <span className="row-flex">
                <BarMark mark={x.m.mark} />
                <span className="ink">{x.m.name}</span>
                <span>{x.gpus}</span>
              </span>
              <span className="ink ellipsis">{`run ${x.slot.recipe.name} ›`}</span>
            </button>
          ) : (
            <div key={x.key} className="slot static">
              <span className="row-flex">
                <BarMark mark={x.m.online ? x.m.mark : "failed"} />
                <span>{x.m.name}</span>
                <span className="label">{x.gpus}</span>
              </span>
              <span className="label ellipsis">{x.state}</span>
            </div>
          ),
        )}
      </div>
          <div className="page">
      <SectionHeading
        aside={
          cfg && <span className="tabs">
            {(["assigned", "fits", "all"] as const).map((x) => (
              <button type="button" key={x} className={mode === x ? "on" : ""} onClick={() => setShow(x)}>
                {x}
              </button>
            ))}
            <button type="button" onClick={() => void sync()}>
              sync
            </button>
          </span>
        }
      >
        {`configs ${shown.length}/${rvs.length}`}
      </SectionHeading>
      {!cfg && (
        <div className="gut">
          <Btn onClick={() => setCfg(true)}>{`All ${shown.length} configs ›`}</Btn>
        </div>
      )}
      <Err>{msg}</Err>
      {cfg && <Table
        cols={[
          { h: "name", c: (v: RecipeView) => <span className="ink">{v.r.name}</span> },
          { h: "engine · quant", c: (v) => `${v.r.engine} ${fmtFormat(v.r.format)}` },
          { h: "gpus", c: (v) => `${v.r.cards} × ${v.r.hardwareId}` },
          { h: "ctx", n: true, c: (v) => fmt.ctx(v.r.ctxTokens) },
          { h: "fits on", c: (v) => <span className="cut">{names(v, (p) => p.row.fit === "fits")}</span> },
          { h: "running on", c: (v) => <span className="cut">{names(v, (p) => !!p.row.runningModelId)}</span> },
          { h: "", c: () => <span className="ink">›</span> },
        ]}
        rows={shown}
        keyOf={(v) => v.id}
        onRow={(v) => setDlg({ k: "recipe", id: v.id })}
      />}
          </div>
        </Dialog>
      )}
      {dlg?.k === "agent" && (
        <Dialog title="New agent" onClose={() => setDlg(null)} wide>
          <div className="page">
            <AgentsSection model={model} only="launch" />
          </div>
        </Dialog>
      )}
      {dlg?.k === "stop" && dlg.c.modelId && <StopDialog t={target(dlg.c)} modelId={dlg.c.modelId} name={dlg.c.name} watchdog={dlg.c.watchdog} blocked={dlg.c.stopBlocked} onClose={() => setDlg(null)} />}
      {dlg?.k === "export" && dlg.c.modelId && <ExportDialog t={target(dlg.c)} modelId={dlg.c.modelId} onClose={() => setDlg(null)} />}
      {open && <RecipeDialog v={open} onClose={() => setDlg(null)} />}
      {dlg?.k === "connect" && <ConnectDialog onClose={() => setDlg(null)} />}
    </div>
  );
};
