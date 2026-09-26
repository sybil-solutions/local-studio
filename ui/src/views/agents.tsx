import { useEffect, useState } from "react";
import type { AgentLaunchResult, DshStatus, Harness, HarnessInfo, Workspace } from "@local-studio/contracts/client";
import { fmt, HARNESSES } from "@local-studio/contracts/client";
import { get, post } from "../api";
import { Btn, Err, FieldRow, SectionHeading, Table } from "../components/basics";
import { homeDir } from "../model/view";
import { useStore } from "../store";

interface GwModel {
  id: string;
  owned_by?: string;
  context_length?: number;
  local_studio?: { state?: string; via?: string };
}

export const AgentsPage = ({ model }: { model: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const now = useStore((s) => s.now);
  const self = fleet?.machines.find((m) => m.machineId === fleet.self)?.snapshot?.machine ?? null;
  const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [models, setModels] = useState<GwModel[] | null>(null);
  const [dsh, setDsh] = useState<DshStatus | null>(null);
  const [harness, setHarness] = useState<Harness>("dsh");
  const [pick, setPick] = useState(model ?? "");
  const [dir, setDir] = useState("");
  const [name, setName] = useState("");
  const [resume, setResume] = useState(false);
  const [res, setRes] = useState<AgentLaunchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void get<HarnessInfo[]>("/api/agents").then((r) => setHarnesses(r.ok && Array.isArray(r.data) ? r.data : fleet?.harnesses ?? []));
    void get<Workspace[]>("/api/workspaces").then((r) => setWorkspaces(r.ok && Array.isArray(r.data) ? r.data : fleet?.workspaces ?? []));
    void get<DshStatus>("/api/agents/dsh").then((r) => setDsh(r.ok && r.data && typeof r.data === "object" ? r.data : null));
    void get<{ data?: GwModel[] }>("/v1/models").then((r) => {
      const list = r.ok && Array.isArray(r.data?.data) ? r.data.data : [];
      setModels(list);
      if (!model && list[0]) setPick((p) => p || list[0]!.id);
    });
  }, []);

  const launch = async () => {
    setBusy(true);
    setErr(null);
    setRes(null);
    const r = await post<AgentLaunchResult>("/api/agents/launch", { harness, model: pick, ...(dir ? { dir } : {}), ...(name ? { name } : {}), ...(resume ? { resume } : {}) });
    setBusy(false);
    if (r.ok) setRes(r.data);
    else setErr(r.error);
  };
  const info = harnesses.find((h) => h.harness === harness);

  return (
    <div className="cols">
      <div className="col">
        <SectionHeading>launch an agent</SectionHeading>
        <div className="form">
          <label htmlFor="h">harness</label>
          <select id="h" className="input" value={harness} onChange={(e) => setHarness(e.target.value as Harness)}>
            {HARNESSES.map((h) => (
              <option key={h} value={h}>
                {h}
                {harnesses.find((x) => x.harness === h)?.installed === false ? " (not installed)" : ""}
              </option>
            ))}
          </select>
          <label htmlFor="m">model</label>
          <select id="m" className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
            {pick && !models?.some((m) => m.id === pick) && <option value={pick}>{pick}</option>}
            {(models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.owned_by ? ` · ${m.owned_by}` : ""}
                {m.context_length ? ` · ${fmt.ctx(m.context_length)}` : ""}
              </option>
            ))}
          </select>
          <label htmlFor="d">folder</label>
          <input id="d" className="input" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="~/LocalStudio/workspaces/<name>" spellCheck={false} />
          <label htmlFor="n">name</label>
          <input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="optional" spellCheck={false} />
          <label htmlFor="r">resume</label>
          <input id="r" type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} style={{ justifySelf: "start" }} />
        </div>
        {info && <div className="note gap-block">{info.note || (info.installed ? `${info.path ?? ""} ${info.version ?? ""}` : "not installed")}</div>}
        <div className="btns gut gap-group">
          <Btn kind="primary" onClick={launch} disabled={!pick || busy || !!self?.readOnly}>
            {busy ? "Launching" : "Launch ›"}
          </Btn>
          {self?.readOnly && <span className="label">read-only: this controller refuses agent launches</span>}
          {models !== null && models.length === 0 && <span className="label">no model on the gateway</span>}
        </div>
        <Err>{err}</Err>
        {res && (
          <>
            <SectionHeading>launched</SectionHeading>
            <FieldRow label="how" value={res.how} />
            <FieldRow label="workspace" value={res.workspaceId} />
            {res.tmuxSession && <FieldRow label="tmux" value={res.tmuxSession} />}
            {res.attach && <FieldRow icon="agent" label="attach" value={res.attach} copy={res.attach} />}
            {res.url && (
              <div className="gut gap-block">
                <Btn kind="primary" href={res.url}>
                  Open DSH ›
                </Btn>
              </div>
            )}
            <div className="gut gap-block">
              <div className="label">command</div>
              <pre className="pre">{res.command}</pre>
            </div>
          </>
        )}
      </div>
      <div className="col">
        <SectionHeading>harnesses</SectionHeading>
        <Table<HarnessInfo>
          cols={[
            { h: "harness", c: (h) => h.harness },
            { h: "installed", c: (h) => (h.installed ? "yes" : <span className="label">no</span>) },
            { h: "version", c: (h) => h.version ?? "–" },
            { h: "tier", n: true, c: (h) => String(h.tier) },
            { h: "note", c: (h) => h.note },
          ]}
          rows={harnesses}
          keyOf={(h) => h.harness}
          empty="agents are not available on this controller yet"
        />
        <SectionHeading>deepseek harness</SectionHeading>
        {dsh ? (
          <>
            <FieldRow label="installed" value={dsh.installed ? `yes${dsh.version ? ` · ${dsh.version}` : ""}` : "no"} />
            <FieldRow label="running" value={dsh.running ? `yes · :${dsh.port}` : "no"} />
            <FieldRow label="provider" value={dsh.providerId} />
            <FieldRow label="home" value={homeDir(dsh.home)} />
            {dsh.url && (
              <div className="gut gap-block">
                <Btn kind="primary" href={dsh.url}>
                  Open DSH ›
                </Btn>
              </div>
            )}
          </>
        ) : (
          <div className="note gap-block">–</div>
        )}
        <SectionHeading>workspaces</SectionHeading>
        <Table<Workspace>
          cols={[
            { h: "name", c: (w) => w.name },
            { h: "harness", c: (w) => w.harness },
            { h: "model", c: (w) => w.model },
            { h: "folder", c: (w) => homeDir(w.dir) },
            { h: "opened", c: (w) => (w.lastOpenAt ? fmt.ago(w.lastOpenAt, now) : "–") },
            {
              h: "",
              c: (w) => (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setHarness(w.harness);
                    setPick(w.model);
                    setDir(w.dir);
                    setName(w.name);
                    setResume(true);
                  }}
                >
                  Use
                </button>
              ),
            },
          ]}
          rows={workspaces}
          keyOf={(w) => w.id}
          empty="no workspaces yet"
        />
      </div>
    </div>
  );
};
