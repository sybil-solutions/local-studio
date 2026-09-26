import { useEffect, useState } from "react";
import type { AgentLaunchResult, HarnessInfo, Workspace } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { get, post } from "../api";
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

export const AgentsPage = ({ model }: { model: string | null }) => {
  const now = useStore((s) => s.now);
  const readOnly = useStore((s) => s.fleet?.machines.find((m) => m.peerId === null)?.snapshot?.machine.readOnly ?? false);
  const [infos, setInfos] = useState<HarnessInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [models, setModels] = useState<{ id: string; context_length?: number }[] | null>(null);
  const [agent, setAgent] = useState<Agent>("claude");
  const [pick, setPick] = useState(model ?? "");
  const [ws, setWs] = useState("");
  const [dir, setDir] = useState("");
  const [res, setRes] = useState<AgentLaunchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadWs = () => void get<Workspace[]>("/api/workspaces").then((r) => r.ok && Array.isArray(r.data) && setWorkspaces(r.data));
  useEffect(() => {
    void get<HarnessInfo[]>("/api/agents").then((r) => r.ok && Array.isArray(r.data) && setInfos(r.data));
    loadWs();
    void get<{ data?: { id: string; context_length?: number }[] }>("/v1/models").then((r) => {
      const list = r.ok && Array.isArray(r.data?.data) ? r.data.data : [];
      setModels(list);
      if (list[0]) setPick((p) => p || list[0]!.id);
    });
  }, []);

  const launch = async (body: { harness: string; model: string; workspaceId?: string; dir?: string }) => {
    setBusy(true);
    setErr(null);
    setRes(null);
    const r = await post<AgentLaunchResult>(`/api/agents/launch?terminal=${DESKTOP ? "auto" : "none"}`, body);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setRes(r.data);
    loadWs();
    if (DESKTOP && r.data.url) window.open(r.data.url);
  };
  const info = (h: string) => infos.find((x) => x.harness === h);
  const mine = workspaces.filter((w) => w.harness === agent);
  const go = () => void launch({ harness: agent, model: pick, ...(ws ? { workspaceId: ws } : dir ? { dir } : {}) });

  return (
    <div className="page">
      <div className="half">
        <SectionHeading>agent</SectionHeading>
        {AGENTS.map(([h, label]) => {
          const i = info(h);
          return (
            <div key={h} className={`opt${agent === h ? " on" : ""}`} onClick={() => (setAgent(h), setWs(""))}>
              <span className="ck">{agent === h ? "✓" : ""}</span>
              <span className="lb">{label}</span>
              <span className="ellipsis rv">{i ? (i.installed ? i.version ?? "installed" : "not installed") : ""}</span>
            </div>
          );
        })}
        <div className="form">
          <label htmlFor="m">model</label>
          <select id="m" className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            {pick && !models?.some((m) => m.id === pick) && <option value={pick}>{pick}</option>}
            {(models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.context_length ? ` · ${fmt.ctx(m.context_length)}` : ""}
              </option>
            ))}
          </select>
          <label htmlFor="w">workspace</label>
          <select id="w" className="input" value={ws} onChange={(e) => setWs(e.target.value)}>
            <option value="">new workspace</option>
            {mine.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · {homeDir(w.dir)}
              </option>
            ))}
          </select>
          {!ws && (
            <>
              <label htmlFor="d">folder</label>
              <input id="d" className="input" value={dir} onChange={(e) => setDir(e.target.value)} spellCheck={false} />
            </>
          )}
        </div>
        <div className="btns gut" style={{ marginTop: "var(--group)" }}>
          <Btn kind="primary" onClick={go} disabled={!pick || busy || readOnly}>
            {busy ? "Starting" : DESKTOP ? (agent === "dsh" ? "Open ›" : "Open terminal ›") : "Start ›"}
          </Btn>
        </div>
        <Err>{err}</Err>
        {res && (
          <div className="gut" style={{ marginTop: "var(--group)" }}>
            <div className="ink">
              {res.how} · {res.workspaceId}
            </div>
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
        <SectionHeading>workspaces</SectionHeading>
        <Table<Workspace>
          cols={[
            { h: "name", c: (w) => w.name },
            { h: "agent", c: (w) => w.harness },
            { h: "model", c: (w) => <span className="cut">{w.model}</span> },
            { h: "folder", c: (w) => homeDir(w.dir) },
            { h: "opened", c: (w) => (w.lastOpenAt ? fmt.ago(w.lastOpenAt, now) : "–") },
            { h: "", c: (w) => <Btn onClick={() => void launch({ harness: w.harness, model: w.model, workspaceId: w.id })} disabled={busy || readOnly}>Open ›</Btn> },
          ]}
          rows={workspaces.filter((w) => AGENTS.some(([h]) => h === w.harness))}
          keyOf={(w) => w.id}
        />
      </div>
    </div>
  );
};
