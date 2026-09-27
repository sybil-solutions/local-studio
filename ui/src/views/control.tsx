import { useMemo, useState } from "react";
import { type AgentLaunchResult, fmt } from "@local-studio/contracts/client";
import { call, post, via } from "../api";
import { cancelLaunch, ConnectDialog, ExportDialog, RecipeDialog, StopDialog, type Target } from "../components/actions";
import { BarMark, Btn, Err, SectionHeading, Table } from "../components/basics";
import { FigureGrid } from "../components/cards";
import { aggOf, type CardView, fmtFormat, homeCards, type MachineView, machines, mergeRecipes, type RecipeView, resOf, resText, sumRes } from "../model/view";
import { loadRecipes, useStore } from "../store";
import { AgentsSection, useDefaultHarness } from "./agents";

type Show = "assigned" | "fits" | "all";

export const ControlPage = ({ machineId, model }: { machineId: string | null; model: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const recipes = useStore((s) => s.recipes);
  const engines = useStore((s) => s.engines);
  const stats = useStore((s) => s.stats);
  const error = useStore((s) => s.error);
  const [dlg, setDlg] = useState<{ k: "stop" | "export"; c: CardView } | { k: "recipe"; id: string } | { k: "connect" } | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [omsg, setOmsg] = useState<string | null>(null);
  const all = useMemo(() => machines(fleet, live), [fleet, live]);
  const ms = all.filter((m) => !machineId || m.id === machineId);
  const cards = useMemo(() => homeCards(ms, live, fleet?.self ?? null, recipes, engines), [ms, live, fleet, recipes, engines]);
  const rvs = useMemo(() => mergeRecipes(ms, recipes), [ms, recipes]);
  const dh = useDefaultHarness();
  if (!fleet) return <Err>{error ?? "connecting"}</Err>;
  const sums = ms.map((m) => stats[m.id]?.sum).filter((s) => !!s);
  const tot = (k: "requests" | "errors" | "inputUncached" | "cacheRead" | "output") => sums.reduce((t, s) => t + (s[k] ?? 0), 0);
  const a = aggOf(ms, engines);
  const res = ms.map(resOf);
  const fig = (k: "vram" | "ram" | "disk") => {
    const t = sumRes(res.map((r) => r[k]));
    return { v: resText(t), k: `${k} free${t.known < t.of ? ` · ${t.known}/${t.of}` : ""}` };
  };
  const pair = (x: string, y: string) => `${x} / ${y}`;
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
  const tpsOf = (c: CardView) => c.chips.find((x) => x.icon === "speed")?.text.replace(/\s*tok\/s.*$/, "") ?? "–";
  const open1 = async (c: CardView) => {
    setOpening(c.key);
    const r = await call<AgentLaunchResult>("POST", `/api/agents/launch?terminal=${/Electron/.test(navigator.userAgent) ? "auto" : "none"}`, { harness: dh, model: c.servedModel ?? c.name }, 90_000);
    setOpening(null);
    if (!r.ok) return setOmsg(`${dh}: ${r.error}`);
    if (r.data.url) window.open(r.data.url);
    setOmsg(r.data.attach && !/Electron/.test(navigator.userAgent) ? `${dh} on ${c.servedModel ?? c.name}: ${r.data.attach}` : null);
  };
  const status = (c: CardView) => (c.ready ? "ready" : c.sub || "loading");
  return (
    <div className="page ctl">
      <FigureGrid
        cells={[
          { v: `${ms.filter((m) => m.online).length} / ${ms.length}`, k: "machines online" },
          { v: String(cards.filter((c) => c.ready).length), k: "models running" },
          { v: fmt.tps(a.tps), k: "tok/s now" },
          { v: pair(fmt.k(tot("requests")), fmt.k(tot("errors"))), k: "requests / errors 24h" },
          { v: a.powerW === null ? "–" : `${Math.round(a.powerW)} W`, k: "power now" },
          fig("vram"),
          fig("ram"),
          fig("disk"),
        ]}
        className="one"
      />
      <SectionHeading aside={<Btn onClick={() => setDlg({ k: "connect" })}>Connect ›</Btn>}>machines</SectionHeading>
      <Table
        cols={[
          { h: "machine", c: (m: MachineView) => (
            <span className="row-flex">
              <BarMark mark={m.online ? m.mark : "failed"} />
              <span className={m.id === machineId ? "ink" : ""}>{m.name}</span>
              {!m.online && <span className="badge alert">offline</span>}
            </span>
          ) },
          { h: "hardware", c: (m) => <span className="cut label">{m.online ? m.gpuSummary : (m.error ?? "–")}</span> },
          { h: "util", n: true, c: (m) => { const g = aggOf([m], engines); return g.util === null ? "–" : `${Math.round(g.util)}%`; } },
          { h: "power", n: true, c: (m) => { const g = aggOf([m], engines); return g.powerW === null ? "–" : `${Math.round(g.powerW)} W`; } },
          { h: "vram free", n: true, c: (m) => { const r = resOf(m); return r.vram ? resText(r.vram) : "–"; } },
          { h: "ram free", n: true, c: (m) => { const r = resOf(m); return `${resText(r.ram)}${r.unified ? " unified" : ""}`; } },
          { h: "disk free", n: true, c: (m) => resText(resOf(m).disk) },
          { h: "running", c: (m) => <span className="cut">{aggOf([m], engines).models.join(", ") || "–"}</span> },
        ]}
        rows={ms}
        keyOf={(m) => m.id}
        rowClass={(m) => (m.id === machineId ? "hl" : "")}
        onRow={(m) => (location.hash = m.id === machineId ? "#/control" : `#/control/${encodeURIComponent(m.id)}`)}
      />
      <SectionHeading>models</SectionHeading>
      <Table
        cols={[
          { h: "model", c: (c: CardView) => <span className="ink">{c.name}</span> },
          { h: "machine", c: (c) => c.machine },
          { h: "engine · quant", c: (c) => <span title={c.stackFrom ?? undefined}>{c.stack || "–"}</span> },
          { h: "gpus", c: (c) => <span className="cut">{c.gpu}</span> },
          { h: "memory", n: true, c: (c) => c.mem || "–" },
          { h: "tok/s", n: true, c: (c) => tpsOf(c) },
          { h: "state", c: (c) => <span className={c.subAlert ? "alert" : c.ready ? "" : "label"}>{status(c)}</span> },
          {
            h: " ",
            c: (c) => (
              <span className="btns" onClick={(e) => e.stopPropagation()}>
                {c.ready && !c.embedding && dh && <Btn kind="primary" onClick={() => void open1(c)} disabled={opening === c.key}>{opening === c.key ? "Opening" : `Open ${dh} ›`}</Btn>}
                {c.ready && !c.embedding && <Btn href={`#/control?model=${encodeURIComponent(c.servedModel ?? c.name)}`}>Agent ›</Btn>}
                {c.modelId && <Btn onClick={() => setDlg({ k: "export", c })}>Save</Btn>}
                {c.modelId ? (
                  <Btn kind="danger" onClick={() => setDlg({ k: "stop", c })} disabled={c.readOnly || !!c.stopBlocked}>Stop</Btn>
                ) : c.launchId ? (
                  <Btn kind="danger" onClick={() => c.launchId && void cancelLaunch(target(c), c.launchId).then(setMsg)} disabled={c.readOnly}>Stop</Btn>
                ) : null}
              </span>
            ),
          },
        ]}
        rows={cards}
        keyOf={(c) => c.key}
      />
      <Err>{omsg}</Err>
      <AgentsSection model={model} />
      <SectionHeading
        aside={
          <span className="tabs">
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
      <Err>{msg}</Err>
      <Table
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
      />
      {dlg?.k === "stop" && dlg.c.modelId && <StopDialog t={target(dlg.c)} modelId={dlg.c.modelId} name={dlg.c.name} watchdog={dlg.c.watchdog} blocked={dlg.c.stopBlocked} onClose={() => setDlg(null)} />}
      {dlg?.k === "export" && dlg.c.modelId && <ExportDialog t={target(dlg.c)} modelId={dlg.c.modelId} onClose={() => setDlg(null)} />}
      {open && <RecipeDialog v={open} onClose={() => setDlg(null)} />}
      {dlg?.k === "connect" && <ConnectDialog onClose={() => setDlg(null)} />}
    </div>
  );
};
