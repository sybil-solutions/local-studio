import { useEffect, useMemo, useState } from "react";
import type { SelectionFit, SelectionRow } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { post, via } from "../api";
import { fmtFormat, type MachineView } from "../model/view";
import { Btn, Dialog, Err } from "./basics";

type Sel = Record<string, string[]>;

const gpuState = (m: MachineView, key: string): { label: string; free: boolean } => {
  const s = m.snap;
  const g = s?.groups.find((x) => x.gpuKeys.includes(key));
  if (!g || g.state === "available") return { label: "free", free: true };
  if (g.state === "foreign") return { label: "other program", free: false };
  const names = (g.modelIds ?? []).map((id) => s?.models.find((x) => x.id === id)?.primaryModel ?? id);
  return { label: names.join(", ") || g.state, free: false };
};

const proofText = (r: SelectionRow): string => {
  const p = r.proof;
  if (!p) return r.origin === "yours" ? "your config" : "–";
  return `${p.tps ? `${fmt.tps(p.tps)} tok/s · ` : ""}${p.legacy ? "load + chat only" : `${p.gates.split(" ").length}/6 checks`}${p.on ? ` · ${p.on}` : ""}`;
};

export const RunDialog = ({ machines, initial, onClose }: { machines: MachineView[]; initial: Sel; onClose: () => void }) => {
  const [sel, setSel] = useState<Sel>(initial);
  const [fit, setFit] = useState<SelectionFit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const withGpus = machines.filter((m) => m.online && (m.snap?.gpus.length ?? 0) > 0);
  const chosen = Object.entries(sel).filter(([, keys]) => keys.length);
  const selKey = JSON.stringify(chosen);

  useEffect(() => {
    setFit(null);
    setErr(null);
    if (!chosen.length) return;
    let on = true;
    void post<SelectionFit>("/api/recipes/fit", { selection: chosen.map(([machineId, gpuKeys]) => ({ machineId, gpuKeys })) }).then((r) => {
      if (!on) return;
      if (r.ok) setFit(r.data);
      else setErr(r.error);
    });
    return () => {
      on = false;
    };
  }, [selKey]);

  const toggle = (m: MachineView, key: string) =>
    setSel((s) => {
      const cur = s[m.id] ?? [];
      return { ...s, [m.id]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key].sort() };
    });

  const rows = useMemo(() => (fit?.rows ?? []).filter((r) => !q || `${r.name} ${r.engine} ${r.format}`.toLowerCase().includes(q.toLowerCase())), [fit, q]);

  const run = async (r: SelectionRow) => {
    const [machineId, gpuKeys] = chosen[0] ?? [];
    const m = machines.find((x) => x.id === machineId);
    if (!m || !gpuKeys) return;
    setBusy(r.id);
    const res = await post(via(m.peerId, `/api/recipes/${encodeURIComponent(r.id)}/launch`), { gpuKeys, stop: r.fit === "busy" });
    setBusy(null);
    if (!res.ok) return setErr(res.error);
    onClose();
  };

  const count = chosen.reduce((t, [, k]) => t + k.length, 0);
  return (
    <Dialog title="Run a model" onClose={onClose} wide>
      <div className="blk">
        {withGpus.map((m) => (
          <div key={m.id} className="p-row run-m">
            <span className="ink run-name">{m.name}</span>
            <span className="run-gpus">
              {(m.snap?.gpus ?? []).map((g) => {
                const st = gpuState(m, g.key);
                const on = (sel[m.id] ?? []).includes(g.key);
                return (
                  <button type="button" key={g.key} className={`gpu-chip${on ? " on" : ""}${st.free ? "" : " held"}`} onClick={() => toggle(m, g.key)} title={`${g.product} · ${st.label}`}>
                    <span>{`${g.name} · ${g.index}`}</span>
                    <span className="label">{st.label}</span>
                  </button>
                );
              })}
            </span>
          </div>
        ))}
      </div>
      <div className="blk run-head">
        <span className="label">{count ? `${count} GPU${count > 1 ? "s" : ""} on ${chosen.length} machine${chosen.length > 1 ? "s" : ""} · ${fit ? `${rows.length} configs` : "checking"}` : "pick one or more GPUs"}</span>
        <input className="input run-q" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Err>{err}</Err>
      <div className="blk">
        {fit && rows.length === 0 && <div className="label">no config in the registry fits this selection; select a different number of GPUs</div>}
        {rows.map((r) => {
          const pod = (r.machines ?? 1) > 1;
          return (
            <div key={r.id} className="p-row run-r">
              <span className="run-cfg">
                <span className="ink">{r.name}</span>
                <span className="label">{`${r.engine} · ${fmtFormat(r.format)} · ${fmt.ctx(r.ctxTokens)}${r.runtime === "host" ? " · native" : ""}${r.sizeGb ? ` · ${Math.round(r.sizeGb)} GB` : ""}`}</span>
              </span>
              <span className="label run-proof">{proofText(r)}</span>
              <span className="p-go">
                {pod ? (
                  <span className="label">needs a pod launch; not supported yet</span>
                ) : r.runningModelId ? (
                  <span className="label">running</span>
                ) : (
                  <Btn kind={r.fit === "fits" ? "primary" : "danger"} onClick={() => void run(r)} disabled={busy !== null}>
                    {busy === r.id ? "Starting" : r.fit === "fits" ? `Run${r.weightsPresent === false ? " + download" : ""} ›` : `Stop ${r.stops.map((s) => s.modelId ?? "other").join(", ")} and run ›`}
                  </Btn>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
};
