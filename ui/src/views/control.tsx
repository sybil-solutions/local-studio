import { useEffect, useMemo, useState } from "react";
import type { RecipeRow } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { post, via } from "../api";
import { cancelLaunch, ConnectDialog, ExportDialog, LaunchDialog, StopDialog, type Target } from "../components/actions";
import { Btn, Err, SectionHeading, Table } from "../components/basics";
import { GpuRow, MachinesStrip, ModelCard } from "../components/cards";
import { type CardView, fmtFormat, gpuRow, homeCards, launchesFor, machines } from "../model/view";
import { loadRecipes, useStore } from "../store";

const FIT: Record<RecipeRow["fit"], string> = { fits: "fits", busy: "hardware busy", "no-hardware": "no hardware", "too-few-gpus": "too few GPUs" };

export const ControlPage = ({ machineId }: { machineId: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const recipes = useStore((s) => s.recipes);
  const engines = useStore((s) => s.engines);
  const error = useStore((s) => s.error);
  const [dlg, setDlg] = useState<{ k: "stop" | "export"; c: CardView } | { k: "launch"; r: RecipeRow } | { k: "connect" } | null>(null);
  const [all, setAll] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const ms = useMemo(() => machines(fleet, live), [fleet, live]);
  const mv = ms.find((m) => m.id === machineId) ?? ms.find((m) => m.self) ?? ms[0] ?? null;
  const cards = useMemo(() => (mv ? homeCards([mv], live, fleet?.self ?? null, recipes, engines) : []), [mv, live, fleet, recipes, engines]);
  const mvId = mv?.id ?? null;
  const peerId = mv?.peerId ?? null;
  useEffect(() => {
    if (mvId && mv?.online) void loadRecipes(mvId, peerId);
  }, [mvId, peerId, mv?.online]);
  if (!fleet || !mv) return <Err>{error ?? "connecting to the controller"}</Err>;
  const s = mv.snap;
  const t: Target = { machineId: mv.id, peerId, readOnly: mv.readOnly };
  const rows = recipes[mv.id];
  const launches = launchesFor(s, live, fleet.self);
  const shown = [...(rows ?? [])]
    .filter((r) => all || r.fit === "fits" || !!r.runningModelId)
    .sort((a, b) => a.cards - b.cards || Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name));
  const sync = async () => {
    setMsg("syncing…");
    const r = await post<{ registryCommit?: string | null }>(via(peerId, "/api/recipes/sync"));
    setMsg(r.ok ? `synced${r.data.registryCommit ? ` @ ${r.data.registryCommit.slice(0, 8)}` : ""}` : r.error);
    await loadRecipes(mv.id, peerId);
  };
  return (
    <>
      <MachinesStrip ms={ms} on={mv.id} href={(id) => `#/control/${encodeURIComponent(id)}`} />
      <div className="btns gut gap-block">
        <Btn onClick={() => setDlg({ k: "connect" })}>Connect controller ›</Btn>
        {mv.readOnly && <span className="label">read-only: launch and stop are refused</span>}
        {mv.watchdogs.length > 0 && <span className="alert">watchdog {mv.watchdogs.join(", ")} may restart models</span>}
      </div>
      <Err>{mv.error}</Err>
      <div className="cols">
        <div className="col">
          <SectionHeading aside={<span className="label">{s ? `${s.machine.platform} · v${s.machine.version} · docker ${s.discovery.docker}` : ""}</span>}>running</SectionHeading>
          {cards.length === 0 && <div className="note">no model running</div>}
          {cards.map((c) => (
            <ModelCard
              key={c.key}
              c={c}
              onStop={(x) => setDlg({ k: "stop", c: x })}
              onExport={(x) => setDlg({ k: "export", c: x })}
              onCancel={(x) => x.launchId && void cancelLaunch(t, x.launchId).then(setMsg)}
            />
          ))}
          <SectionHeading>gpus</SectionHeading>
          {s?.gpus.length ? s.gpus.map((g) => <GpuRow key={g.key} g={gpuRow(g, s, true)} />) : <div className="note">no GPU reported</div>}
          {(s?.discovery.errors ?? []).map((e) => (
            <div className="note alert" key={e}>
              {e}
            </div>
          ))}
        </div>
        <div className="col">
          <SectionHeading
            aside={
              <span className="btns">
                <Btn onClick={() => setAll(!all)}>{all ? "Fits only" : "All"}</Btn>
                <Btn onClick={() => void sync()}>Sync</Btn>
              </span>
            }
          >
            recipes
          </SectionHeading>
          {msg && <div className="note">{msg}</div>}
          {rows === null ? (
            <div className="note">recipes are not available on this controller</div>
          ) : (
            <Table<RecipeRow>
              cols={[
                { h: "name", c: (r) => <span className={r.runningModelId ? "ink" : ""}>{r.name}{r.recommended ? " ·rec" : ""}</span> },
                { h: "engine", c: (r) => `${r.engine} · ${fmtFormat(r.format)}` },
                { h: "gpus", n: true, c: (r) => `${r.cards} × ${r.hardwareId}` },
                { h: "ctx", n: true, c: (r) => fmt.ctx(r.ctxTokens) },
                { h: "size", n: true, c: (r) => (r.sizeGb ? `${Math.round(r.sizeGb)} GB` : "–") },
                { h: "weights", c: (r) => (r.weightsPresent === null ? "–" : r.weightsPresent ? "here" : "download") },
                {
                  h: "",
                  c: (r) => {
                    const l = launches.find((x) => x.recipeId === r.id);
                    if (l && !["ready", "failed", "cancelled"].includes(l.phase)) return `${l.phase}${l.percent !== null ? ` · ${Math.round(l.percent)}%` : ""}`;
                    if (r.runningModelId) return "running";
                    return (
                      <span className="row-flex">
                        {l?.phase === "failed" && <span className="alert" title={l.error ?? ""}>failed</span>}
                        <Btn kind={r.fit === "fits" ? "primary" : "secondary"} onClick={() => setDlg({ k: "launch", r })} disabled={r.fit !== "fits"} title={FIT[r.fit]}>
                          Launch ›
                        </Btn>
                      </span>
                    );
                  },
                },
              ]}
              rows={shown}
              keyOf={(r) => r.id}
              rowClass={(r) => (r.runningModelId ? "hl" : "")}
              empty={rows ? "no recipe fits this hardware; press All" : "loading recipes…"}
            />
          )}
        </div>
      </div>
      {dlg?.k === "stop" && dlg.c.modelId && (
        <StopDialog t={t} modelId={dlg.c.modelId} name={dlg.c.name} watchdog={dlg.c.watchdog} blocked={dlg.c.stopBlocked} onClose={() => setDlg(null)} />
      )}
      {dlg?.k === "export" && dlg.c.modelId && <ExportDialog t={t} modelId={dlg.c.modelId} onClose={() => setDlg(null)} />}
      {dlg?.k === "launch" && <LaunchDialog t={t} recipe={dlg.r} recipeId={dlg.r.id} gpuKeys={dlg.r.freeGroups[0] ?? null} onClose={() => setDlg(null)} />}
      {dlg?.k === "connect" && <ConnectDialog onClose={() => setDlg(null)} />}
    </>
  );
};
