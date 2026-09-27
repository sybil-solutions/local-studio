import { useMemo, useState } from "react";
import { type AgentLaunchResult, fmt, type RecipeRow } from "@local-studio/contracts/client";
import { call, post, via } from "../api";
import { cancelLaunch, ConnectDialog, ExportDialog, RecipeDialog, StopDialog, type Target } from "../components/actions";
import { BarMark, Btn, Chips, Err, Logo, SectionHeading, Table } from "../components/basics";
import { FigureGrid, TokenLine } from "../components/cards";
import { aggOf, type CardView, fmtFormat, homeCards, type MachineView, machines, mergeRecipes, type RecipeView, resOf, resText, sumRes } from "../model/view";
import { loadRecipes, useStore } from "../store";
import { AgentsSection, useDefaultHarness } from "./agents";

type Show = "assigned" | "fits" | "all";

type Slot = { key: string; n: number; gpu: string; recipe: RecipeRow };
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
  const [dlg, setDlg] = useState<{ k: "stop" | "export"; c: CardView } | { k: "recipe"; id: string } | { k: "connect" } | null>(null);
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
  const res = ms.map(resOf);
  const fig = (k: "vram" | "ram" | "disk") => {
    const t = sumRes(res.map((r) => r[k]));
    return { v: resText(t), k: `${k} free${t.known < t.of ? ` · ${t.known}/${t.of}` : ""}` };
  };
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
  return (
    <div className="page ctl">
      <FigureGrid
        cells={[
          { v: `${ms.filter((m) => m.online).length} / ${ms.length}`, k: "machines online" },
          { v: String(shownCards.filter((c) => c.ready).length), k: "models running" },
          { v: fmt.tps(a.tps), k: "tok/s now" },
          { v: a.powerW === null ? "–" : `${Math.round(a.powerW)} W`, k: "power now" },
          fig("vram"),
        ]}
        className="one"
      />
      <SectionHeading aside={<Btn onClick={() => setDlg({ k: "connect" })}>Connect ›</Btn>}>machines</SectionHeading>
      <div className="panels">
        {ms.map((m) => {
          const r = resOf(m);
          const g = aggOf([m], engines);
          const mine = shownCards.filter((c) => c.machineId === m.id);
          const slots = freeSlots(m, recipes[m.id] ?? []);
          const held = (m.snap?.groups ?? []).filter((x) => x.state === "foreign");
          const gname = (k: string) => m.snap?.gpus.find((x) => x.key === k)?.name ?? k;
          return (
            <section key={m.id} className="panel">
              <a className="phead" href={m.id === machineId ? "#/control" : `#/control/${encodeURIComponent(m.id)}`}>
                <BarMark mark={m.online ? m.mark : "failed"} />
                <span className="ink">{m.name}</span>
                <span className="label ellipsis grow">{m.online ? m.gpuSummary : "offline"}</span>
                <span className="label">{g.powerW === null ? "" : `${Math.round(g.powerW)} W`}</span>
              </a>
              <div className="pmeta label">{r.vram ? `${resText(r.vram)} vram free` : `${resText(r.ram)} unified free`}</div>
              {mine.map((c) => (
                <div key={c.key} className="surface run glow">
                  <TokenLine values={c.line} h={156} />
                  <div className="name">
                    <Logo family={c.family} />
                    <span className="ellipsis">{c.name}</span>
                  </div>
                  <div className="row-flex label">
                    <span className="ellipsis">{c.gpu}</span>
                    {c.mem && <span>{c.mem}</span>}
                  </div>
                  <div className="label ellipsis" title={c.stackFrom ?? undefined}>{c.stack}</div>
                  {c.modality !== "chat" && (
                    <div className="row-flex">
                      <span className="badge">{c.modality === "stt" ? "speech to text" : c.modality === "tts" ? "text to speech" : "embedding"}</span>
                      <span className="label ellipsis">{c.endpoint ?? "–"}</span>
                    </div>
                  )}
                  {!c.ready && <div className={c.subAlert ? "alert" : ""}>{c.sub}</div>}
                  <div className="foot row-flex">
                    <span className="btns grow">
                      {c.ready && c.modality === "chat" && dh && <Btn kind="primary" onClick={() => void open1(c)} disabled={opening === c.key}>{opening === c.key ? "Opening" : `Open ${dh} ›`}</Btn>}
                      {more === c.key ? (
                        <>
                          {c.ready && c.modality === "chat" && <Btn href={`#/control?model=${encodeURIComponent(c.servedModel ?? c.name)}`}>Agent ›</Btn>}
                          {c.modelId && <Btn onClick={() => setDlg({ k: "export", c })}>Save</Btn>}
                          {(c.modelId || c.launchId) && (
                            <Btn kind="danger" onClick={() => (c.modelId ? setDlg({ k: "stop", c }) : c.launchId && void cancelLaunch(target(c), c.launchId).then(setMsg))} disabled={c.readOnly || !!c.stopBlocked}>Stop</Btn>
                          )}
                        </>
                      ) : (
                        <Btn onClick={() => setMore(c.key)}>More</Btn>
                      )}
                    </span>
                    <Chips chips={c.chips} className="label" />
                  </div>
                </div>
              ))}
              {slots.map((sl) => (
                <button type="button" key={sl.key} className="slot" onClick={() => setDlg({ k: "recipe", id: sl.recipe.id })}>
                  <span>{sl.n > 1 ? `${sl.n} × ${gname(sl.gpu)}` : gname(sl.gpu)}</span>
                  <span className="ink ellipsis">{`run ${sl.recipe.name} ›`}</span>
                </button>
              ))}
              {held.map((h) => (
                <div key={h.id} className="slot static">
                  <span>{h.gpuKeys.length > 1 ? `${h.gpuKeys.length} × ${gname(h.gpuKeys[0]!)}` : gname(h.gpuKeys[0]!)}</span>
                  <span className="label">in use by another program</span>
                </div>
              ))}
              {!mine.length && !slots.length && !held.length && <div className="slot static label"><span>{(m.snap?.gpus.length ?? 0) === 0 ? "no gpu" : "no config fits"}</span></div>}
            </section>
          );
        })}
      </div>
      <Err>{omsg}</Err>
      <AgentsSection model={model} />
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
          <Btn onClick={() => setCfg(true)}>{`Show ${shown.length} configs ›`}</Btn>
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
      {dlg?.k === "stop" && dlg.c.modelId && <StopDialog t={target(dlg.c)} modelId={dlg.c.modelId} name={dlg.c.name} watchdog={dlg.c.watchdog} blocked={dlg.c.stopBlocked} onClose={() => setDlg(null)} />}
      {dlg?.k === "export" && dlg.c.modelId && <ExportDialog t={target(dlg.c)} modelId={dlg.c.modelId} onClose={() => setDlg(null)} />}
      {open && <RecipeDialog v={open} onClose={() => setDlg(null)} />}
      {dlg?.k === "connect" && <ConnectDialog onClose={() => setDlg(null)} />}
    </div>
  );
};
