import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { getKey, setKey } from "./api";
import { KeyPrompt } from "./components/actions";
import { Boundary } from "./components/basics";
import { restart, start, useStore } from "./store";
import { ControlPage } from "./views/control";
import { LivePage } from "./views/live";
import { UsagePage } from "./views/usage";

const TABS = ["control", "live", "usage"] as const;

const onHash = (f: () => void) => {
  window.addEventListener("hashchange", f);
  return () => window.removeEventListener("hashchange", f);
};

const App = () => {
  const hash = useSyncExternalStore(onHash, () => location.hash);
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [tab, ...sub] = path.split("/").map(decodeURIComponent);
  const view = TABS.find((t) => t === tab) ?? "control";
  const needKey = useStore((s) => s.needKey);
  const conn = useStore((s) => s.conn);
  const retry = useStore((s) => s.retryMs);
  const count = useStore((s) => s.fleet?.machines.length ?? 0);
  const online = useStore((s) => s.fleet?.machines.filter((m) => m.online).length ?? 0);
  return (
    <div className="p-shell">
      <div className="p-top">
        <a className="ink" href="#/control">
          LOCAL STUDIO
        </a>
        <span className="label">{`${online} / ${count} machines`}</span>
        {conn !== "live" && <span className={conn === "retrying" ? "alert" : "label"}>{conn === "retrying" && retry ? `retry ${Math.round(retry / 1000)}s` : conn}</span>}
        <nav>
          {TABS.map((t) => (
            <a key={t} href={`#/${t}`} className={view === t ? "on" : ""}>
              {t}
            </a>
          ))}
          {getKey() && (
            <button type="button" className="p-link" onClick={() => (setKey(null), void restart())}>
              sign out
            </button>
          )}
        </nav>
      </div>
      <Boundary key={view} name={view}>
        {view === "usage" ? <UsagePage /> : view === "live" ? <LivePage /> : <ControlPage sub={tab === "control" ? sub : []} model={new URLSearchParams(query).get("model")} />}
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
