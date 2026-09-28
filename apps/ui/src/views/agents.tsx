import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AgentDefault, AgentLaunchResult, AgentSession, AgentTestResult, AgentTestRun, Harness, HarnessInfo, HarnessJob } from "@local-studio/contracts/client";
import { fmt } from "@local-studio/contracts/client";
import { call, get, post } from "../api";
import { Btn, Copy, Err, SectionHeading, Table } from "../components/basics";
import { homeDir } from "../model/view";
import { useStore } from "../store";

const AGENTS: [Harness, string][] = [
  ["dsh", "dsh"],
  ["pi", "pi"],
  ["omp", "omp"],
  ["amp", "amp"],
  ["hermes", "hermes"],
  ["droid", "droid"],
  ["codex", "Codex CLI"],
  ["codex-desktop", "Codex desktop"],
  ["claude", "Claude Code CLI"],
  ["claude-desktop", "Claude Code desktop"],
];

type GwModel = { id: string; owned_by?: string; context_length?: number | null; local_studio?: { state?: string } };
type Bridge = { pickFolder?: () => Promise<string | null> };

const DESKTOP = /Electron/.test(navigator.userAgent);
const bridge = (): Bridge | undefined => (window as unknown as { localStudio?: Bridge }).localStudio;
const RECENT = "ls.recentDirs";
const label = (h: string) => AGENTS.find(([k]) => k === h)?.[1] ?? h;
const jobText = (j: HarnessJob | null) => (!j ? "" : j.state === "running" ? `${j.action}ing` : j.state === "failed" ? `${j.action} failed: ${j.detail}` : "");

const ver = (v: string) => (
  <span className="cut" style={{ maxWidth: "14ch" }} title={v}>
    {v}
  </span>
);

const newer = (a: string | null, b: string | null): boolean => {
  if (!a || !b || a === b) return false;
  const [x, y] = [a, b].map((v) => /^\d+\.\d+\.\d+/.exec(v)?.[0].split(".").map(Number) ?? []);
  for (let i = 0; i < 3; i++) if ((x![i] ?? 0) !== (y![i] ?? 0)) return (x![i] ?? 0) > (y![i] ?? 0);
  return a.localeCompare(b, undefined, { numeric: true }) > 0 && !(b.includes("-") === false && a.includes("-"));
};

const DEFAULT_KEY = "ls.defaultHarness";
let defaultHarness: string | null = (() => {
  try {
    return localStorage.getItem(DEFAULT_KEY);
  } catch {
    return null;
  }
})();
let defaultLoaded = false;
const defaultSubs = new Set<() => void>();
const putDefault = (h: string | null) => {
  defaultHarness = h;
  try {
    if (h) localStorage.setItem(DEFAULT_KEY, h);
  } catch {}
  defaultSubs.forEach((f) => f());
};
const loadDefault = () => void get<AgentDefault>("/api/agents/default").then((r) => r.ok && putDefault(r.data.harness));
const subscribeDefault = (f: () => void) => {
  defaultSubs.add(f);
  if (!defaultLoaded) {
    defaultLoaded = true;
    loadDefault();
  }
  return () => void defaultSubs.delete(f);
};

export const useDefaultHarness = (): string | null => useSyncExternalStore(subscribeDefault, () => defaultHarness);

const recent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
};

const remember = (d: string) => {
  try {
    localStorage.setItem(RECENT, JSON.stringify([d, ...recent().filter((x) => x !== d)].slice(0, 8)));
  } catch {}
};

