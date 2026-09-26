import { useEffect, useState } from "react";
import type { LaunchPlan, LaunchProgress, Peer, RecipeExport, RecipePr, RecipeRow, TailnetCandidate } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { get, post, setKey, via } from "../api";
import { recipeChips } from "../model/view";
import { loadAll, restart, setState, useStore } from "../store";
import { Btn, Chips, Dialog, Err } from "./basics";

export interface Target {
  machineId: string;
  peerId: string | null;
  readOnly: boolean;
}

const enc = encodeURIComponent;

export const StopDialog = ({
  t,
  modelId,
  name,
  watchdog,
  blocked = null,
  onClose,
}: {
  t: Target;
  modelId: string;
  name: string;
  watchdog: string | null;
  blocked?: string | null;
  onClose: () => void;
}) => {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const stop = async () => {
    setBusy(true);
    setErr(null);
    const r = await post(via(t.peerId, `/api/models/${enc(modelId)}/stop`), { confirm: typed, ...(watchdog ? { force: true } : {}) });
    setBusy(false);
    if (r.ok) setDone(true);
    else setErr(r.error);
  };
  return (
    <Dialog title="stop model" onClose={onClose}>
      <div className="blk value">
        Stop <span className="ink">{name}</span> ({modelId}). Managed containers are stopped and removed; adopted ones are only stopped.
      </div>
      {watchdog && <div className="blk alert">a watchdog ({watchdog}) is running on this machine and may restart this model. Stopping sends force.</div>}
      {t.readOnly ? (
        <div className="blk label">read-only: this controller refuses stop.</div>
      ) : blocked ? (
        <div className="blk label">cannot stop from here: {blocked}</div>
      ) : done ? (
        <div className="blk value">stop requested. the card updates when the scan sees it gone.</div>
      ) : (
        <>
          <div className="blk">
            <div className="label" style={{ marginBottom: 6 }}>
              type <span className="ink">{modelId}</span> to confirm
            </div>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus spellCheck={false} aria-label="model id" />
          </div>
          <div className="blk btns">
            <Btn kind="danger" onClick={stop} disabled={typed !== modelId || busy}>
              {busy ? "Stopping" : "Stop model"}
            </Btn>
            <Btn onClick={onClose}>Cancel</Btn>
          </div>
        </>
      )}
      <Err>{err}</Err>
    </Dialog>
  );
};

export const ExportDialog = ({ t, modelId, onClose }: { t: Target; modelId: string; onClose: () => void }) => {
  const [x, setX] = useState<RecipeExport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pr, setPr] = useState<RecipePr | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void post<RecipeExport>(via(t.peerId, `/api/models/${enc(modelId)}/export`)).then((r) => (r.ok ? setX(r.data) : setErr(r.error)));
  }, [t.peerId, modelId]);
  const openPr = async () => {
    setBusy(true);
    const r = await post<RecipePr>(via(t.peerId, `/api/models/${enc(modelId)}/export/pr`), { draft: true });
    setBusy(false);
    if (r.ok) setPr(r.data);
    else setErr(r.error);
  };
  const blocked = t.readOnly || !x || x.refusals.length > 0;
  return (
    <Dialog title="export recipe" onClose={onClose} wide>
      {!x && !err && <div className="blk label">reading the running model…</div>}
      {x && (
        <>
          <div className="blk row-flex wrap">
            <span className="ink">{x.recipeId}</span>
            <span className="label">{x.launchable ? "launchable" : "not launchable"}</span>
            <span className="label ellipsis">saved to {x.savedTo}</span>
          </div>
          {x.refusals.length > 0 && (
            <div className="blk">
              <div className="label">REFUSALS</div>
              {x.refusals.map((r) => (
                <div className="alert" key={r}>
                  {r}
                </div>
              ))}
            </div>
          )}
          {x.warnings.length > 0 && (
            <div className="blk">
              <div className="label">WARNINGS</div>
              {x.warnings.map((r) => (
                <div className="value" key={r}>
                  {r}
                </div>
              ))}
            </div>
          )}
          <div className="blk">
            <div className="label">RECORD</div>
            <pre className="pre">{JSON.stringify(x.record, null, 2)}</pre>
          </div>
          <div className="blk">
            <div className="label">DOC</div>
            <pre className="pre">{x.doc}</pre>
          </div>
          <div className="blk btns">
            <Btn kind="primary" onClick={openPr} disabled={blocked || busy || !!pr}>
              Open PR ›
            </Btn>
            {t.readOnly && <span className="label">read-only: PRs are refused on this controller</span>}
            {!t.readOnly && x.refusals.length > 0 && <span className="label">fix the refusals first</span>}
          </div>
          {pr && (
            <div className="blk value">
              draft PR:{" "}
              <a className="ink" href={pr.url} target="_blank" rel="noreferrer">
                {pr.url}
              </a>{" "}
              <span className="label">({pr.branch})</span>
            </div>
          )}
        </>
      )}
      <Err>{err}</Err>
    </Dialog>
  );
};

