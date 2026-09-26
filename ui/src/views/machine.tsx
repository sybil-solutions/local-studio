import { useEffect, useMemo, useState } from "react";
import type { RecipeRow, SelectionFit, SelectionRow } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { post, via } from "../api";
import { cancelLaunch, launchRecipe, RecipeDialog } from "../components/actions";
import { Btn, clock, Err, Figs, Sec, Table } from "../components/basics";
import { aggOf, events, fmtFormat, gpuMem, groups, holder, isYours, localFit, machines, type MachineView, shortGpu, vram } from "../model/view";
import { loadRecipes, useStore } from "../store";
import { ModelTable, useRows } from "./fleet";

interface Pick {
  r: RecipeRow;
  on: { m: MachineView; keys: string[] }[];
  stops: string[];
}

export const MachinePage = ({ gid }: { gid: string }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const engines = useStore((s) => s.engines);
  const stats = useStore((s) => s.stats);
  const recipes = useStore((s) => s.recipes);
  const [sel, setSel] = useState<string[]>([]);
  const [open, setOpen] = useState<{ r: RecipeRow; m: MachineView } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const all = useMemo(() => machines(fleet, live), [fleet, live]);
  const g = groups(all).find((x) => x.id === gid) ?? groups(all).flatMap((x) => x.ms.map((m) => ({ id: m.id, name: m.name, pod: false, ms: [m] }))).find((x) => x.id === gid);
  const ms = g?.ms ?? [];
  const rows = useRows(ms);
  const chosen = useMemo(
    () => ms.filter((m) => m.online && m.snap).map((m) => ({ m, keys: sel.filter((k) => k.startsWith(`${m.id}|`)).map((k) => k.slice(m.id.length + 1)) })).filter((x) => x.keys.length),
    [ms, sel],
  );
  const selKey = [...sel].sort().join(",");
  const [remote, setRemote] = useState<{ key: string; rows: SelectionRow[] } | null>(null);
  useEffect(() => {
    if (!chosen.length) return setRemote(null);
    let on = true;
    void post<SelectionFit>("/api/recipes/fit", { selection: chosen.map((c) => ({ machineId: c.m.id, gpuKeys: c.keys })) }).then((r) => on && setRemote(r.ok && Array.isArray(r.data?.rows) ? { key: selKey, rows: r.data.rows } : null));
    return () => {
      on = false;
    };
  }, [selKey]);
  const picks = useMemo(() => {
    const on = ms.filter((m) => m.online && m.snap);
    const out: Pick[] = [];
    const nameOf = (id: string | null) => on.flatMap((m) => m.snap!.models).find((x) => x.id === id)?.primaryModel ?? id ?? "other";
    if (chosen.length && remote?.key === selKey) {
      for (const r of remote.rows) if (!r.stops.some((x) => x.state === "foreign")) out.push({ r, on: chosen.map(({ m, keys }) => ({ m, keys })), stops: [...new Set(r.stops.map((x) => nameOf(x.modelId)))] });
    } else if (chosen.length) {
      for (const r of recipes[chosen[0]!.m.id] ?? []) {
        const stops = localFit(r, chosen.map((c) => ({ s: c.m.snap!, keys: c.keys })));
        if (stops) out.push({ r, on: chosen.map(({ m, keys }) => ({ m, keys })), stops });
      }
    } else
      for (const m of on)
        for (const r of recipes[m.id] ?? [])
        {
          if (!(r.fit === "fits" || r.fit === "busy") || r.runningModelId || out.some((p) => p.r.id === r.id)) continue;
          const keys = r.freeGroups[0] ?? m.snap!.gpus.filter((x) => x.hardwareId === r.hardwareId && holder(x, m.snap!).state !== "foreign").slice(0, r.cards).map((x) => x.key);
          const stops = keys.length === r.cards ? localFit(r, [{ s: m.snap!, keys }]) : null;
          if (stops) out.push({ r, on: [{ m, keys }], stops });
        }
    return out.sort((a, b) => b.r.cards - a.r.cards || Number(b.r.recommended) - Number(a.r.recommended) || a.r.name.localeCompare(b.r.name));
  }, [ms, chosen, remote, recipes, selKey]);
  if (!g) return <Err>{fleet ? "–" : "connecting"}</Err>;
  const a = aggOf(ms, engines);
  const sums = ms.map((m) => stats[m.id]?.sum).filter((s) => !!s);
  const req = sums.reduce((t, s) => t + s.requests, 0);
  const toggle = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const launch = async (p: Pick) => {
    if (p.stops.length && confirm !== p.r.id) return setConfirm(p.r.id);
    setConfirm(null);
    setBusy(p.r.id);
    const errs = await Promise.all(p.on.map((o) => launchRecipe(o.m, p.r.id, o.keys, p.stops.length > 0)));
    setBusy(null);
    setErr(errs.filter(Boolean).join("\n") || null);
    setSel([]);
  };
  const sync = async () => {
    setBusy("sync");
    const rs = await Promise.all(ms.filter((m) => m.online).map((m) => post(via(m.peerId, "/api/recipes/sync")).then((r) => (r.ok ? null : `${m.name}: ${r.error}`))));
    await Promise.all(ms.filter((m) => m.online).map((m) => loadRecipes(m.id, m.peerId)));
    setBusy(null);
    setErr(rs.filter(Boolean).join("\n") || null);
  };
  const recipeTable = (list: Pick[]) => (
    <Table
      cols={[
        { h: "recipe", c: (p: Pick) => <span className="ink">{p.r.name}</span> },
        { h: "engine", w: true, c: (p) => `${p.r.engine} ${fmtFormat(p.r.format)}` },
        { h: "gpus", n: true, w: true, c: (p) => p.r.cards },
        { h: "ctx", n: true, c: (p) => fmt.ctx(p.r.ctxTokens) },
        { h: "size", n: true, w: true, c: (p) => (p.r.sizeGb ? `${Math.round(p.r.sizeGb)} GB` : "–") },
        {
          h: "",
          n: true,
          c: (p) => (
            <Btn kind={p.stops.length ? "danger" : "primary"} onClick={() => void launch(p)} disabled={!!busy || p.on.some((o) => o.m.readOnly)}>
              {busy === p.r.id ? "Launching" : confirm === p.r.id ? `Stop ${p.stops.join(", ")}` : p.stops.length ? "Replace ›" : "Launch ›"}
            </Btn>
          ),
        },
      ]}
      rows={list}
      keyOf={(p) => p.r.id}
      onRow={(p) => setOpen({ r: p.r, m: p.on[0]!.m })}
    />
  );
  const yours = picks.filter((p) => isYours(p.r));
  const ev = g.pod ? [] : events(ms[0]!, stats[ms[0]!.id]?.health ?? null, live, fleet?.self ?? null);
  return (
    <>
      <div className="crumb">
        <a className="label" href="#/">
          fleet ›
        </a>
        <span className="title">{g.name}</span>
        <span className="label">{g.pod ? `${ms.length} × ${ms[0]?.gpuSummary ?? ""}` : ms[0]?.gpuSummary}</span>
      </div>
      <Figs
        cells={[
          [vram(a), "gpu memory"],
          [a.util === null ? "–" : `${Math.round(a.util)}%`, "util"],
          [fmt.tps(a.tps), "tok/s now"],
          [fmt.k(req), "requests 24h"],
        ]}
      />
      <Sec aside={sel.length > 0 && <button type="button" className="btn quiet" onClick={() => setSel([])}>Clear</button>}>gpus</Sec>
      <div className="chips">
        {ms.flatMap((m) =>
          (m.online ? (m.snap?.gpus ?? []) : []).map((gp) => {
            const k = `${m.id}|${gp.key}`;
            const h = holder(gp, m.snap!);
            return (
              <button key={k} type="button" className={`chip${sel.includes(k) ? " on" : ""}`} disabled={h.state === "foreign" || m.readOnly} onClick={() => toggle(k)} title={h.text}>
                <span>{g.pod ? m.name : gp.index}</span>
                <span>{shortGpu(gp)}</span>
                <span className="label">{h.text || gpuMem(gp)}</span>
              </button>
            );
          }),
        )}
      </div>
      <Sec>running</Sec>
      <ModelTable rows={rows} multi={g.pod} reqOf={(r) => stats[r.m.id]?.sum?.byModel.find((x) => x.key === r.served)?.requests} onCancel={(r) => r.launchId && void cancelLaunch(r.m.peerId, r.launchId).then(setErr)} />
      <Err>{err}</Err>
      {yours.length > 0 && (
        <>
          <Sec>yours</Sec>
          {recipeTable(yours)}
        </>
      )}
      <Sec
        aside={
          <button type="button" className="btn quiet" onClick={() => void sync()} disabled={!!busy}>
            {busy === "sync" ? "Syncing" : "Sync"}
          </button>
        }
      >
        registry
      </Sec>
      {recipeTable(picks.filter((p) => !isYours(p.r)))}
      {ev.length > 0 && (
        <>
          <Sec>events</Sec>
          <Table cols={[{ h: "time", c: (l: (typeof ev)[number]) => clock(l.at) }, { h: "source", c: (l) => l.src }, { h: "event", c: (l) => <span title={l.msg}>{l.msg}</span> }]} rows={ev} keyOf={(l) => `${l.at}${l.src}${l.msg}`} rowClass={(l) => (l.alert ? "err" : "")} />
        </>
      )}
      {open && <RecipeDialog r={open.r} m={open.m} onClose={() => setOpen(null)} />}
    </>
  );
};
