import { useEffect, useState } from "react";
import type { LaunchPlan, LaunchProgress, Peer, RecipeExport, RecipePr, RecipeRow, TailnetCandidate } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { call, get, post, setKey, via } from "../api";
import { fmtFormat, type MachineView, type RecipeView } from "../model/view";
import { loadAll, loadRecipes, restart, setState, useStore } from "../store";
import { Btn, Dialog, Err, KV, SectionHeading, Table } from "./basics";

export interface Target {
  machineId: string;
  peerId: string | null;
  readOnly: boolean;
}

const enc = encodeURIComponent;

export const StopDialog = ({ t, modelId, name, watchdog, blocked = null, onClose }: { t: Target; modelId: string; name: string; watchdog: string | null; blocked?: string | null; onClose: () => void }) => {
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
      <div className="blk">
        <KV rows={[["model", name, "ink"], ["id", modelId], ...(watchdog ? [["watchdog", watchdog, "alert"] as [string, string, string]] : []), ...(blocked ? [["blocked", blocked, "alert"] as [string, string, string]] : [])]} />
      </div>
      {done ? (
        <div className="blk ink">stopping</div>
      ) : (
        !blocked &&
        !t.readOnly && (
          <>
            <div className="blk">
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus spellCheck={false} aria-label="type the model id" />
            </div>
            <div className="blk btns">
              <Btn kind="danger" onClick={stop} disabled={typed !== modelId || busy}>
                {busy ? "Stopping" : "Stop model"}
              </Btn>
              <Btn onClick={onClose}>Cancel</Btn>
            </div>
          </>
        )
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
  return (
    <Dialog title="export recipe" onClose={onClose} wide>
      {x && (
        <>
          <div className="blk">
            <KV rows={[["recipe", x.recipeId, "ink"], ["launchable", x.launchable ? "yes" : "no"], ["saved", x.savedTo], ...x.refusals.map((r): [string, string, string] => ["refusal", r, "alert"]), ...x.warnings.map((r): [string, string] => ["warning", r])]} />
          </div>
          <div className="blk">
            <pre className="pre">{JSON.stringify(x.record, null, 2)}</pre>
          </div>
          <div className="blk btns">
            <Btn kind="primary" onClick={openPr} disabled={t.readOnly || x.refusals.length > 0 || busy || !!pr}>
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

const ACTIVE = new Set(["planning", "weights", "pulling", "starting", "loading"]);

export const cancelLaunch = async (t: Target, launchId: string): Promise<string | null> => {
  const r = await post<{ ok: boolean }>(via(t.peerId, `/api/launches/${enc(launchId)}/cancel`));
  return r.ok ? null : r.error;
};

const LaunchPanel = ({ t, recipe }: { t: Target; recipe: RecipeRow }) => {
  const groups = recipe.freeGroups;
  const [pick, setPick] = useState<string[] | null>(groups[0] ?? null);
  const [plan, setPlan] = useState<{ plan: LaunchPlan; dockerArgv: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [launch, setLaunch] = useState<LaunchProgress | null>(null);
  const live = useStore((s) => (launch ? s.launches[launch.launchId] : undefined));
  const prog = live && launch && live.updatedAt >= launch.updatedAt ? live : launch;
  useEffect(() => {
    setPlan(null);
    setErr(null);
    const q = pick ? `?gpuKeys=${enc(pick.join(","))}` : "";
    void get<{ plan: LaunchPlan; dockerArgv: string[] }>(via(t.peerId, `/api/recipes/${enc(recipe.id)}/plan${q}`)).then((r) => (r.ok ? setPlan(r.data) : setErr(r.error)));
  }, [t.peerId, recipe.id, pick]);
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
    const r = await post<LaunchProgress>(via(t.peerId, `/api/recipes/${enc(recipe.id)}/launch`), pick ? { gpuKeys: pick } : {});
    if (r.ok) {
      setLaunch(r.data);
      if (!t.peerId) setState((s) => ({ launches: { ...s.launches, [r.data.launchId]: r.data } }));
    } else setErr(r.error);
  };
  return (
    <>
      {groups.length > 1 &&
        groups.map((g) => (
          <div key={g.join()} className={`opt${pick?.join() === g.join() ? " on" : ""}`} onClick={() => setPick(g)}>
            <span className="ck">{pick?.join() === g.join() ? "✓" : ""}</span>
            <span className="lb">{g.join(", ")}</span>
          </div>
        ))}
      {plan && (
        <div className="blk">
          <KV
            rows={[
              ["container", plan.plan.containerName],
              ["gpus", plan.plan.gpuKeys.join(", ")],
              ["port", `127.0.0.1:${plan.plan.hostPort} → ${plan.plan.containerPort}`],
              ["injected", plan.plan.injected.join(" ") || "–"],
              ...plan.plan.mounts.map((m): [string, string] => ["mount", `${m.source} → ${m.target}${m.readOnly ? " ro" : ""}`]),
            ]}
          />
          <pre className="pre" style={{ marginTop: "var(--block)" }}>
            {plan.dockerArgv.join(" ")}
          </pre>
        </div>
      )}
      {prog && (
        <div className="blk">
          <div className={prog.phase === "failed" ? "alert" : "ink"}>
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
      </div>
      <Err>{err}</Err>
    </>
  );
};

const FIT: Record<RecipeRow["fit"], string> = { fits: "fits", busy: "busy", "no-hardware": "no hardware", "too-few-gpus": "too few GPUs" };

export const RecipeDialog = ({ v, onClose }: { v: RecipeView; onClose: () => void }) => {
  const stats = useStore((s) => s.stats);
  const [target, setTarget] = useState<MachineView | null>(v.per.length === 1 && v.per[0]!.row.fit === "fits" ? v.per[0]!.m : null);
  const [err, setErr] = useState<string | null>(null);
  const r = v.r;
  const assign = async (m: MachineView, on: boolean) => {
    const res = await call("PUT", via(m.peerId, `/api/recipes/${enc(r.id)}/assigned`), { on });
    setErr(res.ok ? null : `${m.name}: ${res.error}`);
    await loadRecipes(m.id, m.peerId);
  };
  const slice = (m: MachineView) => stats[m.id]?.sum?.byModel.find((s) => s.key === r.servedName) ?? null;
  const row = target ? v.per.find((p) => p.m.id === target.id)?.row : undefined;
  const caps = Object.entries(r.caps).filter(([, on]) => on).map(([k]) => k);
  return (
    <Dialog title={r.name} onClose={onClose} wide>
      <div className="page">
        <div className="half">
          <SectionHeading>recipe</SectionHeading>
          <div className="gut">
            <KV
              rows={[
                ["id", r.id],
                ["source", r.source ?? "registry"],
                ["engine", r.engine],
                ["format", fmtFormat(r.format)],
                ["served as", r.servedName],
                ["gpus", `${r.cards} × ${r.hardwareId}`],
                ["context", fmt.ctx(r.ctxTokens)],
                ["kv tokens", fmt.k(r.kvTokens)],
                ["size", r.sizeGb ? `${Math.round(r.sizeGb)} GB` : "–"],
                ["caps", caps.join(" · ") || "–"],
                ["image", r.image],
                ...r.weights.map((w): [string, string] => ["weights", w.hostPath ?? `${w.repository}@${w.revision.slice(0, 12)}`]),
                ["port", String(r.launch.port)],
                ["shm", r.launch.shm ?? "–"],
                ["entrypoint", r.launch.entrypoint ?? "–"],
              ]}
            />
          </div>
        </div>
        <div className="half">
          <SectionHeading>argv</SectionHeading>
          <div className="gut">
            <pre className="pre">{r.launch.arguments.join(" ")}</pre>
          </div>
          <SectionHeading>env</SectionHeading>
          <div className="gut">
            <pre className="pre">{Object.entries(r.launch.environment).map(([k, x]) => `${k}=${x}`).join("\n") || "–"}</pre>
          </div>
        </div>
        <SectionHeading>machines</SectionHeading>
        <Table
          cols={[
            { h: "machine", c: (p: RecipeView["per"][number]) => <span className={target?.id === p.m.id ? "ink" : ""}>{p.m.name}</span> },
            { h: "fit", c: (p) => (p.row.runningModelId ? "running" : FIT[p.row.fit]) },
            { h: "free", c: (p) => p.row.freeGroups.map((g) => g.join(",")).join("  ") || "–" },
            { h: "weights", c: (p) => (p.row.weightsPresent === null ? "–" : p.row.weightsPresent ? "here" : r.source ? "missing" : "download") },
            { h: "req", n: true, c: (p) => fmt.k(slice(p.m)?.requests) },
            { h: "decode", n: true, c: (p) => fmt.tps(slice(p.m)?.decodeTps) },
            { h: "prefill", n: true, c: (p) => fmt.tps(slice(p.m)?.prefillTps) },
            { h: "ttft", n: true, c: (p) => fmt.ms(slice(p.m)?.meanTtftMs) },
            {
              h: "assigned",
              c: (p) => (
                <Btn kind={p.row.assigned ? "primary" : "secondary"} onClick={() => void assign(p.m, !p.row.assigned)} disabled={p.m.readOnly}>
                  {p.row.assigned ? "Assigned" : "Assign"}
                </Btn>
              ),
            },
            { h: "", c: (p) => <Btn onClick={() => setTarget(p.m)} disabled={p.row.fit !== "fits" || !!p.row.runningModelId}>Plan ›</Btn> },
          ]}
          rows={v.per}
          keyOf={(p) => p.m.id}
        />
        <Err>{err}</Err>
        {target && row && (
          <div>
            <SectionHeading>{`launch on ${target.name}`}</SectionHeading>
            <LaunchPanel key={target.id} t={{ machineId: target.id, peerId: target.peerId, readOnly: target.readOnly }} recipe={row} />
          </div>
        )}
      </div>
    </Dialog>
  );
};

export const KeyPrompt = () => {
  const [v, setV] = useState("");
  return (
    <Dialog title="controller key" onClose={() => setState({ needKey: false })}>
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
    setMsg(r.data?.name ?? url);
    setUrl("");
    void loadAll();
  };
  return (
    <Dialog title="connect" onClose={onClose}>
      <form
        className="blk form"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <label htmlFor="cu">url</label>
        <input id="cu" className="input" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
        <label htmlFor="ck">key</label>
        <input id="ck" className="input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} />
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
        {msg && <span className="ink">{msg}</span>}
      </div>
      <Err>{err}</Err>
    </Dialog>
  );
};
