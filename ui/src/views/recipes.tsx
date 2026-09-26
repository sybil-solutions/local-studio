import { useEffect, useMemo, useState } from "react";
import type { RecipeRow } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { post, via } from "../api";
import { LaunchDialog } from "../components/actions";
import { Btn, SectionHeading, Table } from "../components/basics";
import { fmtFormat, launchesFor, machines } from "../model/view";
import { go } from "../route";
import { loadRecipes, useStore } from "../store";

const FIT: Record<RecipeRow["fit"], string> = { fits: "fits", busy: "hardware busy", "no-hardware": "no hardware", "too-few-gpus": "too few GPUs" };

export const RecipesPage = ({ machineId }: { machineId: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const live = useStore((s) => s.launches);
  const recipes = useStore((s) => s.recipes);
  const ms = useMemo(() => machines(fleet, live).filter((m) => m.online), [fleet, live]);
  const mv = ms.find((m) => m.id === machineId) ?? ms.find((m) => m.self) ?? ms[0] ?? null;
  const [launch, setLaunch] = useState<RecipeRow | null>(null);
  const [all, setAll] = useState(false);
  const [sync, setSync] = useState<string | null>(null);
  const rows = mv ? recipes[mv.id] : undefined;
  const mvId = mv?.id ?? null;
  const mvPeer = mv?.peerId ?? null;
  useEffect(() => {
    if (mvId) void loadRecipes(mvId, mvPeer);
  }, [mvId, mvPeer]);
  const sorted = [...(rows ?? [])]
    .filter((r) => all || r.fit !== "no-hardware")
    .sort((a, b) => a.cards - b.cards || Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name));
  const launches = mv ? launchesFor(mv.snap, live, fleet?.self ?? null) : [];
  const doSync = async () => {
    if (!mv) return;
    setSync("syncing…");
    const r = await post<{ registryCommit?: string | null; recipes?: unknown[] }>(via(mv.peerId, "/api/recipes/sync"));
    setSync(r.ok ? `synced${r.data.registryCommit ? ` @ ${r.data.registryCommit.slice(0, 8)}` : ""}` : r.error);
    await loadRecipes(mv.id, mv.peerId);
  };
  return (
    <>
      <div className="top gap-top">
        <div className="tabs">
          {ms.map((m) => (
            <button type="button" key={m.id} className={m.id === mv?.id ? "on" : ""} onClick={() => go(`#/recipes/${encodeURIComponent(m.id)}`)}>
              {m.name}
            </button>
          ))}
        </div>
        <div className="conn">
          <button type="button" className="btn" onClick={() => setAll(!all)}>
            {all ? "Only this hardware" : "All hardware"}
          </button>
          <button type="button" className="btn" onClick={doSync}>
            Sync registry
          </button>
          {sync && <span className="label">{sync}</span>}
        </div>
      </div>
      <SectionHeading aside={<span className="label">{rows ? `${sorted.length} of ${rows.length}` : ""}</span>}>recipes · sorted by gpu count</SectionHeading>
      {rows === null ? (
        <div className="note gap-block">recipes are not available on this controller yet</div>
      ) : (
        <Table<RecipeRow>
          cols={[
            { h: "name", c: (r) => <span className={r.runningModelId ? "ink" : ""}>{r.name}{r.recommended ? " ·rec" : ""}</span> },
            { h: "engine · format", c: (r) => `${r.engine} · ${fmtFormat(r.format)}` },
            { h: "hardware", c: (r) => r.hardwareId },
            { h: "gpus", n: true, c: (r) => `${r.cards} GPU${r.cards > 1 ? "s" : ""}` },
            { h: "ctx", n: true, c: (r) => fmt.ctx(r.ctxTokens) },
            { h: "size", n: true, c: (r) => (r.sizeGb ? `${Math.round(r.sizeGb)} GB` : "–") },
            { h: "weights", c: (r) => (r.weightsPresent === null ? "–" : r.weightsPresent ? "downloaded" : "download") },
            { h: "state", c: (r) => (r.runningModelId ? "running" : FIT[r.fit]) },
            {
              h: "",
              c: (r) => {
                const l = launches.find((x) => x.recipeId === r.id && !["ready", "failed", "cancelled"].includes(x.phase));
                if (l) return <span className="value">{l.phase}{l.percent !== null ? ` · ${Math.round(l.percent)}%` : ""}</span>;
                const f = launches.find((x) => x.recipeId === r.id && x.phase === "failed");
                return (
                  <span className="row-flex">
                    {f && <span className="alert" title={f.error ?? ""}>failed</span>}
                    <Btn kind={r.fit === "fits" ? "primary" : "secondary"} onClick={() => setLaunch(r)} disabled={r.fit !== "fits" || !!r.runningModelId}>
                      Launch ›
                    </Btn>
                  </span>
                );
              },
            },
          ]}
          rows={sorted}
          keyOf={(r) => r.id}
          rowClass={(r) => (r.runningModelId ? "hl" : "")}
          empty={rows ? "no recipe for this hardware" : "loading recipes…"}
        />
      )}
      {mv?.readOnly && <div className="note gap-block">read-only: {mv.name} refuses launches. The plan preview still works.</div>}
      {launch && mv && (
        <LaunchDialog t={{ machineId: mv.id, peerId: mv.peerId, readOnly: mv.readOnly }} recipe={launch} recipeId={launch.id} gpuKeys={launch.freeGroups[0] ?? null} onClose={() => setLaunch(null)} />
      )}
    </>
  );
};
