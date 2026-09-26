import { useMemo, useState } from "react";
import { fmt } from "@local-studio/contracts/client";
import { post, via } from "../api";
import { cancelLaunch, ConnectDialog, ExportDialog, RecipeDialog, StopDialog, type Target } from "../components/actions";
import { Btn, Err, SectionHeading, Table } from "../components/basics";
import { FigureGrid, HourCharts, vram, GpuTable, MachineTile, ModelCard, sliceHit } from "../components/cards";
import { aggOf, type CardView, fmtFormat, homeCards, logLines, type MachineView, machines, mergeRecipes, type RecipeView } from "../model/view";
import { loadRecipes, useStore } from "../store";

type Show = "assigned" | "fits" | "all";
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export const ControlPage = ({ machineId }: { machineId: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const recipes = useStore((s) => s.recipes);
  const engines = useStore((s) => s.engines);
  const stats = useStore((s) => s.stats);
  const requests = useStore((s) => s.requests);
  const error = useStore((s) => s.error);
  const now = useStore((s) => Math.floor(s.now / 60_000) * 60_000);
  const [dlg, setDlg] = useState<{ k: "stop" | "export"; c: CardView } | { k: "recipe"; id: string } | { k: "connect" } | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const all = useMemo(() => machines(fleet, live), [fleet, live]);
  const ms = all.filter((m) => !machineId || m.id === machineId);
  const cards = useMemo(() => homeCards(ms, live, fleet?.self ?? null, recipes, engines), [ms, live, fleet, recipes, engines]);
  const rvs = useMemo(() => mergeRecipes(ms, recipes), [ms, recipes]);
  if (!fleet) return <Err>{error ?? "connecting"}</Err>;
  const sums = ms.map((m) => stats[m.id]?.sum).filter((s) => !!s);
  const tot = (k: "requests" | "errors" | "inputUncached" | "cacheRead" | "cacheWrite" | "output" | "cacheUnknownPrompt") => sums.reduce((t, s) => t + (s[k] ?? 0), 0);
  const prompt = tot("inputUncached") + tot("cacheRead") + tot("cacheWrite");
  const a = aggOf(ms, engines);
  const reqs = [...requests.filter((r) => r.via !== "peer"), ...ms.flatMap((m) => (m.peerId ? (stats[m.id]?.reqs ?? []) : []))].filter((r) => ms.some((m) => m.id === r.machineId));
  const log = logLines(ms, Object.fromEntries(ms.map((m) => [m.id, stats[m.id]?.health ?? null])), reqs, live, fleet.self).slice(0, 14);
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
  return (
    <div className="page">
      <FigureGrid
        cells={[
          { v: String(ms.filter((m) => m.online).length), k: "machines" },
          { v: String(a.gpus), k: "gpus" },
          { v: vram(a), k: "vram" },
          { v: a.powerW === null ? "–" : `${Math.round(a.powerW)} W`, k: "power" },
          { v: String(cards.length), k: "models" },
          { v: fmt.tps(a.tps), k: "tok/s now" },
          { v: fmt.k(tot("requests")), k: "requests 24h" },
          { v: fmt.k(prompt), k: "tokens in" },
          { v: fmt.k(tot("output")), k: "tokens out" },
          { v: prompt ? sliceHit({ cacheRead: tot("cacheRead"), promptTotal: prompt, cacheUnknownPrompt: tot("cacheUnknownPrompt") }) : "–", k: "cache hit" },
          { v: fmt.k(tot("errors")), k: "errors 24h" },
        ]}
      />
      <HourCharts rows={ms.flatMap((m) => stats[m.id]?.hourly ?? [])} ttft={ms.flatMap((m) => stats[m.id]?.ttft ?? [])} now={now} />
      <SectionHeading aside={<Btn onClick={() => setDlg({ k: "connect" })}>Connect ›</Btn>}>machines</SectionHeading>
      <div className="page">
        {ms.map((m: MachineView) => (
          <MachineTile key={m.id} m={m} a={aggOf([m], engines)} st={stats[m.id]} on={m.id === machineId} />
        ))}
      </div>
      <SectionHeading>running</SectionHeading>
      {cards.length === 0 && <div className="note">–</div>}
      <div className="page">
      {cards.map((c) => (
        <ModelCard
          key={c.key}
          c={c}
          onStop={(x) => setDlg({ k: "stop", c: x })}
          onExport={(x) => setDlg({ k: "export", c: x })}
          onCancel={(x) => x.launchId && void cancelLaunch(target(x), x.launchId).then(setMsg)}
        />
      ))}
      </div>
      <div className="half">
        <SectionHeading>gpus</SectionHeading>
        <GpuTable ms={ms} />
      </div>
      <div className="half">
        <SectionHeading>log</SectionHeading>
        <Table
          cols={[
            { h: "time", c: (l: (typeof log)[number]) => clock(l.at) },
            ...(ms.length > 1 ? [{ h: "machine", c: (l: (typeof log)[number]) => l.machine }] : []),
            { h: "source", c: (l) => <span className="cut">{l.src}</span> },
            { h: "message", c: (l) => <span className="cut" title={l.msg} style={{ maxWidth: "48ch" }}>{l.msg}</span> },
          ]}
          rows={log}
          keyOf={(l) => `${l.at}${l.machine}${l.src}${l.msg}`}
          rowClass={(l) => (l.alert ? "err" : "")}
        />
      </div>
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
        {`recipes ${shown.length}/${rvs.length}`}
      </SectionHeading>
      <Err>{msg}</Err>
      <Table
        cols={[
          { h: "name", c: (v: RecipeView) => v.r.name },
          { h: "engine", c: (v) => `${v.r.engine} ${fmtFormat(v.r.format)}` },
          { h: "gpus", c: (v) => `${v.r.cards} × ${v.r.hardwareId}` },
          { h: "ctx", n: true, c: (v) => fmt.ctx(v.r.ctxTokens) },
          { h: "size", n: true, c: (v) => (v.r.sizeGb ? `${Math.round(v.r.sizeGb)} GB` : "–") },
          { h: "fits", c: (v) => <span className="cut">{names(v, (p) => p.row.fit === "fits")}</span> },
          { h: "assigned", c: (v) => <span className="cut">{names(v, (p) => !!p.row.assigned)}</span> },
          { h: "running", c: (v) => <span className="cut ink">{names(v, (p) => !!p.row.runningModelId)}</span> },
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