const ACTIVE = new Set(["planning", "weights", "pulling", "starting", "loading"]);

export const cancelLaunch = async (t: Target, launchId: string): Promise<string | null> => {
  const r = await post<{ ok: boolean }>(via(t.peerId, `/api/launches/${enc(launchId)}/cancel`));
  return r.ok ? null : r.error;
};

export const LaunchDialog = ({ t, recipe, recipeId, gpuKeys, onClose }: { t: Target; recipe: RecipeRow | null; recipeId: string; gpuKeys: string[] | null; onClose: () => void }) => {
  const groups = recipe?.freeGroups.length ? recipe.freeGroups : gpuKeys ? [gpuKeys] : [];
  const [pick, setPick] = useState<string[] | null>(gpuKeys ?? groups[0] ?? null);
  const [plan, setPlan] = useState<{ plan: LaunchPlan; dockerArgv: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [launch, setLaunch] = useState<LaunchProgress | null>(null);
  const live = useStore((s) => (launch ? s.launches[launch.launchId] : undefined));
  const prog = live && launch && live.updatedAt >= launch.updatedAt ? live : launch;
  useEffect(() => {
    setPlan(null);
    setErr(null);
    const q = pick ? `?gpuKeys=${enc(pick.join(","))}` : "";
    void get<{ plan: LaunchPlan; dockerArgv: string[] }>(via(t.peerId, `/api/recipes/${enc(recipeId)}/plan${q}`)).then((r) => (r.ok ? setPlan(r.data) : setErr(r.error)));
  }, [t.peerId, recipeId, pick]);
  useEffect(() => {
    if (!launch || !t.peerId || !prog || !ACTIVE.has(prog.phase)) return;
    const iv = setInterval(async () => {
      const r = await get<LaunchProgress[]>(via(t.peerId, "/api/launches"));
      const l = r.ok && Array.isArray(r.data) ? r.data.find((x) => x.launchId === launch.launchId) : undefined;
      if (l) setLaunch(l);
    }, 2000);
    return () => clearInterval(iv);
  }, [launch, t.peerId, prog]);
  const go = async () => {
    setErr(null);
    const r = await post<LaunchProgress>(via(t.peerId, `/api/recipes/${enc(recipeId)}/launch`), pick ? { gpuKeys: pick } : {});
    if (r.ok) {
      setLaunch(r.data);
      if (!t.peerId) setState((s) => ({ launches: { ...s.launches, [r.data.launchId]: r.data } }));
    } else setErr(r.error);
  };
  return (
    <Dialog title={`launch ${recipe?.name ?? recipeId}`} onClose={onClose} wide>
      {recipe && (
        <div className="blk">
          <Chips chips={[{ text: recipe.engine }, ...recipeChips(recipe), { icon: "gpu", text: `${recipe.cards} × ${recipe.hardwareId}` }]} className="value" />
        </div>
      )}
      {groups.length > 1 && (
        <div className="blk">
          <div className="label">GPUS</div>
          {groups.map((g) => (
            <div key={g.join()} className={`opt${pick?.join() === g.join() ? " on" : ""}`} style={{ padding: 0 }} onClick={() => setPick(g)}>
              <span className="ck">{pick?.join() === g.join() ? "✓" : ""}</span>
              <span className="lb">{g.join(", ")}</span>
            </div>
          ))}
        </div>
      )}
      {plan ? (
        <div className="blk">
          <div className="label">PLAN (nothing runs until you press Launch)</div>
          <dl className="kv" style={{ marginTop: 6 }}>
            <dt>container</dt>
            <dd>{plan.plan.containerName}</dd>
            <dt>image</dt>
            <dd className="ellipsis">{plan.plan.image}</dd>
            <dt>gpus</dt>
            <dd>{plan.plan.gpuKeys.join(", ")}</dd>
            <dt>port</dt>
            <dd>
              127.0.0.1:{plan.plan.hostPort} → {plan.plan.containerPort}
            </dd>
            <dt>served as</dt>
            <dd>{plan.plan.servedName}</dd>
            {plan.plan.injected.length > 0 && (
              <>
                <dt>injected</dt>
                <dd>{plan.plan.injected.join(" ")}</dd>
              </>
            )}
            {plan.plan.mounts.map((m) => (
              <span key={m.target} style={{ display: "contents" }}>
                <dt>mount</dt>
                <dd className="ellipsis">
                  {m.source} → {m.target}
                  {m.readOnly ? " (ro)" : ""}
                </dd>
              </span>
            ))}
          </dl>
          <pre className="pre" style={{ marginTop: 8 }}>
            {plan.dockerArgv.join(" ")}
          </pre>
        </div>
      ) : (
        !err && <div className="blk label">planning…</div>
      )}
      {prog && (
        <div className="blk">
          <div className={prog.phase === "failed" ? "alert" : "value"}>
            {prog.phase}
            {prog.percent !== null ? ` · ${Math.round(prog.percent)}%` : ""}
            {prog.detail ? ` · ${prog.detail}` : ""} <span className="label">{fmt.ms(prog.updatedAt - prog.startedAt)}</span>
          </div>
          {prog.percent !== null && (
            <div className="progress">
              <div style={{ width: `${prog.percent}%` }} />
            </div>
          )}
          {prog.error && <div className="alert">{prog.error}</div>}
        </div>
      )}
      <div className="blk btns">
        <Btn kind="primary" onClick={go} disabled={t.readOnly || !plan || !!(prog && ACTIVE.has(prog.phase))}>
          Launch ›
        </Btn>
        {prog && ACTIVE.has(prog.phase) && (
          <Btn kind="danger" onClick={() => void cancelLaunch(t, prog.launchId).then((e) => setErr(e))} disabled={t.readOnly}>
            Stop
          </Btn>
        )}
        <Btn onClick={onClose}>Close</Btn>
        {t.readOnly && <span className="label">read-only: this controller refuses launches</span>}
      </div>
      <Err>{err}</Err>
    </Dialog>
  );
};

export const KeyPrompt = () => {
  const [v, setV] = useState("");
  return (
    <Dialog title="controller key" onClose={() => setState({ needKey: false })}>
      <div className="blk label">This controller needs its admin key (on the host: local-studio key). It is kept in this browser only.</div>
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
        <input className="input" type="password" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} placeholder="admin key" autoFocus aria-label="admin key" />
        <button type="submit" className="btn primary has-chev">
          Save<span className="chev">›</span>
        </button>
      </form>
    </Dialog>
  );
};

