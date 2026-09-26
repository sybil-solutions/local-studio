import { useEffect, useState } from "react";
import type { LaunchProgress, Peer, RecipeExport, RecipePr, RecipeRow, TailnetCandidate } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { call, get, post, setKey, via } from "../api";
import { fmtFormat, type MachineView } from "../model/view";
import { loadAll, loadRecipes, restart, setState } from "../store";
import { Btn, Dialog, Err, KV } from "./basics";

const enc = encodeURIComponent;

export const cancelLaunch = async (peerId: string | null, launchId: string): Promise<string | null> => {
  const r = await post<{ ok: boolean }>(via(peerId, `/api/launches/${enc(launchId)}/cancel`));
  return r.ok ? null : r.error;
};

export const launchRecipe = async (m: MachineView, recipeId: string, gpuKeys: string[], stop: boolean): Promise<string | null> => {
  const r = await post<LaunchProgress>(via(m.peerId, `/api/recipes/${enc(recipeId)}/launch`), { ...(gpuKeys.length ? { gpuKeys } : {}), ...(stop ? { stop } : {}) });
  if (!r.ok) return `${m.name}: ${r.error}`;
  setState((s) => ({ launches: { ...s.launches, [r.data.launchId]: { ...r.data, machineId: m.id } } }));
  return null;
};

export const ExportDialog = ({ peerId, modelId, readOnly, onClose }: { peerId: string | null; modelId: string; readOnly: boolean; onClose: () => void }) => {
  const [x, setX] = useState<RecipeExport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pr, setPr] = useState<RecipePr | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void post<RecipeExport>(via(peerId, `/api/models/${enc(modelId)}/export`)).then((r) => (r.ok ? setX(r.data) : setErr(r.error)));
  }, [peerId, modelId]);
  const openPr = async () => {
    setBusy(true);
    const r = await post<RecipePr>(via(peerId, `/api/models/${enc(modelId)}/export/pr`), { draft: true });
    setBusy(false);
    if (r.ok) setPr(r.data);
    else setErr(r.error);
  };
  return (
    <Dialog title="EXPORT RECIPE" onClose={onClose}>
      {x && (
        <>
          <KV rows={[["recipe", x.recipeId, "ink"], ["saved", x.savedTo], ...x.refusals.map((r): [string, string, string] => ["refusal", r, "alert"]), ...x.warnings.map((r): [string, string] => ["warning", r])]} />
          <div className="blk">
            <pre className="pre">{JSON.stringify(x.record, null, 2)}</pre>
          </div>
          <div className="blk btns">
            <Btn kind="primary" onClick={openPr} disabled={readOnly || x.refusals.length > 0 || busy || !!pr}>
              Open PR ›
            </Btn>
            {pr && (
              <a className="ink" href={pr.url} target="_blank" rel="noreferrer">
                {pr.url}
              </a>
            )}
          </div>
        </>
      )}
      <Err>{err}</Err>
    </Dialog>
  );
};

export const RecipeDialog = ({ r, m, onClose }: { r: RecipeRow; m: MachineView; onClose: () => void }) => {
  const [err, setErr] = useState<string | null>(null);
  const assign = async () => {
    const res = await call("PUT", via(m.peerId, `/api/recipes/${enc(r.id)}/assigned`), { on: !r.assigned });
    setErr(res.ok ? null : res.error);
    await loadRecipes(m.id, m.peerId);
    onClose();
  };
  const caps = Object.entries(r.caps).filter(([, on]) => on).map(([k]) => k);
  return (
    <Dialog title={r.name} onClose={onClose}>
      <KV
        rows={[
          ["engine", `${r.engine} ${fmtFormat(r.format)}`],
          ["served as", r.servedName],
          ["gpus", `${r.cards} × ${r.hardwareId}`],
          ["context", fmt.ctx(r.ctxTokens)],
          ["size", r.sizeGb ? `${Math.round(r.sizeGb)} GB` : "–"],
          ["caps", caps.join(" · ") || "–"],
          ["image", r.image],
          ...r.weights.map((w): [string, string] => ["weights", w.hostPath ?? `${w.repository}@${w.revision.slice(0, 12)}`]),
        ]}
      />
      <div className="blk">
        <pre className="pre">{[...r.launch.arguments, ...Object.entries(r.launch.environment).map(([k, x]) => `${k}=${x}`)].join("\n")}</pre>
      </div>
      {r.source !== "local" && (
        <div className="blk btns">
          <Btn kind="quiet" onClick={() => void assign()} disabled={m.readOnly}>
            {r.assigned ? `Remove from ${m.name}` : `Keep on ${m.name}`}
          </Btn>
        </div>
      )}
      <Err>{err}</Err>
    </Dialog>
  );
};

export const KeyPrompt = () => {
  const [v, setV] = useState("");
  return (
    <Dialog title="CONTROLLER KEY" onClose={() => setState({ needKey: false })}>
      <form
        className="blk btns"
        onSubmit={(e) => {
          e.preventDefault();
          if (!v) return;
          setKey(v.trim());
          setV("");
          void restart();
        }}
      >
        <input className="input" type="password" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} autoFocus aria-label="key" />
        <button type="submit" className="btn primary has-chev">
          Save<span className="chev">›</span>
        </button>
      </form>
    </Dialog>
  );
};

export const ConnectDialog = ({ onClose }: { onClose: () => void }) => {
  const [cands, setCands] = useState<TailnetCandidate[]>([]);
  const [url, setUrl] = useState("");
  const [key, setK] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void get<TailnetCandidate[]>("/api/machines/discover").then((r) => setCands(r.ok && Array.isArray(r.data) ? r.data.filter((c) => c.kind === "local-studio" && !c.alreadyConnected) : []));
  }, []);
  const connect = async () => {
    setBusy(true);
    setErr(null);
    const r = await post<Peer>("/api/machines", { url: url.trim(), key: key.trim() });
    setBusy(false);
    setK("");
    if (!r.ok) return setErr(r.error);
    setMsg(r.data?.name ?? url);
    setUrl("");
    void loadAll();
  };
  return (
    <Dialog title="CONNECT" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <label htmlFor="cu">url</label>
        <input id="cu" className="input" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
        <label htmlFor="ck">key</label>
        <input id="ck" className="input" type="password" autoComplete="off" value={key} onChange={(e) => setK(e.target.value)} />
      </form>
      {cands.length > 0 && (
        <div className="blk btns">
          {cands.map((c) => (
            <Btn key={c.dnsName} kind="quiet" onClick={() => setUrl(c.url)}>
              {c.hostName}
            </Btn>
          ))}
        </div>
      )}
      <div className="blk btns">
        <Btn kind="primary" onClick={() => void connect()} disabled={busy || !url || key.length < 16}>
          {busy ? "Connecting" : "Connect ›"}
        </Btn>
        {msg && <span className="ink">{msg}</span>}
      </div>
      <Err>{err}</Err>
    </Dialog>
  );
};
