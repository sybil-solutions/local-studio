import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { getKey, setKey } from "./api";
import { KeyPrompt } from "./components/actions";
import { restart, start, useStore } from "./store";
import { AgentsPage } from "./views/agents";
import { ControlPage } from "./views/control";
import { LivePage } from "./views/live";
import { UsagePage } from "./views/usage";

const TABS = ["control", "live", "usage", "agents"] as const;

const onHash = (f: () => void) => {
  window.addEventListener("hashchange", f);
  return () => window.removeEventListener("hashchange", f);
};

const App = () => {
  const hash = useSyncExternalStore(onHash, () => location.hash);
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [tab, arg] = path.split("/").map(decodeURIComponent);
  const view = TABS.find((t) => t === tab) ?? "control";
  const needKey = useStore((s) => s.needKey);
  const conn = useStore((s) => s.conn);
  const retry = useStore((s) => s.retryMs);
  const self = useStore((s) => s.fleet?.machines.find((m) => m.peerId === null)?.snapshot?.machine ?? null);
  return (
    <div className="shell">
      <div className="top">
        <span className="row-flex">
          <a className="label" href="#/control">
            LOCAL STUDIO
          </a>
          <span className="tiny dim">{self?.version ?? ""}</span>
        </span>
        <nav className="tabs">
          {TABS.map((t) => (
            <a key={t} href={`#/${t}`} className={view === t ? "on" : ""}>
              {t}
            </a>
          ))}
        </nav>
        <span className="conn">
          <span className={conn === "retrying" ? "alert" : "label"}>
            {conn === "live" ? "live" : conn === "retrying" ? `reconnecting${retry ? ` in ${Math.round(retry / 1000)}s` : ""}` : "connecting"}
          </span>
          {getKey() && (
            <button type="button" className="btn" onClick={() => (setKey(null), void restart())}>
              Forget key
            </button>
          )}
        </span>
      </div>
      {view === "usage" ? (
        <UsagePage machineId={arg || null} />
      ) : view === "live" ? (
        <LivePage />
      ) : view === "agents" ? (
        <AgentsPage model={new URLSearchParams(query).get("model")} />
      ) : (
        <ControlPage machineId={arg || null} />
      )}
      {needKey && <KeyPrompt />}
    </div>
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void start();