export const ConnectDialog = ({ onClose }: { onClose: () => void }) => {
  const [cands, setCands] = useState<TailnetCandidate[] | null>(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
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
    setKey("");
    if (!r.ok) return setErr(r.error);
    setMsg(`connected ${r.data?.name ?? url}`);
    setUrl("");
    void loadAll();
  };
  return (
    <Dialog title="connect a controller" onClose={onClose}>
      <form
        className="blk form"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <label htmlFor="cu">url</label>
        <input id="cu" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://host:8080" spellCheck={false} />
        <label htmlFor="ck">key</label>
        <input id="ck" className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="local-studio key --federation" />
      </form>
      {cands && cands.length > 0 && (
        <div className="blk btns">
          {cands.map((c) => (
            <Btn key={c.dnsName} onClick={() => setUrl(c.url)}>
              {c.hostName}
            </Btn>
          ))}
        </div>
      )}
      <div className="blk btns">
        <Btn kind="primary" onClick={() => void connect()} disabled={busy || !url || key.length < 16}>
          {busy ? "Connecting" : "Connect ›"}
        </Btn>
        {msg && <span className="value">{msg}</span>}
      </div>
      <div className="blk label">The key is stored on this controller (0600) and never shown again.</div>
      <Err>{err}</Err>
    </Dialog>
  );
};
