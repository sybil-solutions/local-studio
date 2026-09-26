import { useEffect, useState } from "react";
import type { AgentLaunchResult, AgentSession, HarnessInfo, HarnessJob } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { call, get, post } from "../api";
import { Btn, Copy, Err, SectionHeading, Table } from "../components/basics";
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
const jobText = (j: HarnessJob | null) => (!j ? "" : j.state === "running" ? `${j.action}ing` : j.state === "failed" ? `${j.action} failed: ${j.detail}` : "");

export const AgentsPage = ({ model }: { model: string | null }) => {
  const now = useStore((s) => s.now);
  const readOnly = useStore((s) => s.fleet?.machines.find((m) => m.peerId === null)?.snapshot?.machine.readOnly ?? false);
  const [infos, setInfos] = useState<HarnessInfo[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [models, setModels] = useState<{ id: string; context_length?: number }[]>([]);
  const [agent, setAgent] = useState<Agent>("claude");
  const [pick, setPick] = useState(model ?? "");
  const [dir, setDir] = useState("");
  const [res, setRes] = useState<AgentLaunchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInfos = () => void call<HarnessInfo[]>("GET", "/api/agents", undefined, 60_000).then((r) => r.ok && Array.isArray(r.data) && setInfos(r.data));
  const loadSessions = () => void get<AgentSession[]>("/api/agents/sessions").then((r) => r.ok && Array.isArray(r.data) && setSessions(r.data));
  const loadModels = () =>
    void get<{ data?: { id: string; context_length?: number }[] }>("/v1/models").then((r) => {
      const list = r.ok && Array.isArray(r.data?.data) ? r.data.data : [];
      setModels(list);
      if (list[0]) setPick((p) => p || list[0]!.id);
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
    const r = await call<{ ok: boolean }>("DELETE", `/api/agents/sessions/${encodeURIComponent(id)}`);
    if (!r.ok) setErr(r.error);
    loadSessions();
  };
  const attach = async (s: AgentSession) => {
    if (!DESKTOP) return void navigator.clipboard?.writeText(s.attach ?? "");
    const r = await post<{ ok: boolean }>(`/api/agents/sessions/${encodeURIComponent(s.id)}/attach`);
    if (!r.ok) setErr(r.error);
  };
  const info = (h: string) => infos.find((x) => x.harness === h);
  const sel = info(agent);

  return (
    <div className="page">
      <div className="half">
        <SectionHeading>harness</SectionHeading>
        <Table<(typeof AGENTS)[number]>
          cols={[
            { h: "", c: ([h]) => (agent === h ? "✓" : "") },
            { h: "harness", c: ([h, l]) => <span className={agent === h ? "ink" : ""}>{l}</span> },
            { h: "installed", c: ([h]) => info(h)?.version ?? (info(h) ? (info(h)!.installed ? "?" : "–") : "") },
            { h: "latest", c: ([h]) => info(h)?.latest ?? "–" },
            {
              h: " ",
              c: ([h]) => {
                const i = info(h);
                if (!i) return null;
                if (i.job?.state === "running") return <span className="label">{jobText(i.job)}</span>;
                const update = i.installed && i.latest && i.version !== i.latest;
                if (i.installed && !update) return i.managed ? <span className="label">managed</span> : null;
                return <Btn onClick={() => void install(h)} disabled={readOnly}>{i.installed ? "Update" : "Install"}</Btn>;
              },
            },
          ]}
          rows={[...AGENTS]}
          keyOf={([h]) => h}
          onRow={([h]) => (setAgent(h), setRes(null))}
        />
        {infos.filter((i) => i.job?.state === "failed").map((i) => (
          <Err key={i.harness}>{`${label(i.harness)}: ${jobText(i.job)}`}</Err>
        ))}
        <div className="form">
          <label htmlFor="m">model</label>
          <select id="m" className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            {pick && !models.some((m) => m.id === pick) && <option value={pick}>{pick}</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.context_length ? ` · ${fmt.ctx(m.context_length)}` : ""}
              </option>
            ))}
          </select>
          <label htmlFor="d">folder</label>
          <input id="d" className="input" value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} />
        </div>
        <div className="btns gut" style={{ marginTop: "var(--group)" }}>
          <Btn kind="primary" onClick={() => void launch()} disabled={!pick || busy || readOnly || !sel?.installed}>
            {busy ? "Starting" : `Launch ${label(agent)} ›`}
          </Btn>
        </div>
        <Err>{err}</Err>
        {res && (
          <div className="gut" style={{ marginTop: "var(--group)" }}>
            <div className="ink">
              {label(res.harness)} {res.version ?? ""} · {res.how} · {homeDir(res.dir)}
            </div>
            {res.running && <div className="label cut">{res.running}</div>}
            {res.url && (
              <div className="btns" style={{ marginTop: "var(--block)" }}>
                <Btn kind="primary" href={res.url}>
                  Open DeepSeek Harness ›
                </Btn>
              </div>
            )}
            {res.attach && <Copy text={res.attach} />}
          </div>
        )}
      </div>
      <div className="half">
        <SectionHeading>sessions</SectionHeading>
        <Table<AgentSession>
          cols={[
            { h: "harness", c: (s) => label(s.harness) },
            { h: "model", c: (s) => <span className="cut">{s.model || "–"}</span> },
            { h: "folder", c: (s) => <span className="cut">{homeDir(s.dir)}</span> },
            { h: "started", c: (s) => (s.startedAt ? fmt.ago(s.startedAt, now) : "–") },
            {
              h: "",
              c: (s) => (
                <span className="btns">
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
      </div>
    </div>
  );
};
