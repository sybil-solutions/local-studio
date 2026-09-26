import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { getKey, setKey } from "./api";
import { KeyPrompt } from "./components/actions";
import { TitleLine } from "./components/basics";
import { parseRoute, useHash } from "./route";
import { restart, start, useStore } from "./store";
import { AgentsPage } from "./views/agents";
import { ConnectPage } from "./views/connect";
import { Home } from "./views/home";
import { MachinePage } from "./views/machine";
import { MetricsPage } from "./views/metrics";
import { ModelPage } from "./views/model";
import { RecipesPage } from "./views/recipes";

const NAV = [
  ["home", "#/home"],
  ["recipes", "#/recipes"],
  ["metrics", "#/metrics"],
  ["agents", "#/agents"],
  ["connect", "#/connect"],
] as const;

const App = () => {
  const route = parseRoute(useHash());
  const needKey = useStore((s) => s.needKey);
  const conn = useStore((s) => s.conn);
  const retry = useStore((s) => s.retryMs);
  const fleet = useStore((s) => s.fleet);
  const self = fleet?.machines.find((m) => m.machineId === fleet.self)?.snapshot ?? null;
  const models = fleet?.machines.reduce((t, m) => t + (m.snapshot?.models.length ?? 0), 0) ?? 0;
  const view =
    route.view === "machine" ? (
      <MachinePage machineId={route.machineId} />
    ) : route.view === "model" ? (
      <ModelPage machineId={route.machineId} modelId={route.modelId} />
    ) : route.view === "recipes" ? (
      <RecipesPage machineId={route.machineId} />
    ) : route.view === "metrics" ? (
      <MetricsPage machineId={route.machineId} />
    ) : route.view === "agents" ? (
      <AgentsPage model={route.model} />
    ) : route.view === "connect" ? (
      <ConnectPage />
    ) : (
      <Home />
    );
  return (
    <div className="shell">
      <div className="top">
        <TitleLine version={self?.machine.version ?? ""} />
        <nav className="nav">
          {NAV.map(([label, href]) => (
            <a key={label} href={href} className={route.view === label || (label === "home" && (route.view === "machine" || route.view === "model")) ? "on" : ""}>
              {label}
            </a>
          ))}
        </nav>
        <span className="conn">
          <span className={conn === "retrying" ? "alert" : "label"}>
            {conn === "live" ? "live" : conn === "retrying" ? `reconnecting${retry ? ` in ${Math.round(retry / 1000)}s` : ""}` : "connecting"}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (getKey()) {
                setKey(null);
                void restart();
              } else void restart().then(() => undefined);
            }}
            title={getKey() ? "forget the stored key" : "reconnect"}
          >
            {getKey() ? "Forget key" : "Reconnect"}
          </button>
        </span>
      </div>
      {view}
      <div className="foot-line">
        <span>{self ? `${self.machine.name} · ${self.machine.platform}` : "–"}</span>
        <span>
          {fleet?.machines.length ?? 0} machine{fleet?.machines.length === 1 ? "" : "s"} · {models} model{models === 1 ? "" : "s"}
        </span>
        {self?.machine.readOnly && <span>read-only</span>}
      </div>
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
