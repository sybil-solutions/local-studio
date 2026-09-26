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

const NONE: never[] = [];

const Filter = ({ tab, on }: { tab: string; on: string | null }) => {
  const ms = useStore((s) => s.fleet?.machines ?? NONE);
  if (ms.length < 2) return null;
  return (
    <nav className="top tabs filter">
      <a href={`#/${tab}`} className={on ? "" : "on"}>
        all
      </a>
      {ms.map((m) => (
        <a key={m.machineId} href={`#/${tab}/${encodeURIComponent(m.machineId)}`} className={`${on === m.machineId ? "on" : ""}${m.online ? "" : " alert"}`}>
          {m.snapshot?.machine.name ?? m.machineId.slice(0, 8)}
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
      <div className="top">
        <span className="row-flex">
          <a className="label" href="#/control">
            LOCAL STUDIO
          </a>
          <span className="label">{version}</span>
        </span>
        <nav className="tabs">
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