export const AgentsSection = ({ model, only, bare }: { model: string | null; only: "launch" | "sessions"; bare?: boolean }) => {
  const now = useStore((s) => s.now);
  const readOnly = useStore((s) => s.fleet?.machines.find((m) => m.peerId === null)?.snapshot?.machine.readOnly ?? false);
  const [infos, setInfos] = useState<HarnessInfo[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [models, setModels] = useState<GwModel[]>([]);
  const [agent, setAgent] = useState<Harness | null>(null);
  const [pick, setPick] = useState(model ?? "");
  const [dir, setDir] = useState("");
  const [dirs, setDirs] = useState(recent);
  const [res, setRes] = useState<AgentLaunchResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const def = useDefaultHarness();
  const [tests, setTests] = useState<Partial<Record<string, AgentTestResult>>>({});
  const [testing, setTesting] = useState(false);
  const [full, setFull] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  const loadInfos = () => void call<HarnessInfo[]>("GET", "/api/agents", undefined, 60_000).then((r) => r.ok && Array.isArray(r.data) && setInfos(r.data));
  const loadSessions = () => void get<AgentSession[]>("/api/agents/sessions").then((r) => r.ok && Array.isArray(r.data) && setSessions(r.data));
  const loadModels = () => void get<{ data?: GwModel[] }>("/v1/models").then((r) => r.ok && Array.isArray(r.data?.data) && setModels(r.data.data.filter((m) => (m.local_studio?.state ?? "ready") === "ready")));
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
  useEffect(() => {
    if (!model) return;
    setPick(model);
    top.current?.scrollIntoView({ block: "start" });
  }, [model]);

  const install = async (h: string) => {
    setErr(null);
    const r = await post<HarnessJob>(`/api/agents/${h}/install`);
    if (!r.ok) return setErr(r.error);
    setInfos((xs) => xs.map((x) => (x.harness === h ? { ...x, job: r.data } : x)));
  };
  const launch = async () => {
    const agent = chosen;
    if (!agent || !pick) return;
    setBusy(true);
    setErr(null);
    setRes(null);
    const d = dir.trim();
    const r = await call<AgentLaunchResult>("POST", `/api/agents/launch?terminal=${DESKTOP ? "auto" : "none"}`, { harness: agent, model: pick, ...(d ? { dir: d } : {}) }, 90_000);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    if (d) (remember(d), setDirs(recent()));
    setRes(r.data);
    loadSessions();
    if (DESKTOP && r.data.url) window.open(r.data.url);
  };
  const makeDefault = async (h: Harness) => {
    const r = await call<AgentDefault>("PUT", "/api/agents/default", { harness: h });
    if (!r.ok) return setErr(r.error);
    putDefault(r.data.harness);
  };
  const testModel = pick && models.some((m) => m.id === pick) ? pick : (models[0]?.id ?? "");
  const testAll = async () => {
    if (!testModel) return;
    setTesting(true);
    setErr(null);
    setTests({});
    const r = await call<AgentTestRun>("POST", "/api/agents/test", { model: testModel }, 300_000);
    setTesting(false);
    if (!r.ok) return setErr(r.error);
    setTests(Object.fromEntries(r.data.results.map((x) => [x.harness, x])));
  };
  const testCell = (h: Harness) => {
    const t = tests[h];
    if (!t) return <span className="label">{testing && info(h)?.installed ? "running" : "–"}</span>;
    const text = t.status === "ok" ? (h.endsWith("-desktop") ? "opens" : "ok") : t.status === "failed" ? "failed" : (t.reason ?? "skipped");
    return <span className={t.status === "failed" ? "alert" : t.status === "ok" ? "ink" : "label"} title={`${t.reason ?? ""}${t.ms ? ` · ${(t.ms / 1000).toFixed(1)} s` : ""}`}>{text}</span>;
  };
  const choose = async () => {
    const d = await bridge()?.pickFolder?.();
    if (d) setDir(d);
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
  const chosen = (agent ?? (def as Harness | null)) || null;
  const sel = chosen ? info(chosen) : undefined;
  const blocked = sel ? (sel.blocked ?? (sel.installed ? null : `${label(sel.harness)} is not installed`)) : null;
  const machines = [...new Set(models.map((m) => m.owned_by ?? ""))];
  const ready = !!chosen && !!pick && models.some((m) => m.id === pick);

  const status = (i: HarnessInfo | undefined): [string, string] => {
    if (!i) return ["", "label"];
    if (i.job?.state === "running") return [jobText(i.job), "label"];
    if (i.job?.state === "failed") return [`${i.job.action} failed`, "alert"];
    if (!i.installed) return ["not installed", "label"];
    if (newer(i.latest, i.version)) return ["update available", "ink"];
    return [i.managed ? "managed" : "", "label"];
  };

  return (
    <>
      {only === "launch" && <div ref={top}>
        <SectionHeading
          aside={
            <span className="btns">
              <Btn onClick={() => setFull((x) => !x)}>{full ? "Hide harnesses" : "Harnesses ›"}</Btn>
              <Btn onClick={() => void testAll()} disabled={!testModel || testing || readOnly}>{testing ? "Testing" : "Test all ›"}</Btn>
            </span>
          }
        >
          harness
        </SectionHeading>
        {!full && (
          <div className="gut label">
            {`default ${def ?? "–"} · ${infos.filter((i) => i.installed).length} of ${AGENTS.length} installed · ${infos.filter((i) => i.installed && newer(i.latest, i.version)).length} updates${Object.keys(tests).length ? ` · test ${Object.values(tests).filter((t) => t?.status === "ok").length} ok, ${Object.values(tests).filter((t) => t?.status === "failed").length} failed` : ""}`}
          </div>
        )}
        {full && <Table<(typeof AGENTS)[number]>
          cols={[
            { h: "", c: ([h]) => <span className="ink">{agent === h ? "✓" : ""}</span> },
            { h: "harness", c: ([h, l]) => <span className={agent === h ? "ink" : ""}>{l}</span> },
            { h: "installed", c: ([h]) => ver(info(h) ? (info(h)!.installed ? (info(h)!.version ?? "?") : "–") : "") },
            { h: "latest", c: ([h]) => ver(info(h) ? (info(h)!.latest ?? "–") : "") },
            {
              h: "default",
              c: ([h]) => {
                const i = info(h);
                const can = !!i?.installed && !i.blocked;
                return (
                  <span className={def === h ? "ink" : "label"} title={can ? "make default" : undefined} onClick={(e) => (e.stopPropagation(), can && !readOnly && void makeDefault(h))}>
                    {def === h ? "●" : can ? "○" : ""}
                  </span>
                );
              },
            },
            { h: "test", c: ([h]) => testCell(h) },
            { h: "status", c: ([h]) => { const [t, c] = status(info(h)); return <span className={c}>{t}</span>; } },
            {
              h: " ",
              c: ([h]) => {
                const i = info(h);
                if (!i?.package || i.job?.state === "running" || (i.installed && !newer(i.latest, i.version))) return null;
                return (
                  <span onClick={(e) => e.stopPropagation()}>
                    <Btn onClick={() => void install(h)} disabled={readOnly}>{i.installed ? "Update" : "Install"}</Btn>
                  </span>
                );
              },
            },
          ]}
          rows={AGENTS}
          keyOf={([h]) => h}
          rowClass={([h]) => (agent === h ? "hl" : "")}
          onRow={([h]) => (setAgent(h), setRes(null))}
        />}
        {infos
          .filter((i) => i.job?.state === "failed")
          .map((i) => (
            <Err key={i.harness}>{`${label(i.harness)}: ${jobText(i.job)}`}</Err>
          ))}
        <div className="form">
          <label htmlFor="agent-harness">harness</label>
          <select id="agent-harness" className="input" value={agent ?? def ?? ""} onChange={(e) => (setAgent(e.target.value as Harness), setRes(null))}>
            <option value="" disabled>
              choose a harness
            </option>
            {AGENTS.filter(([h]) => info(h)?.installed && !info(h)?.blocked).map(([h, l]) => (
              <option key={h} value={h}>
                {`${l}${def === h ? " · default" : ""}`}
              </option>
            ))}
          </select>
          <label htmlFor="agent-model">model</label>
          <select id="agent-model" className="input" value={pick} required onChange={(e) => setPick(e.target.value)}>
            <option value="" disabled>
              {models.length ? "choose a ready model" : "no model is ready in the fleet"}
            </option>
            {pick && !models.some((m) => m.id === pick) && (
              <option value={pick} disabled>
                {`${pick} · not ready`}
              </option>
            )}
            {machines.map((mn) => (
              <optgroup key={mn} label={mn || "fleet"}>
                {models
                  .filter((m) => (m.owned_by ?? "") === mn)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {`${m.id}${m.context_length ? ` · ${fmt.ctx(m.context_length)}` : ""}`}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <label htmlFor="agent-dir">folder</label>
          <span className="row-flex">
            <input id="agent-dir" className="input" list="agent-dirs" value={dir} placeholder="~/work/<harness>" onChange={(e) => setDir(e.target.value)} spellCheck={false} />
            <datalist id="agent-dirs">
              {dirs.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            {bridge()?.pickFolder && <Btn onClick={() => void choose()}>Choose ›</Btn>}
          </span>
        </div>
        <div className="btns gut" style={{ marginTop: "var(--group)" }}>
          <Btn kind="primary" onClick={() => void launch()} disabled={!ready || !!blocked || busy || readOnly}>
            {busy ? "Starting" : `Launch ${chosen ? label(chosen) : "harness"} on ${pick || "model"} ›`}
          </Btn>
          {blocked && <span className="alert">{blocked}</span>}
        </div>
        <Err>{err}</Err>
        {res && (
          <div className="gut" style={{ marginTop: "var(--group)" }}>
            <div className="ink">
              {label(res.harness)} {res.version ?? ""} · {res.how} · {homeDir(res.dir)}
            </div>
            {res.note && <div className="label">{res.note}</div>}
            {res.running && <div className="label cut">{res.running}</div>}
            {res.url && (
              <div className="btns" style={{ marginTop: "var(--block)" }}>
                <Btn kind="primary" href={res.url}>
                  Open dsh ›
                </Btn>
              </div>
            )}
            {res.attach && <Copy text={res.attach} />}
          </div>
        )}
      </div>}
      {only === "sessions" && sessions.length > 0 && <div>
        {!bare && <SectionHeading aside={<span className="label">{`${sessions.length} running`}</span>}>agents</SectionHeading>}
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
      </div>}
    </>
  );
};
