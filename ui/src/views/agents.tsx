import { useEffect, useState } from "react";
import type { AgentLaunchResult, AgentSession, HarnessInfo, HarnessJob } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { call, get, post } from "../api";
import { Btn, Copy, Err, Sec, Table } from "../components/basics";
import { homeDir } from "../model/view";
import { useStore } from "../store";

const AGENTS = [
  ["dsh", "DeepSeek Harness"],
  ["claude", "Claude Code"],
  ["codex", "Codex"],
  ["pi", "pi"],
  ["omp", "omp"],
] as const;

type Agent = (typeof AGENTS)[number][0];
const DESKTOP = /Electron/.test(navigator.userAgent);
const label = (h: string) => AGENTS.find(([k]) => k === h)?.[1] ?? h;
const enc = encodeURIComponent;

export const AgentsPage = ({ model }: { model: string | null }) => {
  const now = useStore((s) => s.now);
  const readOnly = useStore((s) => s.fleet?.machines.find((m) => m.peerId === null)?.snapshot?.machine.readOnly ?? false);
  const [infos, setInfos] = useState<HarnessInfo[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [pick, setPick] = useState(model ?? "");
  const [dir, setDir] = useState("");
  const [res, setRes] = useState<AgentLaunchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInfos = () => void call<HarnessInfo[]>("GET", "/api/agents", undefined, 60_000).then((r) => r.ok && Array.isArray(r.data) && setInfos(r.data));
  const loadSessions = () => void get<AgentSession[]>("/api/agents/sessions").then((r) => r.ok && Array.isArray(r.data) && setSessions(r.data));
  const loadModels = () =>
    void get<{ data?: { id: string }[] }>("/v1/models").then((r) => {
      const list = r.ok && Array.isArray(r.data?.data) ? r.data.data.map((x) => x.id) : [];
      setModels(list);
      if (list[0]) setPick((p) => p || list[0]!);
    });
  const installing = infos.some((i) => i.job?.state === "running");
  useEffect(() => {
    loadInfos();
    loadSessions();
    loadModels();
    const t = setInterval(() => (loadSessions(), loadModels()), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!installing) return;
    const t = setInterval(loadInfos, 2000);
    return () => clearInterval(t);
  }, [installing]);

  const install = async (h: string) => {
    setErr(null);
    const r = await post<HarnessJob>(`/api/agents/${h}/install`);
    if (!r.ok) return setErr(r.error);
    setInfos((xs) => xs.map((x) => (x.harness === h ? { ...x, job: r.data } : x)));
  };
  const launch = async () => {
    if (!agent) return;
    setBusy(true);
    setErr(null);
    setRes(null);
    const r = await call<AgentLaunchResult>("POST", `/api/agents/launch?terminal=${DESKTOP ? "auto" : "none"}`, { harness: agent, model: pick, ...(dir.trim() ? { dir: dir.trim() } : {}) }, 90_000);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setRes(r.data);
    loadSessions();
    if (DESKTOP && r.data.url) window.open(r.data.url);
  };
  const stop = async (id: string) => {
    const r = await call<{ ok: boolean }>("DELETE", `/api/agents/sessions/${enc(id)}`);
    if (!r.ok) setErr(r.error);
    loadSessions();
  };
  const attach = async (s: AgentSession) => {
    if (!DESKTOP) return void navigator.clipboard?.writeText(s.attach ?? "");
    const r = await post<{ ok: boolean }>(`/api/agents/sessions/${enc(s.id)}/attach`);
    if (!r.ok) setErr(r.error);
  };
  const info = (h: string) => infos.find((x) => x.harness === h);
  const sel = agent ? info(agent) : undefined;

  return (
    <>
      <div className="crumb">
        <span className="title">Agent</span>
      </div>
      <Sec>harness</Sec>
      <div className="chips">
        {AGENTS.map(([h, l]) => {
          const i = info(h);
          return (
            <button key={h} type="button" className={`chip${agent === h ? " on" : ""}`} onClick={() => (setAgent(h), setRes(null))}>
              <span>{l}</span>
              {i && !i.installed && <span className="label">not installed</span>}
            </button>
          );
        })}
      </div>
      <div className="form">
        <label htmlFor="m">model</label>
        <select id="m" className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
          {pick && !models.includes(pick) && <option value={pick}>{pick}</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label htmlFor="d">folder</label>
        <input id="d" className="input" value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} />
      </div>
      <div className="btns gut" style={{ marginTop: "var(--pad)" }}>
        <Btn kind="primary" onClick={() => void launch()} disabled={!agent || !pick || busy || readOnly || !sel?.installed}>
          {busy ? "Starting" : agent ? `Launch ${label(agent)} on ${pick || "–"} ›` : "Launch ›"}
        </Btn>
      </div>
      <Err>{err}</Err>
      {res && (
        <div className="gut" style={{ marginTop: "var(--pad)" }}>
          <div className="ink">{[label(res.harness), res.version, res.how, homeDir(res.dir)].filter(Boolean).join(" · ")}</div>
          {res.url && (
            <div className="btns" style={{ marginTop: "var(--edge)" }}>
              <Btn kind="primary" href={res.url}>
                Open ›
              </Btn>
            </div>
          )}
          {res.attach && <Copy text={res.attach} />}
        </div>
      )}
      <Sec>sessions</Sec>
      <Table<AgentSession>
        cols={[
          { h: "harness", c: (s) => <span className="ink">{label(s.harness)}</span> },
          { h: "model", c: (s) => s.model || "–" },
          { h: "folder", c: (s) => homeDir(s.dir) },
          { h: "started", c: (s) => (s.startedAt ? fmt.ago(s.startedAt, now) : "–") },
          {
            h: "",
            n: true,
            c: (s) => (
              <span className="btns" style={{ justifyContent: "flex-end" }}>
                {s.url ? <Btn href={s.url}>Open ›</Btn> : s.attach ? <Btn onClick={() => void attach(s)}>{DESKTOP ? "Attach ›" : "Copy attach"}</Btn> : null}
                <Btn kind="danger" onClick={() => void stop(s.id)} disabled={readOnly}>
                  Stop
                </Btn>
              </span>
            ),
          },
        ]}
        rows={sessions}
        keyOf={(s) => s.id}
      />
      <Sec>versions</Sec>
      <div className="chips" style={{ gap: "var(--edge) var(--group)" }}>
        {infos.map((i) => {
          const update = !i.installed || (i.latest && i.version !== i.latest);
          const failed = i.job?.state === "failed";
          return (
            <span key={i.harness} className="row-flex">
              <span className={failed ? "alert" : ""}>{i.harness}</span>
              <span className="label">{i.version ?? "–"}</span>
              {i.job?.state === "running" ? (
                <span className="label">{`${i.job.action}ing`}</span>
              ) : update ? (
                <Btn kind="quiet" onClick={() => void install(i.harness)} disabled={readOnly} title={failed ? (i.job?.detail ?? "") : undefined}>
                  {i.installed ? `Update ${i.latest ?? ""}`.trim() : "Install"}
                </Btn>
              ) : null}
            </span>
          );
        })}
      </div>
    </>
  );
};
