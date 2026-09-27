import { StrictMode, useMemo, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { getKey, setKey } from "./api";
import { KeyPrompt } from "./components/actions";
import { BarMark, Boundary } from "./components/basics";
import { machines } from "./model/view";
import { restart, start, useStore } from "./store";
import { ControlPage } from "./views/control";
import { LivePage } from "./views/live";
import { UsagePage } from "./views/usage";

const TABS = ["control", "live", "usage"] as const;

const onHash = (f: () => void) => {
  window.addEventListener("hashchange", f);
  return () => window.removeEventListener("hashchange", f);
};

const Filter = ({ tab, on }: { tab: string; on: string | null }) => {
  const fleet = useStore((s) => s.fleet);
  const launches = useStore((s) => s.launches);
  const ms = useMemo(() => machines(fleet, launches), [fleet, launches]);
  if (ms.length < 2) return null;
  return (
    <nav className="mtabs">
      <a href={`#/${tab}`} className={on ? "" : "on"}>
        <span>all machines</span>
        <span className="n">{ms.filter((m) => m.online).length}</span>
      </a>
      {ms.map((m) => (
        <a key={m.id} href={`#/${tab}/${encodeURIComponent(m.id)}`} className={`${on === m.id ? "on" : ""}${m.online ? "" : " off"}`} title={m.gpuSummary}>
          <BarMark mark={m.online ? m.mark : "failed"} />
          <span>{m.name}</span>
        </a>
      ))}
    </nav>
  );
};

const App = () => {
  const hash = useSyncExternalStore(onHash, () => location.hash);
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [tab, arg] = path.split("/").map(decodeURIComponent);
  const view = TABS.find((t) => t === tab) ?? "control";
  const needKey = useStore((s) => s.needKey);
  const conn = useStore((s) => s.conn);
  const retry = useStore((s) => s.retryMs);
  const version = useStore((s) => s.fleet?.machines.find((m) => m.peerId === null)?.snapshot?.machine.version ?? "");
  const machine = arg || null;
  return (
    <div className="shell">
      <div className="banner">
        <a className="brand" href="#/control">
          LOCAL STUDIO <span className="label">{version}</span>
        </a>
        <nav className="pages">
          {TABS.map((t) => (
            <a key={t} href={`#/${t}`} className={view === t ? "on" : ""}>
              {t}
            </a>
          ))}
        </nav>
        <span className="conn">
          <span className={conn === "retrying" ? "alert" : "label"}>{conn === "retrying" && retry ? `retry ${Math.round(retry / 1000)}s` : conn}</span>
          {getKey() && (
            <button type="button" className="btn" onClick={() => (setKey(null), void restart())}>
              Sign out
            </button>
          )}
        </span>
      </div>
      <Filter tab={view} on={machine} />
      <Boundary key={view} name={view}>
        {view === "usage" ? (
          <UsagePage machineId={machine} />
        ) : view === "live" ? (
          <LivePage machineId={machine} />
        ) : (
          <ControlPage machineId={tab === "agents" ? null : machine} model={new URLSearchParams(query).get("model")} />
        )}
      </Boundary>
      {needKey && <KeyPrompt />}
    </div>
  );
};

window.addEventListener("unhandledrejection", (e) => console.error("unhandled", e.reason));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boundary name="app">
      <App />
    </Boundary>
  </StrictMode>,
);
void start();
