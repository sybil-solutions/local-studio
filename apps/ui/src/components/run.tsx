import { useEffect, useMemo, useState } from "react";
import type { SelectionFit, SelectionRow } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { post, via } from "../api";
import { fmtFormat, type MachineView } from "../model/view";
import { Btn, Err } from "./basics";

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
  const tps = p.tps ? `${fmt.tps(p.tps)} tok/s · ` : "";
  if (p.reported) return `${tps}reported by ${p.on}`;
  const n = p.gates.split(/\s+/).filter(Boolean).length;
  return `${tps}${n === 6 ? "all 6 checks" : `${n} of 6 checks`} · ${p.on === "vast" ? "rented GPU" : p.on === "legacy" ? "older run" : p.on}`;
};

export const RunPanel = ({ machines, initial, onDone }: { machines: MachineView[]; initial: Sel; onDone: () => void }) => {
  const [sel, setSel] = useState<Sel>(initial);
  const [fit, setFit] = useState<SelectionFit | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
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
    onDone();
  };

  const runPod = async (r: SelectionRow) => {
    setBusy(r.id);
    setErr(null);
    const res = await post("/api/pods/launch", { recipeId: r.id, machineIds: chosen.map(([id]) => id) });
    setBusy(null);
    if (!res.ok) return setErr(res.error);
    onDone();
  };

  const count = chosen.reduce((t, [, k]) => t + k.length, 0);
  const isSpark = (m: MachineView) => /^spark-/.test(m.name);
  const sparks = withGpus.filter(isSpark);
  const groups: { name: string; members: MachineView[] }[] = [...withGpus.filter((m) => !isSpark(m)).map((m) => ({ name: m.name, members: [m] })), ...(sparks.length ? [{ name: "sparks", members: sparks }] : [])];
  const short = (n: string) => n.replace(/ Blackwell Workstation Edition| Workstation Edition| Generation| Max-Q/g, "").replace(/^RTX PRO/, "PRO");
  const holders = [
    ...new Set(
      chosen.flatMap(([id, keys]) => {
        const m = machines.find((x) => x.id === id);
        return m ? keys.map((k) => gpuState(m, k)).filter((st) => !st.free).map((st) => st.label) : [];
      }),
    ),
  ];
  const summary = chosen
    .map(([id, keys]) => {
      const m = machines.find((x) => x.id === id);
      const g = m?.snap?.gpus.find((x) => x.key === keys[0]);
      return `${keys.length} × ${short(g?.name ?? "GPU")} on ${m?.name ?? id}`;
    })
    .join(" + ");
  return (
    <>
      <div className="runsel">
        <div className="run-pick">
          {groups.map((grp) => (
            <div key={grp.name} className="run-grp">
              <div className="ink">{grp.name}</div>
              <div className="run-chips">
                {grp.members.flatMap((m) =>
                  (m.snap?.gpus ?? []).map((g) => {
                    const st = gpuState(m, g.key);
                    const on = (sel[m.id] ?? []).includes(g.key);
                    const label = grp.members.length > 1 ? m.name.replace(/^spark-/, "") : `${short(g.name)} ${g.index}`;
                    return (
                      <button type="button" key={`${m.id}/${g.key}`} className={`gpu-chip${on ? " on" : ""}${st.free ? "" : " held"}`} onClick={() => toggle(m, g.key)} title={`${m.name} · ${g.product} · ${st.label}`}>
                        <span>{label}</span>
                        <span className="label ellipsis">{st.label}</span>
                      </button>
                    );
                  }),
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="run-list">
          <div className="run-head">
            <span className={count ? "ink" : "label"}>{count ? summary : "no GPUs picked"}</span>
            <input className="input run-q" placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="label run-count">
            {count && !err ? (fit ? `${rows.length} configs fit${holders.length ? ` · Run stops ${holders.join(", ")} first` : ""}` : "checking") : ""}
          </div>
          <Err>{err}</Err>
          <div className="run-rows">
            {fit && rows.length === 0 && <div className="label">no config fits this selection</div>}
            {rows.map((r) => {
              const pod = (r.machines ?? 1) > 1;
              const expanded = open === r.id;
              const button = r.runningModelId ? (
                <span className="label">running</span>
              ) : pod ? (
                <Btn kind="primary" onClick={() => void runPod(r)} disabled={busy !== null || chosen.length !== r.machines}>
                  {busy === r.id ? "Starting" : `Run pod of ${r.machines} ›`}
                </Btn>
              ) : (
                <Btn kind={r.fit === "fits" ? "primary" : "secondary"} onClick={() => void run(r)} disabled={busy !== null}>
                  {busy === r.id ? "Starting" : r.fit === "fits" ? "Run ›" : "Stop & run ›"}
                </Btn>
              );
              return (
                <div key={r.id} className={`run-item${expanded ? " open" : ""}`}>
                  <div className="run-r" onClick={() => setOpen(expanded ? null : r.id)}>
                    <span className="run-cfg">
                      <span className="ink">{r.name}</span>
                      <span className="label">{`${fmt.ctx(r.ctxTokens)} context${r.sizeGb ? ` · ${Math.round(r.sizeGb)} GB` : ""}${pod ? ` · ${r.machines} machines` : ""}`}</span>
                    </span>
                    <span className="run-speed">{r.proof?.tps ? `${fmt.tps(r.proof.tps)} tok/s` : ""}</span>
                    <span className="run-go" onClick={(e) => e.stopPropagation()}>
                      {button}
                    </span>
                  </div>
                  {expanded && (
                    <dl className="run-more">
                      <dt>engine</dt>
                      <dd>{`${r.engine}${r.runtime === "host" ? " · native program" : " · container"}`}</dd>
                      <dt>weights</dt>
                      <dd>{`${fmtFormat(r.format)}${r.weights[0] ? ` · ${r.weights[0].repository}` : ""}`}</dd>
                      <dt>proof</dt>
                      <dd>{proofText(r)}</dd>
                      {r.image && (
                        <>
                          <dt>image</dt>
                          <dd className="ellipsis">{r.image}</dd>
                        </>
                      )}
                      {pod && (
                        <>
                          <dt>pod</dt>
                          <dd>{chosen.length === r.machines ? `${chosen.map(([id]) => machines.find((m) => m.id === id)?.name ?? id).join(" + ")}; the first one serves the API` : `pick ${r.machines} machines`}</dd>
                        </>
                      )}
                    </dl>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
};
